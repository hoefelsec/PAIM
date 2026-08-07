import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

// The whole point of this module is to wrap @anthropic-ai/sdk, so every test
// mocks the SDK rather than making a live call. `messages.parse` is the only
// method the module calls; give every constructed instance a mock of it.
const parseMock = vi.fn();

vi.mock("@anthropic-ai/sdk", () => {
  class MockAnthropic {
    messages = { parse: parseMock };
  }
  return { default: MockAnthropic };
});

const ENV_KEYS = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_CONFIG_DIR", "ANTHROPIC_PROFILE"] as const;
let savedEnv: Record<string, string | undefined>;
let scratchDir: string;

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];

  scratchDir = mkdtempSync(join(tmpdir(), "paim-ai-client-test-"));
  process.env.ANTHROPIC_CONFIG_DIR = scratchDir;

  parseMock.mockReset();
  vi.resetModules();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  rmSync(scratchDir, { recursive: true, force: true });
});

describe("aiAvailable", () => {
  it("is false with no env var and no ant auth profile on disk", async () => {
    const { aiAvailable } = await import("../../../src/server/ai/client.js");
    expect(aiAvailable()).toBe(false);
  });

  it("is true when ANTHROPIC_API_KEY is set", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    const { aiAvailable } = await import("../../../src/server/ai/client.js");
    expect(aiAvailable()).toBe(true);
  });

  it("is true when ANTHROPIC_AUTH_TOKEN is set", async () => {
    process.env.ANTHROPIC_AUTH_TOKEN = "token-test";
    const { aiAvailable } = await import("../../../src/server/ai/client.js");
    expect(aiAvailable()).toBe(true);
  });

  it("is true when an ant auth login profile file exists on disk", async () => {
    mkdirSync(join(scratchDir, "credentials"), { recursive: true });
    writeFileSync(join(scratchDir, "credentials", "default.json"), "{}");
    const { aiAvailable } = await import("../../../src/server/ai/client.js");
    expect(aiAvailable()).toBe(true);
  });

  it("respects a non-default ANTHROPIC_PROFILE", async () => {
    process.env.ANTHROPIC_PROFILE = "work";
    mkdirSync(join(scratchDir, "credentials"), { recursive: true });
    writeFileSync(join(scratchDir, "credentials", "default.json"), "{}");

    const { aiAvailable } = await import("../../../src/server/ai/client.js");
    // "default" profile file exists, but ANTHROPIC_PROFILE points at "work"
    expect(aiAvailable()).toBe(false);

    writeFileSync(join(scratchDir, "credentials", "work.json"), "{}");
    expect(aiAvailable()).toBe(true);
  });
});

describe("logCredentialStatus", () => {
  it("logs the startup notice when unavailable", async () => {
    const { logCredentialStatus } = await import("../../../src/server/ai/client.js");
    const warn = vi.fn();
    logCredentialStatus({ warn });
    expect(warn).toHaveBeenCalledWith("no Anthropic credentials found");
  });

  it("stays silent when a credential is available", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    const { logCredentialStatus } = await import("../../../src/server/ai/client.js");
    const warn = vi.fn();
    logCredentialStatus({ warn });
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("requireAiAvailable", () => {
  it("throws a 503 AI_UNAVAILABLE ApiError when no credential is present", async () => {
    const { requireAiAvailable } = await import("../../../src/server/ai/client.js");
    try {
      requireAiAvailable();
      expect.unreachable("should have thrown");
    } catch (err) {
      // `vi.resetModules()` in beforeEach means the module under test may
      // have loaded a distinct copy of errors.js, so compare structurally
      // (name/code/status) rather than with `instanceof ApiError`.
      expect(err).toMatchObject({ name: "ApiError", status: 503, code: "AI_UNAVAILABLE" });
    }
  });

  it("does not throw when a credential is present", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    const { requireAiAvailable } = await import("../../../src/server/ai/client.js");
    expect(() => requireAiAvailable()).not.toThrow();
  });
});

describe("non-AI routes are unaffected when AI is unavailable", () => {
  it("still serves GET /api/health with no Anthropic credential present", async () => {
    const { aiAvailable } = await import("../../../src/server/ai/client.js");
    expect(aiAvailable()).toBe(false);

    const { createApp } = await import("../../../src/server/app.js");
    const app = createApp();
    const res = await app.inject({
      method: "GET",
      url: "/api/health",
      headers: { host: "localhost:4400" },
    });

    expect(res.statusCode).toBe(200);
  });
});

const Schema = z.object({ title: z.string(), priority: z.number() });

describe("parse", () => {
  it("throws 503 AI_UNAVAILABLE and never calls the SDK when credentials are absent", async () => {
    const { parse } = await import("../../../src/server/ai/client.js");

    await expect(parse("claude-opus-5", "system prompt", "user text", Schema)).rejects.toMatchObject({
      code: "AI_UNAVAILABLE",
      status: 503,
    });
    expect(parseMock).not.toHaveBeenCalled();
  });

  it("calls messages.parse with a cache_control'd system block and returns parsed_output", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    parseMock.mockResolvedValue({ parsed_output: { title: "Do the thing", priority: 2 } });

    const { parse, DEFAULT_MODEL } = await import("../../../src/server/ai/client.js");
    const result = await parse(DEFAULT_MODEL, "system prompt", "user text", Schema);

    expect(result).toEqual({ title: "Do the thing", priority: 2 });
    expect(parseMock).toHaveBeenCalledTimes(1);

    const call = parseMock.mock.calls[0]![0];
    expect(call.model).toBe(DEFAULT_MODEL);
    expect(call.messages).toEqual([{ role: "user", content: "user text" }]);
    expect(call.system).toEqual([
      {
        type: "text",
        text: "system prompt",
        cache_control: { type: "ephemeral" },
      },
    ]);
    expect(call.output_config.format.type).toBe("json_schema");
  });

  it("throws 502 AI_PARSE_FAILED when the response has no parsed_output", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    parseMock.mockResolvedValue({ parsed_output: null });

    const { parse } = await import("../../../src/server/ai/client.js");

    await expect(parse("claude-opus-5", "system prompt", "user text", Schema)).rejects.toMatchObject({
      code: "AI_PARSE_FAILED",
      status: 502,
    });
  });

  it("propagates an error thrown by the SDK", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    parseMock.mockRejectedValue(new Error("boom"));

    const { parse } = await import("../../../src/server/ai/client.js");

    await expect(parse("claude-opus-5", "system prompt", "user text", Schema)).rejects.toThrow("boom");
  });
});

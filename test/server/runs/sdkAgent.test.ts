/**
 * The Agent SDK adapter, with the SDK mocked (specs/09-ai-run.md "Runner").
 *
 * Nothing here reaches the network: `query()` is replaced with a scripted
 * generator, so the test can assert both halves of the adapter — the
 * options it configures the SDK with (docs/09 "The library", docs/10 §2 and
 * §4) and the translation of the SDK's messages into the runner's.
 */

import { describe, expect, it, vi } from "vitest";
import { query } from "@anthropic-ai/claude-agent-sdk";
import {
  createSdkAgent,
  usageFromResult,
} from "../../../src/server/runs/sdkAgent.js";
import type { AgentMessage, AgentPermissionDecision } from "../../../src/server/runs/agent.js";

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({ query: vi.fn() }));

type QueryParams = Parameters<typeof query>[0];

/** Replaces `query()` with a fixed transcript and records how it was called. */
function scriptSdk(messages: unknown[]): { calls: QueryParams[] } {
  const calls: QueryParams[] = [];
  vi.mocked(query).mockImplementation((params: QueryParams) => {
    calls.push(params);
    async function* stream(): AsyncGenerator<unknown> {
      for (const message of messages) yield message;
    }
    return stream() as unknown as ReturnType<typeof query>;
  });
  return { calls };
}

async function collect(iterable: AsyncIterable<AgentMessage>): Promise<AgentMessage[]> {
  const out: AgentMessage[] = [];
  for await (const message of iterable) out.push(message);
  return out;
}

const noopPermission = async (): Promise<AgentPermissionDecision> => ({ behavior: "allow" });

const SUCCESS_RESULT = {
  type: "result",
  subtype: "success",
  is_error: false,
  total_cost_usd: 0.25,
  usage: { input_tokens: 1, output_tokens: 2 },
  modelUsage: {
    "claude-opus-5": { inputTokens: 900, outputTokens: 120 },
    "claude-haiku-4-5": { inputTokens: 100, outputTokens: 30 },
  },
};

describe("createSdkAgent — how it configures the SDK", () => {
  it("runs in the workspace, with the six built-in tools and no filesystem settings", async () => {
    const { calls } = scriptSdk([SUCCESS_RESULT]);

    await collect(
      createSdkAgent().run({
        prompt: "Task PAIM-1: do the thing",
        cwd: "/tmp/workspace",
        model: "claude-opus-5",
        canUseTool: noopPermission,
      }),
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]!.prompt).toBe("Task PAIM-1: do the thing");
    const options = calls[0]!.options!;
    expect(options.cwd).toBe("/tmp/workspace");
    expect(options.tools).toEqual(["Read", "Write", "Edit", "Bash", "Glob", "Grep"]);
    // docs/10 §4: a settings file in the workspace must not widen a run.
    expect(options.settingSources).toEqual([]);
    expect(options.permissionMode).toBe("default");
    expect(options.model).toBe("claude-opus-5");
    expect(options.canUseTool).toBeTypeOf("function");
    // docs/10 §2: nothing outside the workspace is granted.
    expect(options.additionalDirectories).toBeUndefined();
  });

  it("omits the model when routing did not pick one", async () => {
    const { calls } = scriptSdk([SUCCESS_RESULT]);
    await collect(
      createSdkAgent().run({
        prompt: "p",
        cwd: "/tmp/workspace",
        model: null,
        canUseTool: noopPermission,
      }),
    );
    expect(calls[0]!.options!.model).toBeUndefined();
  });

  it("delegates the permission callback to the runner in both directions", async () => {
    const { calls } = scriptSdk([SUCCESS_RESULT]);
    const seen: Array<{ toolName: string; toolUseId: string }> = [];

    await collect(
      createSdkAgent().run({
        prompt: "p",
        cwd: "/tmp/workspace",
        model: null,
        canUseTool: async (toolName, _input, context) => {
          seen.push({ toolName, toolUseId: context.toolUseId });
          return toolName === "Bash"
            ? { behavior: "deny", message: "on the deny list" }
            : { behavior: "allow", updatedInput: { file_path: "safe.ts" } };
        },
      }),
    );

    const canUseTool = calls[0]!.options!.canUseTool!;
    const signal = new AbortController().signal;

    await expect(
      canUseTool("Read", { file_path: "a.ts" }, { signal, toolUseID: "tu_1", requestId: "r1" }),
    ).resolves.toEqual({ behavior: "allow", updatedInput: { file_path: "safe.ts" } });

    await expect(
      canUseTool("Bash", { command: "rm -rf /" }, { signal, toolUseID: "tu_2", requestId: "r2" }),
    ).resolves.toEqual({ behavior: "deny", message: "on the deny list" });

    expect(seen).toEqual([
      { toolName: "Read", toolUseId: "tu_1" },
      { toolName: "Bash", toolUseId: "tu_2" },
    ]);
  });
});

describe("createSdkAgent — how it reads the SDK's messages", () => {
  it("turns every tool_result block into one operation outcome", async () => {
    scriptSdk([
      { type: "assistant", message: { content: [{ type: "text", text: "working" }] } },
      {
        type: "user",
        message: {
          content: [
            {
              type: "tool_result",
              tool_use_id: "tu_1",
              content: [{ type: "text", text: "file body" }],
            },
            { type: "tool_result", tool_use_id: "tu_2", content: "second", is_error: true },
          ],
        },
      },
      SUCCESS_RESULT,
    ]);

    const messages = await collect(
      createSdkAgent().run({
        prompt: "p",
        cwd: "/tmp/workspace",
        model: null,
        canUseTool: noopPermission,
      }),
    );

    expect(messages).toHaveLength(3);
    expect(messages[0]).toEqual({
      type: "tool_result",
      toolUseId: "tu_1",
      text: "file body",
      isError: false,
      stdout: null,
      exitCode: null,
    });
    expect(messages[1]).toMatchObject({ toolUseId: "tu_2", text: "second", isError: true });
  });

  it("reads bash stdout and its exit code from the structured output", async () => {
    scriptSdk([
      {
        type: "user",
        tool_use_result: { stdout: "3 passing", stderr: "", exitCode: 0 },
        message: {
          content: [{ type: "tool_result", tool_use_id: "tu_1", content: "3 passing" }],
        },
      },
      SUCCESS_RESULT,
    ]);

    const [first] = await collect(
      createSdkAgent().run({
        prompt: "p",
        cwd: "/tmp/workspace",
        model: null,
        canUseTool: noopPermission,
      }),
    );

    expect(first).toMatchObject({ stdout: "3 passing", exitCode: 0 });
  });

  it("reports a failed run with the SDK's own reason", async () => {
    scriptSdk([
      {
        type: "result",
        subtype: "error_max_turns",
        is_error: true,
        total_cost_usd: 0.5,
        usage: { input_tokens: 10, output_tokens: 5 },
        modelUsage: {},
        errors: ["ran out of turns"],
      },
    ]);

    const [result] = await collect(
      createSdkAgent().run({
        prompt: "p",
        cwd: "/tmp/workspace",
        model: null,
        canUseTool: noopPermission,
      }),
    );

    expect(result).toEqual({
      type: "result",
      ok: false,
      usage: { inputTokens: 10, outputTokens: 5, costUsd: 0.5 },
      errorMessage: "ran out of turns",
    });
  });
});

describe("usageFromResult", () => {
  it("sums modelUsage across models — the SDK's accounting field", () => {
    expect(usageFromResult(SUCCESS_RESULT)).toEqual({
      inputTokens: 1000,
      outputTokens: 150,
      costUsd: 0.25,
    });
  });

  it("falls back to the main-loop usage when no per-model totals exist", () => {
    expect(
      usageFromResult({
        usage: { input_tokens: 7, output_tokens: 3 },
        modelUsage: {},
        total_cost_usd: 0.01,
      }),
    ).toEqual({ inputTokens: 7, outputTokens: 3, costUsd: 0.01 });
  });

  it("reports zeroes rather than guessing when the result carries nothing", () => {
    expect(usageFromResult({})).toEqual({ inputTokens: 0, outputTokens: 0, costUsd: 0 });
  });
});

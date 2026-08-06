import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/server/app.js";

const VALID_HOSTS = ["localhost:4400", "127.0.0.1:4400"];

describe("Host header check", () => {
  for (const host of VALID_HOSTS) {
    it(`allows a request with Host: ${host}`, async () => {
      const app = createApp();
      const res = await app.inject({ method: "GET", url: "/api/health", headers: { host } });

      expect(res.statusCode).toBe(200);
    });
  }

  it("rejects a request with a Host header that isn't localhost:4400 or 127.0.0.1:4400", async () => {
    const app = createApp();
    const res = await app.inject({
      method: "GET",
      url: "/api/health",
      headers: { host: "evil.example" },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({
      error: {
        code: "HOST_NOT_ALLOWED",
        message: "Host not allowed",
        details: { host: "evil.example" },
      },
    });
  });

  it("rejects a request with no Host header at all", async () => {
    const app = createApp();
    const res = await app.inject({
      method: "GET",
      url: "/api/health",
      headers: { host: "" },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("HOST_NOT_ALLOWED");
  });

  it("rejects a request for a DNS-rebound hostname even though it resolves to loopback", async () => {
    const app = createApp();
    const res = await app.inject({
      method: "GET",
      url: "/api/health",
      headers: { host: "attacker.example:4400" },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("HOST_NOT_ALLOWED");
  });
});

describe("static serving and SPA fallback", () => {
  let staticDir: string;
  const VALID_HOST = { host: "localhost:4400" };

  beforeEach(() => {
    staticDir = mkdtempSync(join(tmpdir(), "paim-dist-"));
    writeFileSync(join(staticDir, "index.html"), "<!doctype html><title>paim</title>");
    writeFileSync(join(staticDir, "app.js"), "console.log('hi');");
  });

  afterEach(() => {
    rmSync(staticDir, { recursive: true, force: true });
  });

  it("serves a real static asset from dist/ at its path", async () => {
    const app = createApp({ staticDir });
    const res = await app.inject({ method: "GET", url: "/app.js", headers: VALID_HOST });

    expect(res.statusCode).toBe(200);
    expect(res.body).toBe("console.log('hi');");
  });

  it("serves index.html at /", async () => {
    const app = createApp({ staticDir });
    const res = await app.inject({ method: "GET", url: "/", headers: VALID_HOST });

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("<title>paim</title>");
  });

  it("falls back to index.html for an unknown client route (SPA fallback)", async () => {
    const app = createApp({ staticDir });
    const res = await app.inject({
      method: "GET",
      url: "/projects/some-project/tasks/42",
      headers: VALID_HOST,
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.body).toContain("<title>paim</title>");
  });

  it("never falls back to the SPA for an unknown /api/* path", async () => {
    const app = createApp({ staticDir });
    const res = await app.inject({ method: "GET", url: "/api/nope", headers: VALID_HOST });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({
      error: { code: "NOT_FOUND", message: "Not found" },
    });
  });
});

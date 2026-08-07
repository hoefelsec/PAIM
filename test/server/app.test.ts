import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createApp } from "../../src/server/app.js";
import { ApiError } from "../../src/server/errors.js";

const pkgPath = fileURLToPath(new URL("../../package.json", import.meta.url));
const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as { version: string };

// The global Host check (see test/server/host-check.test.ts) rejects any
// request whose Host header isn't one of the two allowed values, so every
// inject() in this file must present one explicitly.
const VALID_HOST = { host: "localhost:4400" };

describe("GET /api/health", () => {
  it("returns ok:true and the package version in the data envelope", async () => {
    const app = createApp();
    const res = await app.inject({ method: "GET", url: "/api/health", headers: VALID_HOST });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ data: { ok: true, version: pkg.version } });
  });
});

describe("error handling", () => {
  it("maps a thrown ApiError to the error envelope with its own status and code", async () => {
    const app = createApp();
    app.get("/api/__test/throw-known", () => {
      throw new ApiError("FIELD_UNKNOWN", 400, { key: "priority" }, "Unknown field");
    });
    await app.ready();

    const res = await app.inject({
      method: "GET",
      url: "/api/__test/throw-known",
      headers: VALID_HOST,
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({
      error: {
        code: "FIELD_UNKNOWN",
        message: "Unknown field",
        details: { key: "priority" },
      },
    });
  });

  it("maps an unknown thrown error to 500 INTERNAL with no stack in the body", async () => {
    const app = createApp();
    app.get("/api/__test/throw-unknown", () => {
      throw new Error("something exploded with a secret stack trace");
    });
    await app.ready();

    const res = await app.inject({
      method: "GET",
      url: "/api/__test/throw-unknown",
      headers: VALID_HOST,
    });
    const body = res.json();

    expect(res.statusCode).toBe(500);
    expect(body).toEqual({
      error: { code: "INTERNAL", message: "Internal server error" },
    });
    expect(JSON.stringify(body)).not.toContain("secret stack trace");
  });
});

describe("unknown /api/* routes", () => {
  it("returns a 404 error envelope instead of a bare 404", async () => {
    const app = createApp();
    const res = await app.inject({ method: "GET", url: "/api/nope", headers: VALID_HOST });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({
      error: { code: "NOT_FOUND", message: "Not found" },
    });
  });
});

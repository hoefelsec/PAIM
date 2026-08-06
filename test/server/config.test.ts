import { describe, expect, it } from "vitest";
import { HOST, PORT } from "../../src/server/config.js";

describe("server bind config", () => {
  it("binds to loopback only, never 0.0.0.0", () => {
    expect(HOST).toBe("127.0.0.1");
  });

  it("binds to the documented port", () => {
    expect(PORT).toBe(4400);
  });
});

import { describe, expect, it } from "vitest";
import { errorEnvelope, listEnvelope } from "../../src/server/envelope.js";

describe("listEnvelope", () => {
  it("wraps data with total/cursor/hasMore meta", () => {
    const result = listEnvelope([1, 2, 3], { total: 3, cursor: null, hasMore: false });

    expect(result).toEqual({
      data: [1, 2, 3],
      meta: { total: 3, cursor: null, hasMore: false },
    });
  });
});

describe("errorEnvelope", () => {
  it("produces a stable {error:{code,message,details}} shape", () => {
    const result = errorEnvelope("FIELD_UNKNOWN", "Unknown field", { key: "priority" });

    expect(result).toEqual({
      error: { code: "FIELD_UNKNOWN", message: "Unknown field", details: { key: "priority" } },
    });
  });

  it("omits details when none are given", () => {
    const result = errorEnvelope("NOT_FOUND", "Not found");

    expect(result).toEqual({ error: { code: "NOT_FOUND", message: "Not found" } });
    expect("details" in result.error).toBe(false);
  });
});

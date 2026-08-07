import { describe, expect, it } from "vitest";
import { nextTimestamp } from "../../../src/server/db/tasks.js";

describe("nextTimestamp", () => {
  it("uses the current time when it is past the previous write", () => {
    const before = new Date().toISOString();

    const stamp = nextTimestamp("2020-01-01T00:00:00.000Z");

    expect(stamp >= before).toBe(true);
  });

  it("never repeats the previous timestamp", () => {
    // Two writes inside the same millisecond would otherwise share a value,
    // and `If-Match: <updatedAt>` would accept a request built before both.
    const previous = new Date(Date.now() + 5_000).toISOString();

    const stamp = nextTimestamp(previous);

    expect(stamp > previous).toBe(true);
    expect(nextTimestamp(stamp) > stamp).toBe(true);
  });

  it("starts from the current time for a first write", () => {
    const before = new Date().toISOString();

    expect(nextTimestamp(null) >= before).toBe(true);
  });
});

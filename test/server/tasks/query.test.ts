import { describe, expect, it } from "vitest";
import { ApiError } from "../../../src/server/errors.js";
import {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  encodeCursor,
  parseTaskListQuery,
  type TaskQueryContext,
} from "../../../src/server/tasks/query.js";
import type { FieldDef } from "../../../src/shared/fields.js";

const SCHEMA: FieldDef[] = [
  { key: "layer", type: "select", options: ["backend", "frontend"], default: "backend" },
  { key: "shipped", type: "checkbox", default: false },
  { key: "points", type: "number" },
];

function context(overrides: Partial<TaskQueryContext> = {}): TaskQueryContext {
  return {
    fieldSchema: SCHEMA,
    resolveParent: (ref) => `id-of-${ref}`,
    ...overrides,
  };
}

function parse(query: Record<string, unknown>) {
  return parseTaskListQuery(query, context());
}

/** Runs a parse expected to fail and returns the ApiError it threw. */
function failure(query: Record<string, unknown>): ApiError {
  try {
    parse(query);
  } catch (err) {
    expect(err).toBeInstanceOf(ApiError);
    return err as ApiError;
  }
  throw new Error("the query was accepted");
}

describe("parseTaskListQuery — defaults", () => {
  it("filters on nothing, sorts on -updatedAt and pages at 50", () => {
    const spec = parse({});

    expect(spec).toMatchObject({
      status: null,
      open: null,
      priority: null,
      labels: null,
      assignees: null,
      parentId: null,
      sizes: null,
      fields: [],
      q: null,
      updatedSince: null,
      limit: DEFAULT_LIMIT,
      after: null,
    });
    expect(spec.sort).toEqual([
      { field: "updatedAt", direction: "desc" },
      { field: "id", direction: "asc" },
    ]);
  });

  it("ignores a parameter it does not own, such as include=children", () => {
    expect(parse({ include: "children" }).signature).toBe(parse({}).signature);
  });
});

describe("parseTaskListQuery — the filters", () => {
  it("reads a csv and a repeated parameter the same way", () => {
    expect(parse({ status: "ready,executing" }).status).toEqual(["ready", "executing"]);
    expect(parse({ status: ["ready", "executing"] }).status).toEqual(["ready", "executing"]);
    expect(parse({ status: "ready, executing ,ready" }).status).toEqual(["ready", "executing"]);
  });

  it("refuses a value outside the vocabulary of its parameter", () => {
    expect(failure({ status: "shipped" })).toMatchObject({ code: "VALIDATION_FAILED", status: 400 });
    expect(failure({ priority: "critical" })).toMatchObject({ code: "VALIDATION_FAILED" });
    expect(failure({ size: "XXL" })).toMatchObject({ code: "VALIDATION_FAILED" });
    expect(failure({ open: "yes" })).toMatchObject({ code: "VALIDATION_FAILED" });
  });

  it("resolves parent through the caller's resolver", () => {
    expect(parse({ parent: "FEAT-3" }).parentId).toBe("id-of-FEAT-3");
  });

  it("normalises updatedSince to the stored timestamp form", () => {
    expect(parse({ updatedSince: "2026-01-02T03:04:05+00:00" }).updatedSince).toBe(
      "2026-01-02T03:04:05.000Z",
    );
    expect(failure({ updatedSince: "last tuesday" })).toMatchObject({ code: "VALIDATION_FAILED" });
  });

  it("expands a field value to the forms SQLite reads it back as", () => {
    expect(parse({ "field.points": "5" }).fields).toEqual([
      { key: "points", values: ["5"], matchesDefault: false },
    ]);
    expect(parse({ "field.shipped": "true" }).fields).toEqual([
      { key: "shipped", values: ["true", "1"], matchesDefault: false },
    ]);
  });

  it("marks a filter that selects the field's default (docs/03 rule 1)", () => {
    expect(parse({ "field.layer": "backend" }).fields[0]!.matchesDefault).toBe(true);
    expect(parse({ "field.layer": "frontend" }).fields[0]!.matchesDefault).toBe(false);
    // `shipped` defaults to false, so `false` must also select the tasks
    // that never stored a value for it.
    expect(parse({ "field.shipped": "false" }).fields[0]!.matchesDefault).toBe(true);
  });

  it("refuses a field key that is not snake_case", () => {
    expect(failure({ "field.Layer": "backend" })).toMatchObject({ code: "VALIDATION_FAILED" });
  });
});

describe("parseTaskListQuery — sort", () => {
  it("reads the - prefix as descending and always ends on the id", () => {
    expect(parse({ sort: "-priority,title" }).sort).toEqual([
      { field: "priority", direction: "desc" },
      { field: "title", direction: "asc" },
      { field: "id", direction: "asc" },
    ]);
  });

  it("keeps the first mention of a repeated column", () => {
    expect(parse({ sort: "title,-title" }).sort).toEqual([
      { field: "title", direction: "asc" },
      { field: "id", direction: "asc" },
    ]);
  });

  it("refuses a column that is not sortable", () => {
    expect(failure({ sort: "sourcePrompt" })).toMatchObject({
      code: "VALIDATION_FAILED",
      status: 400,
    });
  });
});

describe("parseTaskListQuery — limit", () => {
  it("accepts an integer inside the bounds", () => {
    expect(parse({ limit: "1" }).limit).toBe(1);
    expect(parse({ limit: String(MAX_LIMIT) }).limit).toBe(MAX_LIMIT);
  });

  it("refuses zero, a negative, a fraction and anything above the cap", () => {
    for (const limit of ["0", "-1", "2.5", "abc", String(MAX_LIMIT + 1)]) {
      expect(failure({ limit })).toMatchObject({ code: "VALIDATION_FAILED", status: 400 });
    }
  });
});

describe("parseTaskListQuery — cursor", () => {
  it("accepts a cursor issued for the same filters and sort", () => {
    const first = parse({ status: "ready", sort: "title" });
    const cursor = encodeCursor(first.signature, ["alpha", "id-1"]);

    expect(parse({ status: "ready", sort: "title", cursor }).after).toEqual(["alpha", "id-1"]);
  });

  it("refuses a cursor whose query changed", () => {
    const first = parse({ status: "ready", sort: "title" });
    const cursor = encodeCursor(first.signature, ["alpha", "id-1"]);

    expect(failure({ status: "done", sort: "title", cursor })).toMatchObject({
      code: "CURSOR_INVALID",
      status: 400,
    });
    expect(failure({ status: "ready", sort: "-title", cursor })).toMatchObject({
      code: "CURSOR_INVALID",
    });
  });

  it("refuses a cursor that is not one this service issued", () => {
    expect(failure({ cursor: "not-a-cursor" })).toMatchObject({ code: "CURSOR_INVALID" });
  });

  it("refuses a cursor whose values do not match the sort", () => {
    const spec = parse({});
    expect(failure({ cursor: encodeCursor(spec.signature, ["only-one"]) })).toMatchObject({
      code: "CURSOR_INVALID",
    });
  });

  it("changing only the limit keeps a cursor usable", () => {
    const spec = parse({ limit: "10" });
    const cursor = encodeCursor(spec.signature, ["2026-01-01T00:00:00.000Z", "id-1"]);

    expect(parse({ limit: "25", cursor }).after).toEqual(["2026-01-01T00:00:00.000Z", "id-1"]);
  });
});

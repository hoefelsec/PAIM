import { beforeEach, describe, expect, it } from "vitest";
import {
  buildFieldsSchema,
  clearValidatorCache,
  getValidator,
  invalidateValidator,
} from "../../../src/server/fields/validator.js";
import type { FieldDef } from "../../../src/shared/fields.js";

beforeEach(() => {
  clearValidatorCache();
});

const LAYER_SCHEMA: FieldDef[] = [
  { key: "layer", type: "select", options: ["frontend", "backend"] },
];

describe("getValidator", () => {
  it("returns the same object on repeated calls (cache reuse)", () => {
    const first = getValidator("project-a", LAYER_SCHEMA);
    const second = getValidator("project-a", LAYER_SCHEMA);

    expect(second).toBe(first);
  });

  it("ignores a changed schema argument while the cache entry is warm", () => {
    const first = getValidator("project-a", LAYER_SCHEMA);
    const differentSchema: FieldDef[] = [{ key: "estimate", type: "number" }];

    const second = getValidator("project-a", differentSchema);

    expect(second).toBe(first);
    // Proof the second call did not rebuild: `estimate` is not on the cached
    // schema, `layer` still is.
    expect(second.safeParse({ layer: "frontend" }).success).toBe(true);
    expect(second.safeParse({ estimate: 3 }).success).toBe(true); // passthrough, unknown key
  });

  it("rebuilds after invalidateValidator clears the entry", () => {
    const first = getValidator("project-a", LAYER_SCHEMA);
    invalidateValidator("project-a");
    const second = getValidator("project-a", LAYER_SCHEMA);

    expect(second).not.toBe(first);
  });

  it("validates two projects independently, with no cross-talk", () => {
    const projectA = getValidator("project-a", [
      { key: "layer", type: "select", options: ["frontend", "backend"] },
    ]);
    const projectB = getValidator("project-b", [{ key: "estimate", type: "number" }]);

    expect(projectA).not.toBe(projectB);

    // project A accepts its own field, with the right option pool.
    expect(projectA.safeParse({ layer: "frontend" }).success).toBe(true);
    expect(projectA.safeParse({ layer: "ops" }).success).toBe(false);

    // project B accepts its own field, typed as a number.
    expect(projectB.safeParse({ estimate: 5 }).success).toBe(true);
    expect(projectB.safeParse({ estimate: "five" }).success).toBe(false);

    // Invalidating one project's cache does not touch the other's.
    invalidateValidator("project-a");
    const rebuiltA = getValidator("project-a", [
      { key: "layer", type: "select", options: ["frontend", "backend"] },
    ]);
    expect(rebuiltA).not.toBe(projectA);
    expect(getValidator("project-b", [])).toBe(projectB);
  });

  it("built from an empty schema for an unseen project id, so a cold cache never throws", () => {
    const validator = getValidator("fresh-project", []);
    expect(validator.safeParse({}).success).toBe(true);
  });
});

describe("buildFieldsSchema", () => {
  it("builds an always-fresh, uncached schema", () => {
    const a = buildFieldsSchema(LAYER_SCHEMA);
    const b = buildFieldsSchema(LAYER_SCHEMA);
    expect(a).not.toBe(b);
  });

  it("validates each field type per docs/03 release 1", () => {
    const schema = buildFieldsSchema([
      { key: "title", type: "text" },
      { key: "notes", type: "long_text" },
      { key: "estimate", type: "number" },
      { key: "done", type: "checkbox" },
      { key: "due", type: "date" },
      { key: "site", type: "url" },
      { key: "layer", type: "select", options: ["frontend", "backend"] },
      { key: "tags", type: "multi_select", options: ["a", "b"] },
    ]);

    expect(
      schema.safeParse({
        title: "hello",
        notes: "long",
        estimate: 3,
        done: true,
        due: "2026-08-06",
        site: "https://example.com",
        layer: "frontend",
        tags: ["a", "b"],
      }).success,
    ).toBe(true);

    expect(schema.safeParse({ estimate: "3" }).success).toBe(false);
    expect(schema.safeParse({ done: "yes" }).success).toBe(false);
    expect(schema.safeParse({ due: "not-a-date" }).success).toBe(false);
    expect(schema.safeParse({ site: "not-a-url" }).success).toBe(false);
    expect(schema.safeParse({ layer: "ops" }).success).toBe(false);
    expect(schema.safeParse({ tags: ["ops"] }).success).toBe(false);
  });

  it("accepts a select/multi_select field with no options pool as a plain string", () => {
    const schema = buildFieldsSchema([
      { key: "layer", type: "select" },
      { key: "tags", type: "multi_select" },
    ]);

    expect(schema.safeParse({ layer: "anything", tags: ["a", "b"] }).success).toBe(true);
  });

  it("drops hidden fields from the built schema (they are no longer offered to writes)", () => {
    const schema = buildFieldsSchema([{ key: "layer", type: "text", hidden: true }]);

    // Unknown/hidden keys pass through untouched; rule 4 is enforced elsewhere.
    expect(schema.safeParse({ layer: 42 }).success).toBe(true);
  });

  it("treats every field as optional and nullable (required is advisory, rule 5)", () => {
    const schema = buildFieldsSchema([{ key: "layer", type: "text", required: true }]);

    expect(schema.safeParse({}).success).toBe(true);
    expect(schema.safeParse({ layer: null }).success).toBe(true);
  });
});

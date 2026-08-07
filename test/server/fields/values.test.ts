import { describe, expect, it } from "vitest";
import { ApiError } from "../../../src/server/errors.js";
import { columnFields, facetFields, findField } from "../../../src/server/fields/schema.js";
import { readFields, resolveFieldWrite } from "../../../src/server/fields/values.js";
import type { FieldDef } from "../../../src/shared/fields.js";

function thrownBy(run: () => unknown): ApiError {
  try {
    run();
  } catch (err) {
    expect(err).toBeInstanceOf(ApiError);
    return err as ApiError;
  }
  throw new Error("the call was expected to throw");
}

const schema: FieldDef[] = [
  { key: "layer", type: "select", options: ["frontend", "backend"], order: 1, showInTable: true },
  { key: "notes", type: "long_text", order: 2 },
];

describe("rule 4 — an unknown key is refused", () => {
  it("throws 400 FIELD_UNKNOWN with the key in details", () => {
    const err = thrownBy(() => resolveFieldWrite(schema, { estimate: 3 }));

    expect(err.code).toBe("FIELD_UNKNOWN");
    expect(err.status).toBe(400);
    expect(err.details).toMatchObject({ key: "estimate" });
  });

  it("accepts a key the schema defines but has hidden", () => {
    const hidden: FieldDef[] = [{ key: "layer", type: "select", hidden: true }];
    const write = resolveFieldWrite(hidden, { layer: "backend" });

    expect(write.schemaChanged).toBe(false);
    expect(write.warnings).toEqual([]);
  });

  it("creates a hidden text field with ?allowUnknownFields=true", () => {
    const write = resolveFieldWrite(schema, { estimate: "3d" }, { allowUnknownFields: true });

    expect(write.schemaChanged).toBe(true);
    expect(findField(write.fieldSchema, "estimate")).toMatchObject({
      key: "estimate",
      label: "Estimate",
      type: "text",
      hidden: true,
      showInTable: false,
      showAsFacet: false,
      order: 3,
    });
    expect(write.warnings).toEqual(['field "estimate" was created as a hidden text field']);
  });

  it("makes the created field neither a column nor a facet", () => {
    const { fieldSchema } = resolveFieldWrite(
      schema,
      { estimate: "3d" },
      { allowUnknownFields: true },
    );

    expect(columnFields(fieldSchema).map((f) => f.key)).toEqual(["layer"]);
    expect(facetFields(fieldSchema)).toEqual([]);
  });

  it("still refuses a key that is not snake_case", () => {
    const err = thrownBy(() =>
      resolveFieldWrite(schema, { "My Estimate": 1 }, { allowUnknownFields: true }),
    );

    expect(err.code).toBe("VALIDATION_FAILED");
    expect(err.status).toBe(400);
  });

  it("leaves the schema untouched when every key is known", () => {
    const write = resolveFieldWrite(schema, { layer: "backend" });

    expect(write.schemaChanged).toBe(false);
    expect(write.fieldSchema).toEqual(schema);
  });
});

describe("rule 5 — required is advisory", () => {
  const required: FieldDef[] = [{ key: "layer", type: "text", required: true }];

  it("lets a write that omits the field succeed, with a warning", () => {
    const write = resolveFieldWrite(required, {});

    expect(write.warnings).toEqual(['field "layer" is required and has no value']);
  });

  it("reports nothing when the write supplies the value", () => {
    expect(resolveFieldWrite(required, { layer: "backend" }).warnings).toEqual([]);
  });

  it("reports nothing when the record already holds the value", () => {
    const write = resolveFieldWrite(required, {}, { existing: { layer: "backend" } });

    expect(write.warnings).toEqual([]);
  });

  it("reports nothing when the field has a default", () => {
    const withDefault: FieldDef[] = [{ key: "layer", type: "text", required: true, default: "ui" }];

    expect(resolveFieldWrite(withDefault, {}).warnings).toEqual([]);
  });

  it("says nothing about a required field that is hidden", () => {
    const hidden: FieldDef[] = [{ key: "layer", type: "text", required: true, hidden: true }];

    expect(resolveFieldWrite(hidden, {}).warnings).toEqual([]);
  });
});

describe("reading the fields object", () => {
  it("returns the default of a field with no stored value, or null (rule 1)", () => {
    const withDefault: FieldDef[] = [
      { key: "layer", type: "text", default: "backend" },
      { key: "notes", type: "long_text" },
    ];

    expect(readFields(withDefault, {})).toEqual({ layer: "backend", notes: null });
  });

  it("returns the stored value of a hidden field (rule 2 keeps data)", () => {
    const hidden: FieldDef[] = [{ key: "layer", type: "text", hidden: true }];

    expect(readFields(hidden, { layer: "backend" })).toEqual({ layer: "backend" });
  });

  it("does not invent a value for a hidden field", () => {
    const hidden: FieldDef[] = [{ key: "layer", type: "text", hidden: true, default: "ui" }];

    expect(readFields(hidden, {})).toEqual({});
  });
});

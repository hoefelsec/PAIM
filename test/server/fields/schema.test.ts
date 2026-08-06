import { describe, expect, it } from "vitest";
import { ApiError } from "../../../src/server/errors.js";
import {
  applySchemaWrite,
  columnFields,
  facetFields,
  findField,
  parseFieldDef,
  parseFieldSchema,
  schemaView,
} from "../../../src/server/fields/schema.js";
import { FIELD_TYPES, TYPE_OPTIONS, TYPE_POOL, type FieldDef } from "../../../src/shared/fields.js";

/** The error an engine call threw, or a failure if it threw nothing. */
function thrownBy(run: () => unknown): ApiError {
  try {
    run();
  } catch (err) {
    expect(err).toBeInstanceOf(ApiError);
    return err as ApiError;
  }
  throw new Error("the call was expected to throw");
}

const layer: FieldDef = {
  key: "layer",
  label: "Layer",
  type: "select",
  options: ["frontend", "backend"],
  order: 1,
  showInTable: true,
  showAsFacet: true,
};

describe("parseFieldDef", () => {
  it("accepts every release-1 type", () => {
    for (const type of FIELD_TYPES) {
      expect(parseFieldDef({ key: "a_field", type }, "f").type).toBe(type);
    }
  });

  it("keeps only the properties the caller supplied", () => {
    expect(parseFieldDef({ key: "notes", type: "long_text", order: 2 }, "f")).toEqual({
      key: "notes",
      type: "long_text",
      order: 2,
    });
  });

  it("refuses a key that is not snake_case", () => {
    for (const key of ["Layer", "my-field", "2fast", "my field", ""]) {
      const err = thrownBy(() => parseFieldDef({ key, type: "text" }, "f"));
      expect(err.code, key).toBe("VALIDATION_FAILED");
      expect(err.status).toBe(400);
    }
  });

  it("refuses a type outside release 1", () => {
    const err = thrownBy(() => parseFieldDef({ key: "owner", type: "person" }, "f"));

    expect(err.code).toBe("VALIDATION_FAILED");
    expect(err.details).toMatchObject({ field: "f.type", value: "person" });
  });

  it("refuses options on a field that is not a select", () => {
    const err = thrownBy(() => parseFieldDef({ key: "notes", type: "text", options: ["a"] }, "f"));

    expect(err.details).toMatchObject({ field: "f.options" });
  });

  it("refuses an unknown property", () => {
    const err = thrownBy(() => parseFieldDef({ key: "notes", type: "text", widget: "x" }, "f"));

    expect(err.code).toBe("UNKNOWN_PROPERTY");
    expect(err.details).toMatchObject({ field: "f.widget" });
  });

  it("refuses the same key twice in one schema", () => {
    const err = thrownBy(() =>
      parseFieldSchema([
        { key: "layer", type: "text" },
        { key: "layer", type: "text" },
      ]),
    );

    expect(err.details).toMatchObject({ key: "layer" });
  });
});

describe("the field view", () => {
  it("completes a sparse definition with the documented defaults", () => {
    expect(schemaView([{ key: "notes", type: "long_text" }])).toEqual([
      {
        key: "notes",
        label: "Notes",
        type: "long_text",
        options: null,
        required: false,
        default: null,
        order: 0,
        showInTable: false,
        showAsFacet: false,
        description: "",
        hidden: false,
      },
    ]);
  });
});

describe("rule 1 — adding a field is always allowed", () => {
  it("appends the field to an empty schema", () => {
    const { fieldSchema, warnings } = applySchemaWrite([], { fields: [layer] });

    expect(fieldSchema).toHaveLength(1);
    expect(findField(fieldSchema, "layer")).toMatchObject({
      key: "layer",
      type: "select",
      options: ["frontend", "backend"],
      hidden: false,
    });
    expect(warnings).toEqual([]);
  });

  it("adds a second field next in order without touching the first", () => {
    const first = applySchemaWrite([], { fields: [{ key: "layer", type: "select" }] }).fieldSchema;
    const { fieldSchema } = applySchemaWrite(first, { fields: [{ key: "notes", type: "text" }] });

    expect(schemaView(fieldSchema).map((f) => [f.key, f.order])).toEqual([
      ["layer", 1],
      ["notes", 2],
    ]);
  });

  it("warns that existing tasks hold no value for a new required field", () => {
    const { warnings } = applySchemaWrite([], {
      fields: [{ key: "layer", type: "text", required: true }],
    });

    expect(warnings).toEqual([
      'field "layer" is required; tasks written before now hold no value for it',
    ]);
  });
});

describe("rule 2 — removing a field hides it", () => {
  it("marks the definition hidden and keeps it in the schema", () => {
    const { fieldSchema, warnings } = applySchemaWrite([layer], { remove: ["layer"] });

    expect(fieldSchema).toHaveLength(1);
    expect(findField(fieldSchema, "layer")).toMatchObject({ hidden: true, type: "select" });
    expect(warnings[0]).toContain('field "layer" is hidden');
  });

  it("drops a hidden field from the columns and the facets", () => {
    expect(columnFields([layer]).map((f) => f.key)).toEqual(["layer"]);
    expect(facetFields([layer]).map((f) => f.key)).toEqual(["layer"]);

    const { fieldSchema } = applySchemaWrite([layer], { remove: ["layer"] });

    expect(columnFields(fieldSchema)).toEqual([]);
    expect(facetFields(fieldSchema)).toEqual([]);
  });

  it("shows the field again when the same definition is sent back", () => {
    const removed = applySchemaWrite([layer], { remove: ["layer"] }).fieldSchema;
    const { fieldSchema } = applySchemaWrite(removed, {
      fields: [{ key: "layer", type: "select" }],
    });

    expect(findField(fieldSchema, "layer")).toMatchObject({
      hidden: false,
      showInTable: true,
      showAsFacet: true,
      options: ["frontend", "backend"],
    });
  });

  it("refuses to remove a key the schema does not define", () => {
    const err = thrownBy(() => applySchemaWrite([layer], { remove: ["estimate"] }));

    expect(err.code).toBe("FIELD_UNKNOWN");
    expect(err.status).toBe(400);
    expect(err.details).toMatchObject({ key: "estimate" });
  });
});

describe("rule 3 — a change of type is refused", () => {
  it("throws 422 FIELD_TYPE_IMMUTABLE and names the key", () => {
    const err = thrownBy(() =>
      applySchemaWrite([layer], { fields: [{ key: "layer", type: "text" }] }),
    );

    expect(err.code).toBe("FIELD_TYPE_IMMUTABLE");
    expect(err.status).toBe(422);
    expect(err.details).toMatchObject({ key: "layer", type: "select", requested: "text" });
  });

  it("accepts a change of every other property", () => {
    const { fieldSchema } = applySchemaWrite([layer], {
      fields: [
        {
          key: "layer",
          type: "select",
          label: "Stack layer",
          options: ["frontend", "backend", "infra"],
          showInTable: false,
          description: "The part of the stack that the work changes",
        },
      ],
    });

    expect(findField(fieldSchema, "layer")).toMatchObject({
      label: "Stack layer",
      options: ["frontend", "backend", "infra"],
      showInTable: false,
      showAsFacet: true,
      description: "The part of the stack that the work changes",
    });
  });
});

describe("the write body", () => {
  it("reads a bare array as the list of fields", () => {
    const { fieldSchema } = applySchemaWrite([], [{ key: "layer", type: "text" }]);

    expect(fieldSchema.map((f) => f.key)).toEqual(["layer"]);
  });

  it("refuses a body with neither fields nor remove", () => {
    expect(thrownBy(() => applySchemaWrite([], {})).code).toBe("VALIDATION_FAILED");
  });

  it("refuses a property that is not fields or remove", () => {
    const err = thrownBy(() => applySchemaWrite([], { statuses: ["done"] }));

    expect(err.code).toBe("UNKNOWN_PROPERTY");
    expect(err.details).toMatchObject({ field: "statuses" });
  });
});

describe("facets", () => {
  it("holds only select and multi_select fields (docs/03)", () => {
    const schema: FieldDef[] = [
      { key: "layer", type: "select", showAsFacet: true },
      { key: "tags", type: "multi_select", showAsFacet: true },
      { key: "notes", type: "text", showAsFacet: true },
    ];

    expect(facetFields(schema).map((f) => f.key)).toEqual(["layer", "tags"]);
  });
});

describe("T09 — The type pool", () => {
  it("exports the type pool constant", () => {
    expect(TYPE_POOL).toEqual({
      feature: "FEAT",
      bug: "BUG",
      chore: "CHORE",
      spike: "SPIKE",
      debt: "DEBT",
    });
  });

  it("exports TYPE_OPTIONS as all pool keys", () => {
    expect(TYPE_OPTIONS).toEqual(["feature", "bug", "chore", "spike", "debt"]);
  });

  it("accepts valid type field options from the pool", () => {
    const typeDef = parseFieldDef(
      {
        key: "type",
        type: "select",
        options: ["feature", "bug"],
      },
      "f",
    );

    expect(typeDef.options).toEqual(["feature", "bug"]);
  });

  it("accepts all pool options in a type field", () => {
    const typeDef = parseFieldDef(
      {
        key: "type",
        type: "multi_select",
        options: ["feature", "bug", "chore", "spike", "debt"],
      },
      "f",
    );

    expect(typeDef.options).toEqual(["feature", "bug", "chore", "spike", "debt"]);
  });

  it("rejects type field options outside the pool with 422 TYPE_OPTION_UNKNOWN", () => {
    const err = thrownBy(() =>
      parseFieldDef(
        {
          key: "type",
          type: "select",
          options: ["feature", "unknown"],
        },
        "f",
      ),
    );

    expect(err.code).toBe("TYPE_OPTION_UNKNOWN");
    expect(err.status).toBe(422);
    expect(err.details).toMatchObject({
      options: ["unknown"],
      allowed: ["feature", "bug", "chore", "spike", "debt"],
    });
  });

  it("rejects a type field with only invalid options", () => {
    const err = thrownBy(() =>
      parseFieldDef(
        {
          key: "type",
        type: "select",
          options: ["custom", "proprietary"],
        },
        "f",
      ),
    );

    expect(err.code).toBe("TYPE_OPTION_UNKNOWN");
    expect(err.details).toMatchObject({
      options: ["custom", "proprietary"],
    });
  });

  it("allows options on non-type select fields outside the pool", () => {
    // Non-type fields can have arbitrary options
    const layerDef = parseFieldDef(
      {
        key: "layer",
        type: "select",
        options: ["frontend", "backend", "custom_layer"],
      },
      "f",
    );

    expect(layerDef.options).toEqual(["frontend", "backend", "custom_layer"]);
  });

  it("rejects type field option mutations via schema write", () => {
    const current: FieldDef[] = [
      {
        key: "type",
        type: "select",
        options: ["feature", "bug"],
      },
    ];

    const err = thrownBy(() =>
      applySchemaWrite(current, {
        fields: [
          {
            key: "type",
            type: "select",
            options: ["feature", "bug", "badoption"],
          },
        ],
      }),
    );

    expect(err.code).toBe("TYPE_OPTION_UNKNOWN");
    expect(err.status).toBe(422);
  });
});

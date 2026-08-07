/* The model behind inline editing (docs/07 "Editing", T21).
 *
 * Which columns take an editor, which control each one takes, what the
 * control reads, and what the write says. All of it is pure, so none of it
 * needs a DOM.
 */

import { describe, expect, it } from "vitest";
import { columnEditors, isNoop, mergeTask, type EditorSpec } from "../../src/app/edit";
import { tableColumns } from "../../src/app/table";
import { PRIORITY_LABEL, SIZE_LABEL, TYPE_LABEL } from "../../src/ui/vocabulary";
import { makeTask } from "./harness";
import type { FieldDef } from "../../src/shared/fields.js";

const SCHEMA: FieldDef[] = [
  { key: "type", type: "select", options: ["feature", "bug"] },
  { key: "layer", type: "select", options: ["api", "ui"], showInTable: true, label: "Layer" },
  { key: "points", type: "number", showInTable: true, order: 2 },
  { key: "areas", type: "multi_select", options: ["api", "ui"], showInTable: true, order: 3 },
  { key: "spike", type: "checkbox", showInTable: true, order: 4 },
  { key: "spec_url", type: "url", showInTable: true, order: 5 },
];

const editors = (schema: FieldDef[] = SCHEMA) => columnEditors(tableColumns(schema), schema);

/** The editor of one column, or a failure that names the column. */
function editor(columnId: string, schema: FieldDef[] = SCHEMA): EditorSpec {
  const spec = editors(schema).get(columnId);
  if (!spec) throw new Error(`no editor for ${columnId}`);
  return spec;
}

const values = (spec: EditorSpec) => spec.options.map((option) => option.value);

describe("which columns edit", () => {
  it("edits every column but the key and the timestamp", () => {
    expect([...editors().keys()]).toEqual([
      "title",
      "priority",
      "type",
      "size",
      "field.layer",
      "field.points",
      "field.areas",
      "field.spike",
      "field.spec_url",
    ]);
  });

  it("leaves the key alone: it is permanent, and it is in URLs", () => {
    expect(editors().get("key")).toBeUndefined();
    expect(editors().get("updated")).toBeUndefined();
  });
});

describe("enum-like columns take a menu", () => {
  it("offers the five priorities by name", () => {
    const spec = editor("priority");
    expect(spec.kind).toBe("select");
    expect(values(spec)).toEqual(["none", "low", "medium", "high", "urgent"]);
    expect(spec.options[4]?.label).toBe(PRIORITY_LABEL.urgent);
  });

  it("offers Epic on the size menu — kind follows the size (docs/02)", () => {
    const spec = editor("size");
    expect(values(spec)).toEqual(["XS", "S", "M", "L", "XL", "Epic"]);
    expect(spec.options[5]?.label).toBe(SIZE_LABEL.Epic);
  });

  it("takes the type menu from the project, and keeps a clear choice", () => {
    const spec = editor("type");
    expect(values(spec)).toEqual(["", "feature", "bug"]);
    expect(spec.options[1]?.label).toBe(TYPE_LABEL.feature);
    expect(spec.patch("bug")).toEqual({ fields: { type: "bug" } });
    expect(spec.patch("")).toEqual({ fields: { type: null } });
  });

  it("falls back to the pool when the project has no type field", () => {
    const spec = editor("type", [{ key: "layer", type: "text" }]);
    expect(values(spec)).toEqual(["", "feature", "bug", "chore", "spike", "debt"]);
  });

  it("offers a select field's options, plus a clear choice", () => {
    const spec = editor("field.layer");
    expect(spec.label).toBe("Layer");
    expect(values(spec)).toEqual(["", "api", "ui"]);
    expect(spec.patch("ui")).toEqual({ fields: { layer: "ui" } });
    expect(spec.patch("")).toEqual({ fields: { layer: null } });
  });

  it("makes a checkbox a Yes/No menu, not a word to type", () => {
    const spec = editor("field.spike");
    expect(spec.kind).toBe("select");
    expect(spec.options.map((option) => option.label)).toEqual(["—", "Yes", "No"]);
    expect(spec.patch("true")).toEqual({ fields: { spike: true } });
    expect(spec.patch("false")).toEqual({ fields: { spike: false } });
    expect(spec.patch("")).toEqual({ fields: { spike: null } });
    expect(spec.read(makeTask({ fields: { spike: true } }))).toBe("true");
    expect(spec.read(makeTask({ fields: {} }))).toBe("");
  });
});

describe("everything else takes a text input", () => {
  it("writes the title trimmed, and lets the service refuse an empty one", () => {
    const spec = editor("title");
    expect(spec.kind).toBe("text");
    expect(spec.read(makeTask({ title: "Cursor pagination" }))).toBe("Cursor pagination");
    expect(spec.patch("  Cursor pagination  ")).toEqual({ title: "Cursor pagination" });
    expect(spec.patch("")).toEqual({ title: "" });
  });

  it("parses a number, and passes a typo through for the service to refuse", () => {
    const spec = editor("field.points");
    expect(spec.kind).toBe("number");
    expect(spec.patch("12")).toEqual({ fields: { points: 12 } });
    expect(spec.patch("")).toEqual({ fields: { points: null } });
    expect(spec.patch("twelve")).toEqual({ fields: { points: "twelve" } });
  });

  it("reads and writes a multi_select as the comma list the cell prints", () => {
    const spec = editor("field.areas");
    expect(spec.kind).toBe("text");
    expect(spec.read(makeTask({ fields: { areas: ["api", "ui"] } }))).toBe("api, ui");
    expect(spec.patch("api, ui")).toEqual({ fields: { areas: ["api", "ui"] } });
    expect(spec.patch("")).toEqual({ fields: { areas: [] } });
  });

  it("treats a url as text", () => {
    expect(editor("field.spec_url").kind).toBe("text");
  });
});

describe("the optimistic copy", () => {
  const task = makeTask({ title: "Old", priority: "low", size: "M", fields: { layer: "api" } });

  it("merges the core shallowly and leaves the rest of the row alone", () => {
    const next = mergeTask(task, { title: "New" });
    expect(next.title).toBe("New");
    expect(next.priority).toBe("low");
    expect(next.key).toBe(task.key);
    // The service stamps the timestamp; a guess here would break the next
    // If-Match on a write that succeeded.
    expect(next.updatedAt).toBe(task.updatedAt);
    expect(task.title).toBe("Old");
  });

  it("merges fields shallowly, and keeps a null as the clear it is", () => {
    const next = mergeTask(task, { fields: { size_note: "x", layer: null } });
    expect(next.fields).toEqual({ layer: null, size_note: "x" });
  });

  it("derives kind from the size, the way docs/02 does", () => {
    expect(mergeTask(task, { size: "Epic" }).kind).toBe("epic");
    expect(mergeTask({ ...task, size: "Epic", kind: "epic" }, { size: "L" }).kind).toBe("task");
  });
});

describe("a write that changes nothing", () => {
  const task = makeTask({ title: "Cursor pagination", fields: { areas: ["api", "ui"] } });

  it("is not a write", () => {
    expect(isNoop(editor("title"), task, "Cursor pagination")).toBe(true);
    expect(isNoop(editor("title"), task, "  Cursor pagination ")).toBe(true);
    expect(isNoop(editor("field.areas"), task, "api,  ui")).toBe(true);
  });

  it("does not swallow a real change", () => {
    expect(isNoop(editor("title"), task, "Cursor pagination v2")).toBe(false);
    expect(isNoop(editor("field.areas"), task, "api")).toBe(false);
  });
});

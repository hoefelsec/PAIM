/* The table's model: columns, grouping, epic counts, custom values. */

import { describe, expect, it } from "vitest";
import {
  buildTable,
  epicProgress,
  epicProgressText,
  formatFieldValue,
  tableColumns,
} from "../../src/app/table";
import { fieldView } from "../../src/shared/fields.js";
import { DEFAULT_STATUSES } from "../../src/shared/statuses.js";
import { makeTask } from "./harness";

describe("columns", () => {
  it("holds the six fixed columns, Updated last", () => {
    const ids = tableColumns([]).map((column) => column.id);
    expect(ids).toEqual(["key", "title", "priority", "type", "size", "updated"]);
  });

  it("adds one column per showInTable field, in schema order, before Updated", () => {
    const columns = tableColumns([
      { key: "layer", type: "select", options: ["api", "ui"], showInTable: true, order: 2 },
      { key: "spec_url", type: "url", showInTable: true, order: 1, label: "Spec" },
      { key: "notes", type: "long_text", showInTable: false },
    ]);

    expect(columns.map((column) => column.id)).toEqual([
      "key",
      "title",
      "priority",
      "type",
      "size",
      "field.spec_url",
      "field.layer",
      "updated",
    ]);
    expect(columns[5]?.label).toBe("Spec");
    // A field with no label reads as its humanised key (docs/03).
    expect(columns[6]?.label).toBe("Layer");
  });

  it("never doubles the Type column, and drops a removed field", () => {
    const columns = tableColumns([
      { key: "type", type: "select", options: ["bug"], showInTable: true },
      { key: "gone", type: "text", showInTable: true, hidden: true },
    ]);
    expect(columns.map((column) => column.id)).toEqual([
      "key",
      "title",
      "priority",
      "type",
      "size",
      "updated",
    ]);
  });
});

describe("custom values", () => {
  const def = (over: Parameters<typeof fieldView>[0]) => fieldView(over);

  it("prints a select, a number and a multi_select as the cell shows them", () => {
    expect(formatFieldValue(def({ key: "layer", type: "select" }), "storage")).toBe("storage");
    expect(formatFieldValue(def({ key: "points", type: "number" }), 12)).toBe("12");
    expect(formatFieldValue(def({ key: "areas", type: "multi_select" }), ["api", "ui"])).toBe(
      "api, ui",
    );
  });

  it("prints a checkbox as a tick, and an absent value as nothing", () => {
    const flag = def({ key: "spike", type: "checkbox" });
    expect(formatFieldValue(flag, true)).toBe("✓");
    expect(formatFieldValue(flag, false)).toBe("");
    expect(formatFieldValue(flag, null)).toBe("");
    expect(formatFieldValue(def({ key: "layer", type: "select" }), undefined)).toBe("");
  });
});

describe("grouping", () => {
  it("groups by status in pipeline order and skips the empty statuses", () => {
    const model = buildTable(
      [
        makeTask({ status: "ready" }),
        makeTask({ status: "backlog" }),
        makeTask({ status: "executing" }),
        makeTask({ status: "ready" }),
      ],
      DEFAULT_STATUSES,
    );

    expect(model.groups.map((group) => group.status)).toEqual([
      "backlog",
      "ready",
      "executing",
    ]);
    expect(model.groups.map((group) => group.tasks.length)).toEqual([1, 2, 1]);
  });

  it("keeps the order the service returned inside a group", () => {
    const first = makeTask({ status: "ready", key: "FEAT-1" });
    const second = makeTask({ status: "ready", key: "FEAT-2" });
    const model = buildTable([second, first], DEFAULT_STATUSES);
    expect(model.groups[0]?.tasks.map((task) => task.key)).toEqual(["FEAT-2", "FEAT-1"]);
  });

  it("still groups a status the pipeline no longer holds", () => {
    const model = buildTable([makeTask({ status: "cancelled" })], DEFAULT_STATUSES);
    expect(model.groups.map((group) => group.status)).toEqual(["cancelled"]);
  });

  it("files a child under its epic instead of in its own status group", () => {
    const epic = makeTask({ id: "e1", key: "FEAT-20", size: "Epic", status: "executing" });
    const child = makeTask({ id: "c1", key: "BUG-21", parentId: "e1", status: "ready" });

    const model = buildTable([epic, child], DEFAULT_STATUSES);

    expect(model.groups.map((group) => group.status)).toEqual(["executing"]);
    expect(model.childrenOf.get("e1")?.map((task) => task.key)).toEqual(["BUG-21"]);
    expect(model.total).toBe(2);
  });

  it("leaves a child whose epic is not loaded as a row of its own", () => {
    const orphan = makeTask({ key: "BUG-9", parentId: "missing", status: "ready" });
    const model = buildTable([orphan], DEFAULT_STATUSES);
    expect(model.groups[0]?.tasks.map((task) => task.key)).toEqual(["BUG-9"]);
  });

  it("stays linear on a thousand tasks", () => {
    const tasks = Array.from({ length: 1000 }, (_, i) =>
      makeTask({ status: i % 2 === 0 ? "ready" : "executing" }),
    );
    const started = performance.now();
    const model = buildTable(tasks, DEFAULT_STATUSES);
    expect(performance.now() - started).toBeLessThan(200);
    expect(model.total).toBe(1000);
  });
});

describe("epic progress", () => {
  it("reads the counts the service computed", () => {
    const epic = makeTask({ size: "Epic", progress: { done: 3, cancelled: 0, total: 7 } });
    expect(epicProgressText(epicProgress(epic, new Map()))).toBe("3/7 done");
  });

  it("reports the cancelled children as well", () => {
    const epic = makeTask({ size: "Epic", progress: { done: 5, cancelled: 2, total: 7 } });
    expect(epicProgressText(epicProgress(epic, new Map()))).toBe("5/7 done, 2 cancelled");
  });

  it("counts the loaded children when the record carries no progress", () => {
    const epic = makeTask({ id: "e1", size: "Epic" });
    const children = [
      makeTask({ parentId: "e1", status: "done" }),
      makeTask({ parentId: "e1", status: "cancelled" }),
      makeTask({ parentId: "e1", status: "ready" }),
    ];
    expect(epicProgress(epic, new Map([["e1", children]]))).toEqual({
      done: 1,
      cancelled: 1,
      total: 3,
    });
  });

  it("says 0/0 for an epic with no children, never 'all done'", () => {
    const epic = makeTask({ id: "e2", size: "Epic" });
    expect(epicProgressText(epicProgress(epic, new Map()))).toBe("0/0 done");
  });
});

/* The facet model behind the left rail (docs/07 "Filter facets", T20).
 *
 * Pure functions only: facet generation from the project, the query-string
 * round trip, matching and the live counts. The rail itself is checked in
 * facet-rail.test.tsx.
 */

import { describe, expect, it } from "vitest";
import { makeProject, makeTask } from "./harness";
import {
  activeFilterCount,
  buildFacets,
  facetCounts,
  filterTasks,
  isFilterParam,
  matchesFilters,
  parseFilters,
  serializeFilters,
  toggleFilter,
  visibleOptions,
  type Facet,
} from "../../src/app/facets";
import type { FieldDef } from "../../src/shared/fields.js";

const TYPE_FIELD: FieldDef = {
  key: "type",
  type: "select",
  options: ["feature", "bug", "chore", "spike", "debt"],
  showAsFacet: true,
  order: 1,
};

const LAYER_FIELD: FieldDef = {
  key: "layer",
  type: "select",
  options: ["api", "ui"],
  label: "Layer",
  showAsFacet: true,
  order: 2,
};

const PAIM = makeProject({
  slug: "paim",
  statuses: ["backlog", "open_questions", "design", "ready", "executing", "done"],
  fieldSchema: [TYPE_FIELD, LAYER_FIELD],
});

/** A second workspace with no `layer` — the rail must differ (docs/07). */
const HOMELAB = makeProject({
  slug: "homelab",
  statuses: ["backlog", "open_questions", "design", "ready", "executing", "done"],
  fieldSchema: [TYPE_FIELD],
});

const TASKS = [
  makeTask({
    id: "a",
    key: "FEAT-1",
    status: "ready",
    priority: "high",
    size: "M",
    labels: ["backend", "api"],
    assignee: "edu",
    fields: { type: "feature", layer: "api" },
  }),
  makeTask({
    id: "b",
    key: "BUG-2",
    status: "executing",
    priority: "urgent",
    size: "S",
    labels: ["backend"],
    assignee: "edu",
    fields: { type: "bug", layer: "api" },
  }),
  makeTask({
    id: "c",
    key: "CHORE-3",
    status: "ready",
    priority: "low",
    size: "L",
    labels: [],
    assignee: null,
    fields: { type: "chore", layer: "ui" },
  }),
];

function facet(facets: readonly Facet[], id: string): Facet {
  const found = facets.find((entry) => entry.id === id);
  if (!found) throw new Error(`no facet ${id}; got ${facets.map((f) => f.id).join(", ")}`);
  return found;
}

describe("facet generation", () => {
  it("builds the core facets plus every showAsFacet select field", () => {
    const ids = buildFacets(PAIM, TASKS).map((f) => f.id);
    expect(ids).toEqual([
      "status",
      "priority",
      "size",
      "label",
      "assignee",
      "field.type",
      "field.layer",
    ]);
  });

  it("shows a project's layer facet and leaves it out of a project without one", () => {
    expect(buildFacets(PAIM, TASKS).map((f) => f.id)).toContain("field.layer");
    expect(buildFacets(HOMELAB, TASKS).map((f) => f.id)).not.toContain("field.layer");
    // No hardcoded list: the facet is gone, but the field-driven ones remain.
    expect(buildFacets(HOMELAB, TASKS).map((f) => f.id)).toContain("field.type");
  });

  it("labels each head with its source: core, pipeline, or schema", () => {
    const facets = buildFacets(PAIM, TASKS);
    expect(facet(facets, "status").source).toBe("pipeline");
    expect(facet(facets, "priority").source).toBe("core");
    expect(facet(facets, "assignee").source).toBe("core");
    expect(facet(facets, "field.layer").source).toBe("schema");
  });

  it("takes the status options from the project's pipeline, in catalogue order", () => {
    const options = facet(buildFacets(PAIM, TASKS), "status").options;
    expect(options.map((o) => o.value)).toEqual([
      "backlog",
      "open_questions",
      "design",
      "ready",
      "executing",
      "done",
    ]);
    expect(options[3]?.label).toBe("Ready");
  });

  it("keeps a status a task still holds after the pipeline dropped it", () => {
    const dropped = makeTask({ id: "d", status: "manual_review" });
    const options = facet(buildFacets(PAIM, [...TASKS, dropped]), "status").options;
    expect(options.map((o) => o.value)).toContain("manual_review");
  });

  it("skips fields that are not facets: no showAsFacet, not a select, hidden", () => {
    const project = makeProject({
      slug: "x",
      fieldSchema: [
        { key: "layer", type: "select", options: ["api"], showAsFacet: false },
        { key: "owner", type: "text", showAsFacet: true },
        { key: "area", type: "select", options: ["a"], showAsFacet: true, hidden: true },
        { key: "tags", type: "multi_select", options: ["x"], showAsFacet: true },
      ],
    });
    const ids = buildFacets(project, []).map((f) => f.id);
    expect(ids).not.toContain("field.layer");
    expect(ids).not.toContain("field.owner");
    expect(ids).not.toContain("field.area");
    // A multi_select is a facet: its values come from `options` too (docs/03).
    expect(ids).toContain("field.tags");
  });

  it("derives labels and assignees from the loaded tasks", () => {
    const facets = buildFacets(PAIM, TASKS);
    expect(facet(facets, "label").options.map((o) => o.value)).toEqual(["api", "backend"]);
    expect(facet(facets, "assignee").options.map((o) => o.value)).toEqual(["edu"]);
  });

  it("keeps a stored value the field's options no longer list", () => {
    const stale = makeTask({ id: "e", fields: { layer: "infra" } });
    const options = facet(buildFacets(PAIM, [...TASKS, stale]), "field.layer").options;
    expect(options.map((o) => o.value)).toEqual(["api", "ui", "infra"]);
  });

  it("adds a checked value the facet does not offer, so it can be unchecked", () => {
    const layer = facet(buildFacets(PAIM, TASKS), "field.layer");
    expect(visibleOptions(layer, ["ghost"]).map((o) => o.value)).toEqual(["api", "ui", "ghost"]);
    expect(visibleOptions(layer, ["api"]).map((o) => o.value)).toEqual(["api", "ui"]);
  });

  it("has no facets before the project has loaded", () => {
    expect(buildFacets(undefined, TASKS)).toEqual([]);
  });
});

describe("filter state in the query string", () => {
  it("reads the filter parameters and ignores everything else", () => {
    expect(parseFilters("?status=ready,executing&field.layer=api&sort=-updatedAt")).toEqual({
      status: ["ready", "executing"],
      "field.layer": ["api"],
    });
  });

  it("reads a repeated parameter as one list, trimmed and deduplicated", () => {
    expect(parseFilters("?status=ready&status=ready,%20executing")).toEqual({
      status: ["ready", "executing"],
    });
  });

  it("knows which parameters are filters", () => {
    expect(isFilterParam("status")).toBe(true);
    expect(isFilterParam("field.layer")).toBe(true);
    expect(isFilterParam("field.Layer")).toBe(false);
    expect(isFilterParam("sort")).toBe(false);
  });

  it("round-trips: state → query string → the same state", () => {
    const filters = {
      status: ["ready", "executing"],
      priority: ["urgent"],
      "field.layer": ["api"],
    };
    const search = serializeFilters(filters);
    expect(search).toBe("?status=ready%2Cexecuting&priority=urgent&field.layer=api");
    expect(parseFilters(search)).toEqual(filters);
  });

  it("writes an empty address when nothing is selected", () => {
    expect(serializeFilters({})).toBe("");
  });

  it("leaves parameters that are not filters alone", () => {
    expect(serializeFilters({ status: ["ready"] }, "?sort=-updatedAt")).toBe(
      "?status=ready&sort=-updatedAt",
    );
    expect(serializeFilters({}, "?sort=-updatedAt")).toBe("?sort=-updatedAt");
  });

  it("toggles one value on and off, and drops the empty facet", () => {
    const one = toggleFilter({}, "status", "ready");
    expect(one).toEqual({ status: ["ready"] });
    const two = toggleFilter(one, "status", "executing");
    expect(two).toEqual({ status: ["ready", "executing"] });
    expect(toggleFilter(two, "status", "ready")).toEqual({ status: ["executing"] });
    expect(toggleFilter(one, "status", "ready")).toEqual({});
  });

  it("counts every checked value for the footer", () => {
    expect(activeFilterCount({})).toBe(0);
    expect(activeFilterCount({ status: ["ready", "executing"], priority: ["urgent"] })).toBe(3);
  });
});

describe("matching", () => {
  const schema = PAIM.fieldSchema;

  it("ORs the values of one facet and ANDs the facets", () => {
    expect(filterTasks(TASKS, { status: ["ready", "executing"] }, schema).map((t) => t.id)).toEqual(
      ["a", "b", "c"],
    );
    expect(
      filterTasks(TASKS, { status: ["ready"], "field.layer": ["api"] }, schema).map((t) => t.id),
    ).toEqual(["a"]);
  });

  it("matches a task that carries any one of the selected labels", () => {
    expect(filterTasks(TASKS, { label: ["api"] }, schema).map((t) => t.id)).toEqual(["a"]);
    expect(filterTasks(TASKS, { label: ["backend"] }, schema).map((t) => t.id)).toEqual(["a", "b"]);
  });

  it("leaves an unassigned task out of an assignee filter", () => {
    expect(filterTasks(TASKS, { assignee: ["edu"] }, schema).map((t) => t.id)).toEqual(["a", "b"]);
  });

  it("returns everything when no facet is checked", () => {
    expect(filterTasks(TASKS, {}, schema)).toHaveLength(3);
  });

  it("reads an absent field value as the field's default (docs/03 rule 1)", () => {
    const withDefault: FieldDef[] = [
      { key: "layer", type: "select", options: ["api", "ui"], default: "api", showAsFacet: true },
    ];
    const silent = makeTask({ id: "f", fields: {} });
    expect(matchesFilters(silent, { "field.layer": ["api"] }, withDefault)).toBe(true);
    expect(matchesFilters(silent, { "field.layer": ["ui"] }, withDefault)).toBe(false);
  });

  it("matches any entry of a multi_select value", () => {
    const schemaWithTags: FieldDef[] = [
      { key: "tags", type: "multi_select", options: ["x", "y"], showAsFacet: true },
    ];
    const task = makeTask({ id: "g", fields: { tags: ["x", "y"] } });
    expect(matchesFilters(task, { "field.tags": ["y"] }, schemaWithTags)).toBe(true);
    expect(matchesFilters(task, { "field.tags": ["z"] }, schemaWithTags)).toBe(false);
  });
});

describe("live counts", () => {
  const schema = PAIM.fieldSchema;
  const facets = buildFacets(PAIM, TASKS);

  it("counts the tasks behind every option", () => {
    const counts = facetCounts(facet(facets, "status"), TASKS, {}, schema);
    expect(counts.get("ready")).toBe(2);
    expect(counts.get("executing")).toBe(1);
    expect(counts.get("design")).toBeUndefined();
  });

  it("counts a facet against the other facets, never against itself", () => {
    const filters = { status: ["ready"] };

    // Its own selection does not zero the siblings: `executing` still says 1.
    const status = facetCounts(facet(facets, "status"), TASKS, filters, schema);
    expect(status.get("ready")).toBe(2);
    expect(status.get("executing")).toBe(1);

    // Another facet is counted inside the current set: only the two `ready`
    // tasks are left, one api and one ui.
    const layer = facetCounts(facet(facets, "field.layer"), TASKS, filters, schema);
    expect(layer.get("api")).toBe(1);
    expect(layer.get("ui")).toBe(1);
  });
});

/* The facets behind the left rail (docs/07 "Filter facets").
 *
 * Two rules from docs/07 shape this module:
 *
 *   "The service builds the facets from the project's schema."  — nothing
 *   here is a hardcoded list of facets. A project with a `layer` field marked
 *   `showAsFacet` has a Layer facet; a project without one does not.
 *
 *   "Filter state lives in the URL query string."  — the filters are read
 *   from `location.search` and written back to it. There is no other copy:
 *   a filtered list is a link, and Back is the undo.
 *
 * The parameter names are the ones `GET /api/projects/:project/tasks` already
 * takes (docs/06): `status`, `priority`, `size`, `label`, `assignee`,
 * `field.<key>`. One vocabulary for the address bar and for the service.
 *
 * Everything here is pure. The rail renders what these functions return,
 * which is what makes facet generation, the URL round trip and the counts
 * testable without a DOM.
 */

import {
  fieldView,
  isFieldKey,
  isSelectType,
  type FieldDef,
  type FieldDefView,
} from "../shared/fields.js";
import { isStatus, sortByCatalogue, type Status } from "../shared/statuses.js";
import { TASK_PRIORITIES, TASK_SIZES } from "../shared/types.js";
import {
  PRIORITY_LABEL,
  STATUS_LABEL,
  TASK_TYPES,
  TYPE_LABEL,
  type Priority,
  type TaskType,
} from "../ui/vocabulary";
import type { TaskView } from "./table";
import type { ProjectView } from "../shared/types.js";

/* ── filter state ───────────────────────────────────────────────────────── */

/** The selected values of every facet, keyed by facet id (= URL parameter). */
export type Filters = Readonly<Record<string, readonly string[]>>;

/** The core facets of docs/07, in the order the rail prints them. */
export const CORE_FILTER_PARAMS = ["status", "priority", "size", "label", "assignee"] as const;

const FIELD_PREFIX = "field.";

/**
 * Whether a query parameter is a filter. Anything else in the address —
 * a saved-view marker, a scroll anchor — is left alone by this module.
 */
export function isFilterParam(name: string): boolean {
  if ((CORE_FILTER_PARAMS as readonly string[]).includes(name)) return true;
  return name.startsWith(FIELD_PREFIX) && isFieldKey(name.slice(FIELD_PREFIX.length));
}

/** Splits one parameter's raw values: repeated and comma-separated both read
 *  as one list, exactly as the service reads them (src/server/tasks/query.ts). */
function splitValues(raw: readonly string[]): string[] {
  const out: string[] = [];
  for (const entry of raw) {
    for (const part of entry.split(",")) {
      const trimmed = part.trim();
      if (trimmed !== "" && !out.includes(trimmed)) out.push(trimmed);
    }
  }
  return out;
}

/**
 * Reads the filter state out of a query string.
 *
 * It does not need the project: the parameter names say which facet a value
 * belongs to. That matters on first paint — the address is filtered before
 * the project has loaded, and a filter must not blink off while it does.
 */
export function parseFilters(search: string): Filters {
  const params = new URLSearchParams(search);
  const filters: Record<string, string[]> = {};
  for (const name of new Set(params.keys())) {
    if (!isFilterParam(name)) continue;
    const values = splitValues(params.getAll(name));
    if (values.length > 0) filters[name] = values;
  }
  return filters;
}

/** The facet ids of `filters`, in the order the address prints them. */
function filterOrder(filters: Filters): string[] {
  const core = CORE_FILTER_PARAMS.filter((name) => (filters[name]?.length ?? 0) > 0);
  const fields = Object.keys(filters)
    .filter((name) => name.startsWith(FIELD_PREFIX) && (filters[name]?.length ?? 0) > 0)
    .sort();
  return [...core, ...fields];
}

/**
 * Writes the filter state back as a query string — `""` when nothing is
 * selected, so an unfiltered list keeps a clean address.
 *
 * The order is canonical, so the same selection always produces the same
 * link. Parameters that are not filters are preserved: this module owns the
 * filters in the address and nothing else.
 */
export function serializeFilters(filters: Filters, search = ""): string {
  const params = new URLSearchParams();
  for (const id of filterOrder(filters)) params.set(id, (filters[id] ?? []).join(","));

  for (const [name, value] of new URLSearchParams(search)) {
    if (!isFilterParam(name)) params.append(name, value);
  }

  const query = params.toString();
  return query === "" ? "" : `?${query}`;
}

/** Checks or unchecks one value; the result is a new state, never a mutation. */
export function toggleFilter(filters: Filters, id: string, value: string): Filters {
  const current = filters[id] ?? [];
  const next = current.includes(value)
    ? current.filter((entry) => entry !== value)
    : [...current, value];

  const out: Record<string, readonly string[]> = { ...filters };
  if (next.length === 0) delete out[id];
  else out[id] = next;
  return out;
}

/** The number of checked values across every facet — the rail's footer count. */
export function activeFilterCount(filters: Filters): number {
  let total = 0;
  for (const values of Object.values(filters)) total += values.length;
  return total;
}

/* ── matching ───────────────────────────────────────────────────────────── */

function fieldValues(task: TaskView, key: string, schema: readonly FieldDef[]): string[] {
  const stored = task.fields[key];
  // docs/03 rule 1: a field with no stored value reads as its default, so a
  // filter on the default value selects the tasks that never set it.
  const def = schema.find((entry) => entry.key === key);
  const value = stored === undefined || stored === null ? (def ? fieldView(def).default : null) : stored;

  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) return value.map((entry) => String(entry));
  return [String(value)];
}

/** The values of one task for one facet — one entry, several, or none. */
export function taskFacetValues(
  task: TaskView,
  id: string,
  schema: readonly FieldDef[],
): string[] {
  switch (id) {
    case "status":
      return [task.status];
    case "priority":
      return [task.priority];
    case "size":
      return [task.size];
    case "label":
      return [...task.labels];
    case "assignee":
      return task.assignee === null ? [] : [task.assignee];
    default:
      return id.startsWith(FIELD_PREFIX)
        ? fieldValues(task, id.slice(FIELD_PREFIX.length), schema)
        : [];
  }
}

/**
 * Whether one task survives the filters. Values inside one facet are OR-ed,
 * facets are AND-ed — the same algebra the list endpoint uses.
 *
 * `except` drops one facet from the test. That is how a facet counts its own
 * options: checking `Ready` must not send every other status to zero.
 */
export function matchesFilters(
  task: TaskView,
  filters: Filters,
  schema: readonly FieldDef[],
  except?: string,
): boolean {
  for (const [id, selected] of Object.entries(filters)) {
    if (id === except || selected.length === 0) continue;
    const values = taskFacetValues(task, id, schema);
    if (!values.some((value) => selected.includes(value))) return false;
  }
  return true;
}

export function filterTasks(
  tasks: readonly TaskView[],
  filters: Filters,
  schema: readonly FieldDef[],
): TaskView[] {
  if (activeFilterCount(filters) === 0) return [...tasks];
  return tasks.filter((task) => matchesFilters(task, filters, schema));
}

/* ── the facets of one project ──────────────────────────────────────────── */

/** docs/07: "Each facet head shows its source: `core`, `pipeline`, or `schema`." */
export type FacetSource = "core" | "pipeline" | "schema";

/** How the rail draws an option's glyph. `plain` has none. */
export type FacetGlyph = "status" | "priority" | "size" | "type" | "plain";

export interface FacetOption {
  value: string;
  label: string;
}

export interface Facet {
  /** The URL parameter, and the identity of the facet: `status`, `field.layer`. */
  id: string;
  label: string;
  source: FacetSource;
  glyph: FacetGlyph;
  options: FacetOption[];
  /** Set on a schema facet; the settings screen and the cells read it too. */
  field?: FieldDefView;
}

/** The distinct values of one core list field, in the order the rail shows them. */
function distinct(values: readonly string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function statusFacet(project: ProjectView, tasks: readonly TaskView[]): Facet {
  const pipeline = sortByCatalogue(project.statuses.filter(isStatus));
  // A task can hold a status the pipeline has since dropped (docs/04 does not
  // rewrite tasks when the pipeline changes). The table still groups it, so
  // the rail must still be able to filter it.
  const extra = sortByCatalogue(
    [...new Set(tasks.map((task) => task.status))].filter(
      (status): status is Status => isStatus(status) && !pipeline.includes(status),
    ),
  );
  return {
    id: "status",
    label: "Status",
    // The pipeline is the project's selection from the catalogue, not a
    // custom field: its own source, as docs/07 names it.
    source: "pipeline",
    glyph: "status",
    options: [...pipeline, ...extra].map((status) => ({
      value: status,
      label: STATUS_LABEL[status],
    })),
  };
}

function schemaFacet(def: FieldDefView, tasks: readonly TaskView[]): Facet {
  const known = def.options ?? [];
  // A stored value the options no longer list still filters: docs/03 keeps
  // values when a field changes, so the rail must not swallow one.
  const stored = distinct(
    tasks
      // The schema is left out on purpose: a default the options already
      // carry is not a second option.
      .flatMap((task) => fieldValues(task, def.key, []))
      .filter((value) => !known.includes(value)),
  );
  const isTypePool = def.key === "type";

  return {
    id: `${FIELD_PREFIX}${def.key}`,
    label: def.label,
    source: "schema",
    glyph: isTypePool ? "type" : "plain",
    field: def,
    options: [...known, ...stored].map((value) => ({
      value,
      label:
        isTypePool && (TASK_TYPES as readonly string[]).includes(value)
          ? TYPE_LABEL[value as TaskType]
          : value,
    })),
  };
}

/**
 * Every facet of one project: Status from its pipeline, the four other core
 * facets, then every `select` / `multi_select` field with `showAsFacet`.
 *
 * A hidden field is dropped — docs/03 rule 2: removing a field takes it off
 * the facets and the columns without touching the stored values.
 */
export function buildFacets(
  project: ProjectView | undefined,
  tasks: readonly TaskView[],
): Facet[] {
  if (project === undefined) return [];

  const core: Facet[] = [
    statusFacet(project, tasks),
    {
      id: "priority",
      label: "Priority",
      source: "core",
      glyph: "priority",
      // Loudest first: the rail is read top-down, and urgent is what a reader
      // looks for.
      options: [...TASK_PRIORITIES]
        .reverse()
        .map((priority) => ({ value: priority, label: PRIORITY_LABEL[priority as Priority] })),
    },
    {
      id: "size",
      label: "Size",
      source: "core",
      glyph: "size",
      options: TASK_SIZES.map((size) => ({ value: size, label: size })),
    },
    {
      id: "label",
      label: "Labels",
      source: "core",
      glyph: "plain",
      options: distinct(tasks.flatMap((task) => task.labels)).map((value) => ({
        value,
        label: value,
      })),
    },
    {
      id: "assignee",
      label: "Assignee",
      source: "core",
      glyph: "plain",
      options: distinct(
        tasks
          .map((task) => task.assignee)
          .filter((assignee): assignee is string => assignee !== null),
      ).map((value) => ({ value, label: value })),
    },
  ];

  const schema = project.fieldSchema
    .map(fieldView)
    .filter((def) => def.showAsFacet && !def.hidden && isSelectType(def.type))
    .sort((a, b) => a.order - b.order || a.key.localeCompare(b.key))
    .map((def) => schemaFacet(def, tasks));

  return [...core, ...schema];
}

/**
 * The options the rail draws for one facet: its own, plus any checked value
 * the project no longer offers. A filter in the address is always visible,
 * and so always uncheckable.
 */
export function visibleOptions(facet: Facet, selected: readonly string[]): FacetOption[] {
  const missing = selected.filter(
    (value) => !facet.options.some((option) => option.value === value),
  );
  return [...facet.options, ...missing.map((value) => ({ value, label: value }))];
}

/**
 * The live count beside every option: how many tasks that option would leave
 * on screen, given the other facets. Its own facet is excluded, so the counts
 * of one facet stay comparable once one of its values is checked.
 */
export function facetCounts(
  facet: Facet,
  tasks: readonly TaskView[],
  filters: Filters,
  schema: readonly FieldDef[],
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const task of tasks) {
    if (!matchesFilters(task, filters, schema, facet.id)) continue;
    for (const value of taskFacetValues(task, facet.id, schema)) {
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
  }
  return counts;
}

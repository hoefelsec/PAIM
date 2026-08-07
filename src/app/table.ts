/* The model behind the task table (docs/07 "The table").
 *
 * The table is the only view, so its shape is fixed: `Key · Title · Prio ·
 * Type · Size · Updated`, plus one column for every custom field with
 * `showInTable`. Rows group by status, and an epic holds its children.
 *
 * Everything here is pure. The component renders what these functions
 * return, which is what makes the column set, the grouping and the epic
 * counts testable without a DOM — and what keeps a thousand rows cheap: the
 * model is built once per data change, not once per row.
 */

import { fieldView, type FieldDef, type FieldDefView } from "../shared/fields.js";
import { sortByCatalogue, type Status } from "../shared/statuses.js";
import type { Task } from "../shared/types.js";

/**
 * docs/02 "Epic — Progress": the counts the list endpoint computes for an
 * epic on every read. `total` counts every non-trashed child, resolved or
 * not.
 */
export interface EpicProgress {
  done: number;
  cancelled: number;
  total: number;
}

/** A task as `GET /api/projects/:project/tasks` returns it. */
export type TaskView = Task & { progress?: EpicProgress };

/* ── columns ────────────────────────────────────────────────────────────── */

/** The five fixed columns; `updated` closes every row. */
export const CORE_COLUMNS = ["key", "title", "priority", "type", "size"] as const;

export interface Column {
  /** `key`, `title`, … for a core column; `field.<key>` for a custom one. */
  id: string;
  /** The column head. docs/13: mono, caps — it names the dimension. */
  label: string;
  align: "left" | "center" | "right";
  /** Fixed width, or undefined for the column that takes the rest. */
  width?: string;
  /** Set on a custom column; the cell reads the value through it. */
  field?: FieldDefView;
}

const FIXED: Column[] = [
  { id: "key", label: "Key", align: "left", width: "84px" },
  { id: "title", label: "Title", align: "left" },
  { id: "priority", label: "Prio", align: "center", width: "58px" },
  { id: "type", label: "Type", align: "center", width: "52px" },
  { id: "size", label: "Size", align: "center", width: "66px" },
];

const UPDATED: Column = { id: "updated", label: "Updated", align: "right", width: "96px" };

/**
 * The columns of one project: the fixed five, then its `showInTable` fields,
 * then `Updated`.
 *
 * `type` is skipped even when the schema marks it for the table: it is a
 * custom field, but the fixed `Type` column already draws it (docs/03 "The
 * `type` field"), and two columns of the same value is a bug, not a feature.
 * A hidden field is dropped as well — docs/03 rule 2: removing a field hides
 * it from the columns without touching its stored values.
 */
export function tableColumns(schema: readonly FieldDef[]): Column[] {
  const custom = schema
    .map(fieldView)
    .filter((def) => def.showInTable && !def.hidden && def.key !== "type")
    .sort((a, b) => a.order - b.order || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    .map((def): Column => ({
      id: `field.${def.key}`,
      label: def.label,
      align: def.type === "number" ? "right" : "left",
      width: "110px",
      field: def,
    }));

  return [...FIXED, ...custom, UPDATED];
}

/* ── values ─────────────────────────────────────────────────────────────── */

/**
 * One custom value as the cell prints it. A value the schema has no opinion
 * about is still printed: docs/03 keeps stored values when a field changes,
 * so the table must never swallow one.
 */
export function formatFieldValue(def: FieldDefView, value: unknown): string {
  if (value === null || value === undefined) return "";
  if (def.type === "checkbox") return value === true ? "✓" : "";
  if (Array.isArray(value)) return value.map((entry) => String(entry)).join(", ");
  if (typeof value === "boolean") return value ? "✓" : "";
  return String(value);
}

/* ── grouping ───────────────────────────────────────────────────────────── */

export interface TaskGroup {
  status: Status;
  /** Top-level tasks of this status, in the order the service returned them. */
  tasks: TaskView[];
}

export interface TableModel {
  groups: TaskGroup[];
  /** Children by epic id, in service order — the rows an open epic reveals. */
  childrenOf: Map<string, TaskView[]>;
  /** Every row the table can show, children included. */
  total: number;
}

/**
 * Groups the loaded tasks by status and files each child under its epic.
 *
 * A child appears once, indented under its epic — never a second time in its
 * own status group. A child whose epic is not in the loaded set has nothing
 * to hang from, so it stays a row of its own rather than disappearing.
 *
 * Group order is the project's pipeline order (docs/04 fixes it); a status
 * outside the pipeline still gets a group, at the end, so a task can never
 * be dropped by a pipeline change.
 */
export function buildTable(
  tasks: readonly TaskView[],
  pipeline: readonly Status[],
): TableModel {
  const byId = new Map<string, TaskView>(tasks.map((task) => [task.id, task]));
  const childrenOf = new Map<string, TaskView[]>();
  const byStatus = new Map<Status, TaskView[]>();

  for (const task of tasks) {
    const parent = task.parentId === null ? undefined : byId.get(task.parentId);
    if (parent) {
      const siblings = childrenOf.get(parent.id);
      if (siblings) siblings.push(task);
      else childrenOf.set(parent.id, [task]);
      continue;
    }
    const peers = byStatus.get(task.status);
    if (peers) peers.push(task);
    else byStatus.set(task.status, [task]);
  }

  const ordered = sortByCatalogue(pipeline);
  const extra = sortByCatalogue(
    [...byStatus.keys()].filter((status) => !ordered.includes(status)),
  );

  const groups: TaskGroup[] = [];
  for (const status of [...ordered, ...extra]) {
    const group = byStatus.get(status);
    // An empty status is not a row. With the facet rail in front of the
    // table, printing every unused status would be more chrome than data.
    if (group && group.length > 0) groups.push({ status, tasks: group });
  }

  return { groups, childrenOf, total: tasks.length };
}

/* ── epics ──────────────────────────────────────────────────────────────── */

/**
 * The progress of one epic. The service computes it over every child
 * (docs/02), so its answer wins; the loaded children are the fallback for a
 * record that arrived without it.
 */
export function epicProgress(
  epic: TaskView,
  childrenOf: ReadonlyMap<string, readonly TaskView[]>,
): EpicProgress {
  if (epic.progress) return epic.progress;

  const children = childrenOf.get(epic.id) ?? [];
  let done = 0;
  let cancelled = 0;
  for (const child of children) {
    if (child.status === "done") done++;
    else if (child.status === "cancelled") cancelled++;
  }
  return { done, cancelled, total: children.length };
}

/**
 * docs/02 "Progress": "`3/7 done`. When children are cancelled, it reports
 * both counts, for example `5/7 done, 2 cancelled`."
 */
export function epicProgressText(progress: EpicProgress): string {
  const base = `${progress.done}/${progress.total} done`;
  return progress.cancelled > 0 ? `${base}, ${progress.cancelled} cancelled` : base;
}

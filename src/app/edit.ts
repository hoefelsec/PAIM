/* The model behind inline editing (docs/07 "Editing", T21).
 *
 * docs/07: "Click a value, change it, and click outside to save. There are no
 * modal forms and no Save control." A cell therefore needs three answers, and
 * all three are values, not components: which control the column takes, what
 * the control shows for a given task, and what body the write sends.
 *
 * That is what an {@link EditorSpec} is. It is built once per column set — the
 * options of a select come from the schema, not from the row — so a thousand
 * rows share one spec per column and the table keeps its memoised rows.
 *
 * Everything here is pure, so the save path, the option lists and the
 * optimistic merge are testable without a DOM.
 */

import { fieldView, type FieldDef, type FieldDefView } from "../shared/fields.js";
import { sortByCatalogue, STATUS_CATALOGUE, type Status } from "../shared/statuses.js";
import {
  PRIORITIES,
  PRIORITY_LABEL,
  SIZES,
  SIZE_LABEL,
  STATUS_LABEL,
  TASK_TYPES,
  TYPE_LABEL,
  kindOf,
} from "../ui/vocabulary";
import { formatFieldValue, type Column, type TaskView } from "./table";
import type { TaskPriority, TaskSize } from "../shared/types.js";

/**
 * The body of a write to `POST|PATCH /api/projects/:project/tasks/:key`.
 * docs/06 "Update semantics": a shallow merge on the core fields and a
 * shallow merge on `fields`, where `null` clears one value.
 */
export interface TaskPatch {
  title?: string;
  status?: Status;
  priority?: TaskPriority;
  size?: TaskSize;
  labels?: string[];
  /** docs/06: `null` clears an optional reference. */
  assignee?: string | null;
  fields?: Record<string, unknown>;
}

/** One choice in a select menu. `value` is what the write sends. */
export interface EditorOption {
  value: string;
  label: string;
}

/**
 * How one column is edited. `read` and `patch` are inverse enough to be
 * useful: `patch(read(task))` is the write that changes nothing, which is how
 * the table knows a commit is a no-op and skips the round trip.
 */
export interface EditorSpec {
  /** The column this edits, `title`, `priority`, … or `field.<key>`. */
  columnId: string;
  /** The column head. It names the control for a screen reader. */
  label: string;
  /** `select` for an enum-like value, a text input for everything else. */
  kind: "select" | "text" | "number";
  /** The menu, for `select`; empty otherwise. */
  options: readonly EditorOption[];
  /** The current value, as the control holds it. */
  read(task: TaskView): string;
  /** The write for a value the control returns. */
  patch(raw: string): TaskPatch;
}

/** The clear choice. A required value (priority, size) does not offer one. */
const CLEAR: EditorOption = { value: "", label: "—" };

const named = <T extends string>(values: readonly T[], labels: Record<T, string>) =>
  values.map((value): EditorOption => ({ value, label: labels[value] }));

/* ── core columns ───────────────────────────────────────────────────────── */

const TITLE: EditorSpec = {
  columnId: "title",
  label: "Title",
  kind: "text",
  options: [],
  read: (task) => task.title,
  // Trimmed, but never dropped: an empty title is refused by the service
  // (docs/02 "title is the only required field"), and a refused write is a
  // flash and a revert — not something the client quietly rewrites.
  patch: (raw) => ({ title: raw.trim() }),
};

const PRIORITY: EditorSpec = {
  columnId: "priority",
  label: "Prio",
  kind: "select",
  options: named(PRIORITIES, PRIORITY_LABEL),
  read: (task) => task.priority,
  patch: (raw) => ({ priority: raw as TaskPriority }),
};

const SIZE: EditorSpec = {
  columnId: "size",
  label: "Size",
  kind: "select",
  // `Epic` is on the menu: docs/02 derives `kind` from the size, so promoting
  // a task to an epic is a size change and nothing else.
  options: named(SIZES, SIZE_LABEL),
  read: (task) => task.size,
  patch: (raw) => ({ size: raw as TaskSize }),
};

/**
 * `type` is a custom field drawn in a fixed column (docs/03 "The `type`
 * field"), so its menu comes from the project's definition when there is one
 * and from the pool when there is not. A task with no type is a valid task —
 * its key reads `TASK-n` — so the menu keeps the clear choice.
 */
function typeEditor(def: FieldDefView | null): EditorSpec {
  const pool: readonly string[] =
    def && def.options && def.options.length > 0 ? def.options : TASK_TYPES;
  return {
    columnId: "type",
    label: "Type",
    kind: "select",
    options: [
      CLEAR,
      ...pool.map((value): EditorOption => ({
        value,
        label: TYPE_LABEL[value as keyof typeof TYPE_LABEL] ?? value,
      })),
    ],
    read: (task) => {
      const value = task.fields["type"];
      return typeof value === "string" ? value : "";
    },
    patch: (raw) => ({ fields: { type: raw === "" ? null : raw } }),
  };
}

/* ── custom fields ──────────────────────────────────────────────────────── */

/** docs/03: a checkbox is enum-like, so it takes a menu, not a typed word. */
const CHECKBOX_OPTIONS: readonly EditorOption[] = [
  CLEAR,
  { value: "true", label: "Yes" },
  { value: "false", label: "No" },
];

/** One custom value, parsed back from what the control returned. */
function parseFieldValue(def: FieldDefView, raw: string): unknown {
  const text = raw.trim();
  if (def.type === "checkbox") return text === "" ? null : text === "true";
  if (text === "") return def.type === "multi_select" ? [] : null;
  if (def.type === "number") {
    const parsed = Number(text);
    // Not a number: send the text. The service answers 422 and the row
    // flashes — the client does not invent `null` out of a typo.
    return Number.isFinite(parsed) ? parsed : text;
  }
  if (def.type === "multi_select") {
    return text
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry !== "");
  }
  return text;
}

/**
 * The editor for one custom column.
 *
 * A `select` takes a menu. A `multi_select` does not: one menu cannot hold two
 * answers, and a list of checkboxes does not fit a 33 pixel row, so it takes
 * the comma-separated text the cell already prints. `long_text` is a single
 * line here too — the task view (spec 15) owns the long form.
 */
function fieldEditor(id: string, def: FieldDefView): EditorSpec {
  const select = def.type === "select" || def.type === "checkbox";
  return {
    columnId: id,
    label: def.label,
    kind: select ? "select" : def.type === "number" ? "number" : "text",
    options:
      def.type === "checkbox"
        ? CHECKBOX_OPTIONS
        : def.type === "select"
          ? [CLEAR, ...(def.options ?? []).map((value) => ({ value, label: value }))]
          : [],
    read: (task) => {
      const value = task.fields[def.key];
      if (def.type === "checkbox") {
        return value === true ? "true" : value === false ? "false" : "";
      }
      return formatFieldValue(def, value);
    },
    patch: (raw) => ({ fields: { [def.key]: parseFieldValue(def, raw) } }),
  };
}

/* ── the column set ─────────────────────────────────────────────────────── */

/**
 * The editors of one table, by column id.
 *
 * `key` and `updated` are absent on purpose: a key is permanent (docs/02
 * "Task keys") and `updatedAt` is the service's own record of the write. A
 * column with no entry here is not editable, which is the whole rule the
 * table needs.
 */
export function columnEditors(
  columns: readonly Column[],
  schema: readonly FieldDef[],
): Map<string, EditorSpec> {
  const typeDef = schema.map(fieldView).find((def) => def.key === "type") ?? null;
  const editors = new Map<string, EditorSpec>();

  for (const column of columns) {
    switch (column.id) {
      case "title":
        editors.set(column.id, TITLE);
        break;
      case "priority":
        editors.set(column.id, PRIORITY);
        break;
      case "size":
        editors.set(column.id, SIZE);
        break;
      case "type":
        editors.set(column.id, typeEditor(typeDef));
        break;
      case "key":
      case "updated":
        break;
      default:
        if (column.field && !column.field.hidden) {
          editors.set(column.id, fieldEditor(column.id, column.field));
        }
    }
  }

  return editors;
}

/* ── the properties column (docs/07 "The task view", T24) ───────────────── */

/**
 * Status is the one property the table has no column for: the table groups by
 * it. The menu is the project's pipeline (docs/02: "one of the project's
 * statuses"), in catalogue order — docs/04 fixes that order and a project
 * cannot change it. Which *moves* are legal is the pipeline engine's
 * question; a refusal comes back as a 4xx and the property reverts.
 */
function statusEditor(statuses: readonly Status[]): EditorSpec {
  const pool = statuses.length > 0 ? sortByCatalogue(statuses) : [...STATUS_CATALOGUE];
  return {
    columnId: "status",
    label: "Status",
    kind: "select",
    options: pool.map((status): EditorOption => ({ value: status, label: STATUS_LABEL[status] })),
    read: (task) => task.status,
    patch: (raw) => ({ status: raw as Status }),
  };
}

/** Labels are a list, and one line of comma-separated words is the whole of it. */
const LABELS: EditorSpec = {
  columnId: "labels",
  label: "Labels",
  kind: "text",
  options: [],
  read: (task) => task.labels.join(", "),
  patch: (raw) => ({
    labels: raw
      .split(",")
      .map((label) => label.trim())
      .filter((label) => label !== ""),
  }),
};

/**
 * docs/08: the service never guesses an assignee, so it is free text — there
 * is no person directory to pick from. Emptied, it clears (docs/06: `null`).
 */
const ASSIGNEE: EditorSpec = {
  columnId: "assignee",
  label: "Assignee",
  kind: "text",
  options: [],
  read: (task) => task.assignee ?? "",
  patch: (raw) => ({ assignee: raw.trim() === "" ? null : raw.trim() }),
};

/**
 * The properties of the task view's right column, in the order docs/07 lists
 * them: status, priority, size, type, the custom fields, then labels and
 * assignee.
 *
 * Every custom field appears, not only the `showInTable` ones: `showInTable`
 * chooses the table's columns (docs/03), and the task view is where a field
 * that is too long or too rare for a 33 pixel row is read and written.
 * `type` is drawn once, in its fixed place, and a removed field (`hidden`) is
 * gone from the column while its stored value stays (docs/03 rule 2).
 */
export function propertyEditors(
  statuses: readonly Status[],
  schema: readonly FieldDef[],
): EditorSpec[] {
  const defs = schema.map(fieldView);
  const typeDef = defs.find((def) => def.key === "type") ?? null;
  const custom = defs
    .filter((def) => !def.hidden && def.key !== "type")
    .sort((a, b) => a.order - b.order || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    .map((def) => fieldEditor(`field.${def.key}`, def));

  return [
    statusEditor(statuses),
    PRIORITY,
    SIZE,
    typeEditor(typeDef),
    ...custom,
    LABELS,
    ASSIGNEE,
  ];
}

/* ── the optimistic copy ────────────────────────────────────────────────── */

/**
 * The task as the service will hold it once the write lands — docs/07: "The
 * interface shows the change at once."
 *
 * The merge follows docs/06: shallow on the core, shallow on `fields`. `kind`
 * is derived, never written (docs/02), so it is derived here too; `updatedAt`
 * is not touched, because the answer carries the service's timestamp and a
 * guess would make the next `If-Match` fail on a write that succeeded.
 */
export function mergeTask(task: TaskView, patch: TaskPatch): TaskView {
  const next: TaskView = { ...task };
  if (patch.title !== undefined) next.title = patch.title;
  if (patch.status !== undefined) next.status = patch.status;
  if (patch.labels !== undefined) next.labels = patch.labels;
  if (patch.assignee !== undefined) next.assignee = patch.assignee;
  if (patch.priority !== undefined) next.priority = patch.priority;
  if (patch.size !== undefined) {
    next.size = patch.size;
    next.kind = kindOf(patch.size);
  }
  if (patch.fields !== undefined) next.fields = { ...task.fields, ...patch.fields };
  return next;
}

/**
 * True when the write would change nothing, so the table never sends it.
 *
 * The two values are compared through `patch`, which is the form the service
 * would store: a trailing space in a title, or `a,  b` against `a, b` in a
 * multi_select, is not a write.
 */
export function isNoop(spec: EditorSpec, task: TaskView, raw: string): boolean {
  return JSON.stringify(spec.patch(spec.read(task))) === JSON.stringify(spec.patch(raw));
}

/**
 * How long the row stays clay after a refused write (docs/13 "Motion": "A
 * rejected write makes the row flash in clay and then return"). Two beats of
 * `--dur-slow`: one to arrive, one to leave.
 */
export const FLASH_MS = 400;

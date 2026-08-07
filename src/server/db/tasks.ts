/**
 * Storage for the `tasks` table (migration 003). The JSON columns
 * (`fields`, `dependsOn`, `questions`, `designOptions`, `tests`, `reviews`,
 * `safety`, `schedule`) are parsed and stringified here, so every other
 * module works with the shared {@link Task} type only.
 *
 * The trash (docs/06 "The trash") is `deletedAt`: a soft-deleted task keeps
 * its row and stays out of every read. The trash listing, the restore
 * endpoint and the retention sweep belong to the trash work.
 */

import type Database from "better-sqlite3";
import type { Task } from "../../shared/types.js";

/** The raw shape of a `tasks` row: JSON columns are still text here. */
interface TaskRow {
  id: string;
  key: string;
  projectId: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  size: string;
  kind: string;
  labels: string;
  assignee: string | null;
  parentId: string | null;
  order: number;
  fields: string;
  model: string | null;
  effort: string | null;
  safety: string | null;
  childManualReview: number | null;
  schedule: string | null;
  dependsOn: string;
  questions: string;
  designOptions: string;
  tests: string;
  reviews: string;
  sourcePrompt: string;
  evaluatedAt: string | null;
  staleReason: string | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
}

const COLUMNS = [
  "id",
  "key",
  "projectId",
  "title",
  "description",
  "status",
  "priority",
  "size",
  "kind",
  "labels",
  "assignee",
  "parentId",
  "order",
  "fields",
  "model",
  "effort",
  "safety",
  "childManualReview",
  "schedule",
  "dependsOn",
  "questions",
  "designOptions",
  "tests",
  "reviews",
  "sourcePrompt",
  "evaluatedAt",
  "staleReason",
  "deletedAt",
  "createdAt",
  "updatedAt",
  "closedAt",
] as const;

/** `order` is a SQL keyword; every reference to the column is quoted. */
function column(name: string): string {
  return name === "order" ? '"order"' : name;
}

export function rowToTask(row: TaskRow): Task {
  return {
    id: row.id,
    key: row.key,
    projectId: row.projectId,
    title: row.title,
    description: row.description,
    status: row.status as Task["status"],
    priority: row.priority as Task["priority"],
    size: row.size as Task["size"],
    kind: row.kind as Task["kind"],
    labels: JSON.parse(row.labels) as string[],
    assignee: row.assignee,
    parentId: row.parentId,
    order: row.order,
    fields: JSON.parse(row.fields) as Record<string, unknown>,
    model: row.model,
    effort: row.effort as Task["effort"],
    safety: row.safety === null ? null : (JSON.parse(row.safety) as Task["safety"]),
    childManualReview: row.childManualReview === null ? null : row.childManualReview === 1,
    schedule: row.schedule === null ? null : (JSON.parse(row.schedule) as Task["schedule"]),
    dependsOn: JSON.parse(row.dependsOn) as string[],
    questions: JSON.parse(row.questions) as Task["questions"],
    designOptions: JSON.parse(row.designOptions) as Task["designOptions"],
    tests: JSON.parse(row.tests) as Task["tests"],
    reviews: JSON.parse(row.reviews) as Task["reviews"],
    sourcePrompt: row.sourcePrompt,
    evaluatedAt: row.evaluatedAt,
    staleReason: row.staleReason as Task["staleReason"],
    deletedAt: row.deletedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    closedAt: row.closedAt,
  };
}

function taskToRow(task: Task): TaskRow {
  return {
    id: task.id,
    key: task.key,
    projectId: task.projectId,
    title: task.title,
    description: task.description,
    status: task.status,
    priority: task.priority,
    size: task.size,
    kind: task.kind,
    labels: JSON.stringify(task.labels),
    assignee: task.assignee,
    parentId: task.parentId,
    order: task.order,
    fields: JSON.stringify(task.fields),
    model: task.model,
    effort: task.effort,
    safety: task.safety === null ? null : JSON.stringify(task.safety),
    childManualReview: task.childManualReview === null ? null : task.childManualReview ? 1 : 0,
    schedule: task.schedule === null ? null : JSON.stringify(task.schedule),
    dependsOn: JSON.stringify(task.dependsOn),
    questions: JSON.stringify(task.questions),
    designOptions: JSON.stringify(task.designOptions),
    tests: JSON.stringify(task.tests),
    reviews: JSON.stringify(task.reviews),
    sourcePrompt: task.sourcePrompt,
    evaluatedAt: task.evaluatedAt,
    staleReason: task.staleReason,
    deletedAt: task.deletedAt,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    closedAt: task.closedAt,
  };
}

export function insertTask(db: Database.Database, task: Task): Task {
  const names = COLUMNS.map(column).join(", ");
  const placeholders = COLUMNS.map((c) => `@${c}`).join(", ");
  db.prepare(`INSERT INTO tasks (${names}) VALUES (${placeholders})`).run(taskToRow(task));
  return task;
}

/** Rewrites every column of an existing row. `id` never changes. */
export function updateTask(db: Database.Database, task: Task): Task {
  const assignments = COLUMNS.filter((c) => c !== "id")
    .map((c) => `${column(c)} = @${c}`)
    .join(", ");
  db.prepare(`UPDATE tasks SET ${assignments} WHERE id = @id`).run(taskToRow(task));
  return task;
}

export interface TaskLookupOptions {
  /** Trashed tasks are invisible to every read except the trash itself. */
  includeTrashed?: boolean;
}

/**
 * Reads one task of a project by its key (`FEAT-14`) or its UUID — docs/06:
 * "`:key` accepts the task key, for example `FEAT-14`, or the UUID." One
 * statement covers both: a key never has the shape of a UUID, so the two
 * comparisons can never match different rows.
 */
export function getTaskByRef(
  db: Database.Database,
  projectId: string,
  ref: string,
  options: TaskLookupOptions = {},
): Task | null {
  const trashClause = options.includeTrashed ? "" : " AND deletedAt IS NULL";
  const row = db
    .prepare(
      `SELECT * FROM tasks WHERE projectId = @projectId AND (key = @ref OR id = @ref)${trashClause}`,
    )
    .get({ projectId, ref }) as TaskRow | undefined;
  return row ? rowToTask(row) : null;
}

export function getTaskById(
  db: Database.Database,
  id: string,
  options: TaskLookupOptions = {},
): Task | null {
  const trashClause = options.includeTrashed ? "" : " AND deletedAt IS NULL";
  const row = db.prepare(`SELECT * FROM tasks WHERE id = ?${trashClause}`).get(id) as
    | TaskRow
    | undefined;
  return row ? rowToTask(row) : null;
}

/** Removes the row for good — `DELETE ?hard=true`, which skips the trash. */
export function hardDeleteTask(db: Database.Database, id: string): void {
  db.prepare("DELETE FROM tasks WHERE id = ?").run(id);
}

/** How many tasks name `id` as their parent (`parentId` is a foreign key). */
export function countChildren(db: Database.Database, id: string): number {
  const row = db.prepare("SELECT COUNT(*) AS n FROM tasks WHERE parentId = ?").get(id) as {
    n: number;
  };
  return row.n;
}

/**
 * The `updatedAt` of the next write, guaranteed to differ from the previous
 * one. Two writes inside the same millisecond would otherwise share a
 * timestamp, and `If-Match: <updatedAt>` (docs/06 "Update semantics") would
 * accept a request built from the value before that pair.
 */
export function nextTimestamp(previous: string | null): string {
  const now = new Date().toISOString();
  if (previous === null || now > previous) return now;
  return new Date(Date.parse(previous) + 1).toISOString();
}

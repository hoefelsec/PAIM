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
import {
  CLOSED_STATUSES,
  OPEN_STATUSES,
  STATUS_CATALOGUE,
  type Status,
} from "../../shared/statuses.js";
import { TASK_PRIORITIES, TASK_SIZES, type Task } from "../../shared/types.js";
import type { SortTerm, TaskListSpec, TaskSortField } from "../tasks/query.js";

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

/**
 * Every trashed task of a project, newest deletion first — `GET .../trash`
 * (docs/06 "The trash").
 */
export function listTrashedTasks(db: Database.Database, projectId: string): Task[] {
  const rows = db
    .prepare(
      "SELECT * FROM tasks WHERE projectId = ? AND deletedAt IS NOT NULL ORDER BY deletedAt DESC",
    )
    .all(projectId) as TaskRow[];
  return rows.map(rowToTask);
}

/**
 * Purges every trashed task whose project's `trashRetentionDays` has
 * elapsed since `deletedAt` (docs/06 "The trash": "a sweep on startup and
 * every 24 h purges rows older than the project's `trashRetentionDays`").
 * `now` is a parameter so a test can drive it without mocking the system
 * clock. Returns the number of rows purged.
 */
export function sweepTrash(db: Database.Database, now: string = new Date().toISOString()): number {
  const rows = db
    .prepare(
      `SELECT tasks.id AS id, tasks.deletedAt AS deletedAt,
              projects.trashRetentionDays AS retentionDays
       FROM tasks JOIN projects ON projects.id = tasks.projectId
       WHERE tasks.deletedAt IS NOT NULL`,
    )
    .all() as { id: string; deletedAt: string; retentionDays: number }[];

  const nowMs = Date.parse(now);
  const expiredIds = rows
    .filter((row) => {
      const deadline = Date.parse(row.deletedAt) + row.retentionDays * 24 * 60 * 60 * 1000;
      return nowMs >= deadline;
    })
    .map((row) => row.id);

  if (expiredIds.length === 0) return 0;

  const placeholders = expiredIds.map(() => "?").join(", ");
  const sweep = db.transaction((): void => {
    // A purged epic's children still name it as `parentId`; the foreign key
    // is checked row by row, so a child pointing at a row purged earlier in
    // this same sweep would abort it (mirrors deleteProjectTasks).
    db.prepare(`UPDATE tasks SET parentId = NULL WHERE parentId IN (${placeholders})`).run(
      ...expiredIds,
    );
    db.prepare(`DELETE FROM tasks WHERE id IN (${placeholders})`).run(...expiredIds);
  });
  sweep();
  return expiredIds.length;
}

// ---------------------------------------------------------------------------
// The list read: filters, sort and cursor pagination (docs/06 "Query
// parameters for the list"). The query object is validated into a
// TaskListSpec by src/server/tasks/query.ts; this half turns that spec into
// one SELECT.
// ---------------------------------------------------------------------------

/**
 * A `CASE` that maps a value of a fixed vocabulary to its position in that
 * vocabulary. Sorting `priority` or `size` as text would order `high` before
 * `low` before `none`; docs/02 gives both a scale, and the scale is the order
 * a caller means. An unknown value sorts last.
 */
function rankExpression(column: string, vocabulary: readonly string[]): string {
  const cases = vocabulary.map((value, index) => `WHEN '${value}' THEN ${index}`).join(" ");
  return `CASE ${column} ${cases} ELSE ${vocabulary.length} END`;
}

/**
 * The SQL each sortable column becomes. Two rules shape them: the value must
 * be totally ordered (no NULL, which SQLite compares to nothing, so the
 * cursor predicate would drop rows), and it must be a single expression, so
 * one cursor value carries one sort term.
 *
 * `key` sorts naturally: `FEAT-2` before `FEAT-10`, which text order gets
 * backwards.
 */
const SORT_EXPRESSIONS: Record<TaskSortField, string> = {
  key:
    "printf('%s%012d', substr(tasks.key, 1, instr(tasks.key, '-'))," +
    " CAST(substr(tasks.key, instr(tasks.key, '-') + 1) AS INTEGER))",
  title: "lower(tasks.title)",
  status: rankExpression("tasks.status", STATUS_CATALOGUE),
  priority: rankExpression("tasks.priority", TASK_PRIORITIES),
  size: rankExpression("tasks.size", TASK_SIZES),
  order: 'tasks."order"',
  assignee: "ifnull(lower(tasks.assignee), '')",
  createdAt: "tasks.createdAt",
  updatedAt: "tasks.updatedAt",
  closedAt: "ifnull(tasks.closedAt, '')",
  id: "tasks.id",
};

/** Collects bound values so no caller value is ever spliced into the SQL. */
class Binder {
  readonly params: Record<string, unknown> = {};
  private next = 0;

  bind(value: unknown): string {
    const name = `p${this.next++}`;
    this.params[name] = value;
    return `@${name}`;
  }

  list(values: readonly unknown[]): string {
    return values.map((value) => this.bind(value)).join(", ");
  }

  snapshot(): Record<string, unknown> {
    return { ...this.params };
  }
}

/** `%` and `_` in a `q` are literal characters, not wildcards. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

function buildFilters(projectId: string, spec: TaskListSpec, binder: Binder): string {
  // The trash is invisible to every list (docs/06 "The trash").
  const where = [`tasks.projectId = ${binder.bind(projectId)}`, "tasks.deletedAt IS NULL"];

  if (spec.status !== null) {
    where.push(`tasks.status IN (${binder.list(spec.status)})`);
  }
  if (spec.open !== null) {
    const statuses: Status[] = spec.open ? OPEN_STATUSES : CLOSED_STATUSES;
    where.push(`tasks.status IN (${binder.list(statuses)})`);
  }
  if (spec.priority !== null) {
    where.push(`tasks.priority IN (${binder.list(spec.priority)})`);
  }
  if (spec.sizes !== null) {
    where.push(`tasks.size IN (${binder.list(spec.sizes)})`);
  }
  if (spec.assignees !== null) {
    where.push(`tasks.assignee IN (${binder.list(spec.assignees)})`);
  }
  if (spec.parentId !== null) {
    where.push(`tasks.parentId = ${binder.bind(spec.parentId)}`);
  }
  if (spec.labels !== null) {
    where.push(
      "EXISTS (SELECT 1 FROM json_each(tasks.labels)" +
        ` WHERE json_each.value IN (${binder.list(spec.labels)}))`,
    );
  }

  for (const filter of spec.fields) {
    // json_each over a path yields the scalar at that path, or one row per
    // element when it holds an array — so one predicate covers a `select`
    // and a `multi_select` alike, and yields nothing when the key is absent.
    const path = binder.bind(`$.${filter.key}`);
    const contains =
      `EXISTS (SELECT 1 FROM json_each(tasks.fields, ${path})` +
      ` WHERE CAST(json_each.value AS TEXT) IN (${binder.list(filter.values)}))`;
    where.push(
      filter.matchesDefault
        ? `(${contains} OR json_type(tasks.fields, ${path}) IS NULL)`
        : contains,
    );
  }

  if (spec.q !== null) {
    const pattern = binder.bind(`%${escapeLike(spec.q)}%`);
    where.push(
      `(tasks.title LIKE ${pattern} ESCAPE '\\' OR tasks.description LIKE ${pattern} ESCAPE '\\')`,
    );
  }
  if (spec.updatedSince !== null) {
    where.push(`tasks.updatedAt >= ${binder.bind(spec.updatedSince)}`);
  }

  return where.join(" AND ");
}

/**
 * "Everything after the row the cursor names", in the sort's own order. With
 * mixed directions this cannot be a row comparison, so it is the equivalent
 * lexicographic chain:
 *
 *   e0 > v0 OR (e0 = v0 AND (e1 < v1 OR (e1 = v1 AND …)))
 */
function cursorPredicate(sort: readonly SortTerm[], after: readonly unknown[], binder: Binder) {
  const chain = (index: number): string => {
    const term = sort[index]!;
    const expression = SORT_EXPRESSIONS[term.field];
    const operator = term.direction === "asc" ? ">" : "<";
    const value = binder.bind(after[index]);
    const ahead = `${expression} ${operator} ${value}`;
    if (index === sort.length - 1) return ahead;
    return `(${ahead} OR (${expression} = ${value} AND ${chain(index + 1)}))`;
  };
  return `(${chain(0)})`;
}

export interface TaskPage {
  tasks: Task[];
  /** Rows matching the filters, ignoring the page window. */
  total: number;
  hasMore: boolean;
  /** The sort values of the last row, for the next cursor; null on the last page. */
  cursorValues: unknown[] | null;
}

/**
 * One page of the tasks of a project. Pagination is keyset, not offset: the
 * cursor carries the sort values of the last row of the previous page, so a
 * task inserted or updated between two requests never shifts the window and
 * makes the walk repeat or skip a row.
 */
export function listTasks(
  db: Database.Database,
  projectId: string,
  spec: TaskListSpec,
): TaskPage {
  const binder = new Binder();
  const filters = buildFilters(projectId, spec, binder);
  const countParams = binder.snapshot();

  const total = (
    db.prepare(`SELECT COUNT(*) AS n FROM tasks WHERE ${filters}`).get(countParams) as { n: number }
  ).n;

  const selected = spec.sort
    .map((term, index) => `${SORT_EXPRESSIONS[term.field]} AS _s${index}`)
    .join(", ");
  const order = spec.sort
    .map((term, index) => `_s${index} ${term.direction === "asc" ? "ASC" : "DESC"}`)
    .join(", ");

  const where =
    spec.after === null
      ? filters
      : `${filters} AND ${cursorPredicate(spec.sort, spec.after, binder)}`;

  // One row past the page answers `hasMore` without a second count.
  const rows = db
    .prepare(
      `SELECT tasks.*, ${selected} FROM tasks WHERE ${where}` +
        ` ORDER BY ${order} LIMIT ${spec.limit + 1}`,
    )
    .all(binder.params) as (TaskRow & Record<string, unknown>)[];

  const hasMore = rows.length > spec.limit;
  const page = hasMore ? rows.slice(0, spec.limit) : rows;
  const last = page[page.length - 1];

  return {
    tasks: page.map(rowToTask),
    total,
    hasMore,
    cursorValues:
      hasMore && last ? spec.sort.map((_term, index) => last[`_s${index}`] ?? null) : null,
  };
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

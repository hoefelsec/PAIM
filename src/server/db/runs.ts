/**
 * Storage for the `runs` and `operations` tables (migration 006). The JSON
 * column (`restorePoint`) is parsed and stringified here, the three usage
 * columns are folded into one `usage` object, and an operation's `risk` is
 * derived from its kind on the way out — so every other module works with
 * the shared {@link Run} and {@link Operation} types only.
 *
 * Nothing here emits on the change bus: `GET /api/events` carries data
 * changes (tasks, projects, schemas, views — src/shared/events.ts), while a
 * run announces itself on its own stream and on the activity feed, which
 * are the run-stream work's (specs/09) to build.
 */

import type Database from "better-sqlite3";
import {
  riskForKind,
  type Operation,
  type OperationDraft,
  type RestorePoint,
  type Run,
} from "../../shared/runs.js";

/** The raw shape of a `runs` row: `restorePoint` is still text here. */
interface RunRow {
  id: string;
  taskId: string;
  projectId: string;
  kind: string;
  parentRunId: string | null;
  trigger: string;
  status: string;
  restorePoint: string | null;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  failureReason: string | null;
  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
}

const RUN_COLUMNS = [
  "id",
  "taskId",
  "projectId",
  "kind",
  "parentRunId",
  "trigger",
  "status",
  "restorePoint",
  "inputTokens",
  "outputTokens",
  "costUsd",
  "failureReason",
  "createdAt",
  "startedAt",
  "endedAt",
] as const;

/** `trigger` is a SQL keyword; every reference to the column is quoted. */
function column(name: string): string {
  return name === "trigger" ? '"trigger"' : name;
}

export function rowToRun(row: RunRow): Run {
  return {
    id: row.id,
    taskId: row.taskId,
    projectId: row.projectId,
    kind: row.kind as Run["kind"],
    parentRunId: row.parentRunId,
    trigger: row.trigger as Run["trigger"],
    status: row.status as Run["status"],
    restorePoint:
      row.restorePoint === null ? null : (JSON.parse(row.restorePoint) as RestorePoint),
    usage: {
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
      costUsd: row.costUsd,
    },
    failureReason: row.failureReason,
    createdAt: row.createdAt,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
  };
}

function runToRow(run: Run): RunRow {
  return {
    id: run.id,
    taskId: run.taskId,
    projectId: run.projectId,
    kind: run.kind,
    parentRunId: run.parentRunId,
    trigger: run.trigger,
    status: run.status,
    restorePoint: run.restorePoint === null ? null : JSON.stringify(run.restorePoint),
    inputTokens: run.usage.inputTokens,
    outputTokens: run.usage.outputTokens,
    costUsd: run.usage.costUsd,
    failureReason: run.failureReason,
    createdAt: run.createdAt,
    startedAt: run.startedAt,
    endedAt: run.endedAt,
  };
}

export function insertRun(db: Database.Database, run: Run): Run {
  const names = RUN_COLUMNS.map(column).join(", ");
  const placeholders = RUN_COLUMNS.map((c) => `@${c}`).join(", ");
  db.prepare(`INSERT INTO runs (${names}) VALUES (${placeholders})`).run(runToRow(run));
  return run;
}

/** Rewrites every column of an existing row. `id` never changes. */
export function updateRun(db: Database.Database, run: Run): Run {
  const assignments = RUN_COLUMNS.filter((c) => c !== "id")
    .map((c) => `${column(c)} = @${c}`)
    .join(", ");
  db.prepare(`UPDATE runs SET ${assignments} WHERE id = @id`).run(runToRow(run));
  return run;
}

export function getRunById(db: Database.Database, id: string): Run | null {
  const row = db.prepare("SELECT * FROM runs WHERE id = ?").get(id) as RunRow | undefined;
  return row ? rowToRun(row) : null;
}

/**
 * The runs of one task, newest first — `GET
 * /api/projects/:project/tasks/:key/runs`. `createdAt` orders them (a
 * queued run has no `startedAt` yet), with the id as the tie-break so two
 * runs enqueued in the same millisecond keep a stable order.
 */
export function listRunsForTask(db: Database.Database, taskId: string): Run[] {
  const rows = db
    .prepare("SELECT * FROM runs WHERE taskId = ? ORDER BY createdAt DESC, id DESC")
    .all(taskId) as RunRow[];
  return rows.map(rowToRun);
}

/** The runs of a project, newest first — the activity feed reads this. */
export function listRunsForProject(db: Database.Database, projectId: string): Run[] {
  const rows = db
    .prepare("SELECT * FROM runs WHERE projectId = ? ORDER BY createdAt DESC, id DESC")
    .all(projectId) as RunRow[];
  return rows.map(rowToRun);
}

/**
 * The queued runs of a project, oldest first — the order the queue serves
 * them in (src/server/runs/queue.ts). `rowid` breaks the tie: two runs
 * enqueued in the same millisecond carry the same `createdAt`, and the
 * queue must still serve the one that arrived first.
 */
export function listQueuedRuns(db: Database.Database, projectId: string): Run[] {
  const rows = db
    .prepare(
      "SELECT * FROM runs WHERE projectId = ? AND status = 'queued' ORDER BY createdAt ASC, rowid ASC",
    )
    .all(projectId) as RunRow[];
  return rows.map(rowToRun);
}

/** The children of an orchestrated run (docs/09 "Orchestration for an epic"). */
export function listChildRuns(db: Database.Database, parentRunId: string): Run[] {
  const rows = db
    .prepare("SELECT * FROM runs WHERE parentRunId = ? ORDER BY createdAt ASC, id ASC")
    .all(parentRunId) as RunRow[];
  return rows.map(rowToRun);
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

/** The raw shape of an `operations` row. `risk` is not stored. */
interface OperationRow {
  id: string;
  runId: string;
  seq: number;
  kind: string;
  summary: string;
  status: string;
  diff: string | null;
  stdout: string | null;
  exitCode: number | null;
  createdAt: string;
  updatedAt: string;
}

const OPERATION_COLUMNS = [
  "id",
  "runId",
  "seq",
  "kind",
  "summary",
  "status",
  "diff",
  "stdout",
  "exitCode",
  "createdAt",
  "updatedAt",
] as const;

/**
 * docs/09 "Records": `risk` is derived from `kind`. It is computed here on
 * every read rather than stored, so no row can ever carry a risk that
 * disagrees with the operation it describes.
 */
export function rowToOperation(row: OperationRow): Operation {
  const kind = row.kind as Operation["kind"];
  return {
    id: row.id,
    runId: row.runId,
    seq: row.seq,
    kind,
    risk: riskForKind(kind),
    summary: row.summary,
    status: row.status as Operation["status"],
    diff: row.diff,
    stdout: row.stdout,
    exitCode: row.exitCode,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function operationToRow(operation: Operation): OperationRow {
  return {
    id: operation.id,
    runId: operation.runId,
    seq: operation.seq,
    kind: operation.kind,
    summary: operation.summary,
    status: operation.status,
    diff: operation.diff,
    stdout: operation.stdout,
    exitCode: operation.exitCode,
    createdAt: operation.createdAt,
    updatedAt: operation.updatedAt,
  };
}

/** The position the next operation of `runId` takes in the log. */
function nextSeq(db: Database.Database, runId: string): number {
  const row = db.prepare("SELECT MAX(seq) AS max FROM operations WHERE runId = ?").get(runId) as {
    max: number | null;
  };
  return (row.max ?? 0) + 1;
}

/**
 * Appends one operation to a run's log. The caller states everything except
 * the position, which is assigned here, and the risk, which is derived from
 * the kind — neither is a caller's to decide.
 */
export function insertOperation(db: Database.Database, draft: OperationDraft): Operation {
  const operation: Operation = {
    ...draft,
    seq: nextSeq(db, draft.runId),
    risk: riskForKind(draft.kind),
  };
  const names = OPERATION_COLUMNS.join(", ");
  const placeholders = OPERATION_COLUMNS.map((c) => `@${c}`).join(", ");
  db.prepare(`INSERT INTO operations (${names}) VALUES (${placeholders})`).run(
    operationToRow(operation),
  );
  return operation;
}

/**
 * Rewrites an operation as it moves through its lifecycle (`proposed` →
 * `approved` → `running` → `done`, and the other paths). `id`, `runId` and
 * `seq` never change; `risk` follows `kind`.
 */
export function updateOperation(db: Database.Database, operation: Operation): Operation {
  const next: Operation = { ...operation, risk: riskForKind(operation.kind) };
  const assignments = OPERATION_COLUMNS.filter((c) => c !== "id" && c !== "runId" && c !== "seq")
    .map((c) => `${c} = @${c}`)
    .join(", ");
  db.prepare(`UPDATE operations SET ${assignments} WHERE id = @id`).run(operationToRow(next));
  return next;
}

export function getOperationById(db: Database.Database, id: string): Operation | null {
  const row = db.prepare("SELECT * FROM operations WHERE id = ?").get(id) as
    | OperationRow
    | undefined;
  return row ? rowToOperation(row) : null;
}

/** One run's operations, in the order they happened. */
export function listOperations(db: Database.Database, runId: string): Operation[] {
  const rows = db
    .prepare("SELECT * FROM operations WHERE runId = ? ORDER BY seq ASC")
    .all(runId) as OperationRow[];
  return rows.map(rowToOperation);
}

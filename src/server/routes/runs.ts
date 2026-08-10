/**
 * The run API (docs/06-rest-api.md "Runs"):
 *
 *   POST /api/projects/:project/tasks/:key/runs   put a run in the queue
 *   GET  /api/projects/:project/tasks/:key/runs   the runs of one task
 *   GET  /api/runs/:run                           one run and its operations
 *   POST /api/runs/:run/approve                   { operationIds: [ … ] }
 *   POST /api/runs/:run/deny                      { operationId, reason }
 *   POST /api/runs/:run/pause
 *   POST /api/runs/:run/resume
 *   POST /api/runs/:run/cancel                    { restore: true | false }
 *
 * The POST that starts a run enqueues and answers: it never waits for the
 * agent ("no endpoint blocks on a run", specs/README). The queue behind it —
 * dependency gating, the writer slot, model routing — is
 * src/server/runs/queue.ts.
 *
 * The five control endpoints answer the same way: they hand the decision to
 * the machinery the run is already waiting on and return the record as it
 * stands. Approve and deny settle a parked operation in the approval
 * registry (docs/10 §4); pause, resume and cancel go through the control
 * registry (src/server/runs/control.ts), where the runner reads them at its
 * next operation boundary — so a pause "stops at the end of the current
 * operation, never mid-operation" (docs/09). None of them waits for the run
 * to notice.
 *
 * `POST /api/runs/:run/restore` and the streams are later work
 * (specs/09-ai-run.md): until the restore work lands, `cancel` refuses
 * `{restore: true}` when the run has nothing to revert to.
 */

import type Database from "better-sqlite3";
import type { FastifyInstance, FastifyPluginOptions } from "fastify";
import {
  getOperationById,
  getRunById,
  listOperations,
  listRunsForTask,
  updateRun,
} from "../db/runs.js";
import { listEnvelope } from "../envelope.js";
import { ApiError } from "../errors.js";
import { asBoolean, asNonEmptyString, asObject, invalid } from "../validate.js";
import { isTerminalRunStatus, RUN_TRIGGERS, type RunTrigger } from "../../shared/runs.js";
import type { ApprovalRegistry } from "../runs/approvals.js";
import type { RunControlRegistry } from "../runs/control.js";
import type { RunQueue } from "../runs/queue.js";
import { requireProject } from "./projects.js";
import { requireTask } from "./tasks.js";
import type { Operation, Run, RunView } from "../../shared/runs.js";

export interface RunRoutesOptions extends FastifyPluginOptions {
  /** Resolved per request so the database opens lazily. */
  getDb(): Database.Database;
  /** Resolved per request for the same reason: the queue holds the database. */
  getQueue(): RunQueue;
  /** Where a parked operation is answered (docs/10 §4). */
  approvals: ApprovalRegistry;
  /** Where a run in flight is paused, resumed or cancelled. */
  controls: RunControlRegistry;
}

/**
 * docs/09 "Records": `trigger` says what put the run in the queue. A caller
 * may state it (the scheduler and the orchestrator do — T11, T60); anything
 * else is a manual run.
 */
function readTrigger(body: Record<string, unknown>): RunTrigger {
  const value = body["trigger"];
  if (value === undefined || value === null) return "manual";
  if (typeof value !== "string" || !(RUN_TRIGGERS as readonly string[]).includes(value)) {
    throw new ApiError(
      "INVALID_TRIGGER",
      400,
      { trigger: value, allowed: [...RUN_TRIGGERS] },
      `"trigger" must be one of ${RUN_TRIGGERS.join(", ")}`,
    );
  }
  return value as RunTrigger;
}

/** Reads one run by its id, or fails with `404 RUN_NOT_FOUND`. */
export function requireRun(db: Database.Database, id: string): Run {
  const run = getRunById(db, id);
  if (!run) {
    throw new ApiError("RUN_NOT_FOUND", 404, { run: id }, `No run "${id}"`);
  }
  return run;
}

/** A run with its operations, in the order they happened (docs/06). */
function runView(db: Database.Database, run: Run): RunView {
  return { ...run, operations: listOperations(db, run.id) };
}

/**
 * A control only applies to a run that is still going. docs/09 lists three
 * finished statuses; nothing moves a run out of them.
 */
function requireActiveRun(run: Run): Run {
  if (!isTerminalRunStatus(run.status)) return run;
  throw new ApiError(
    "RUN_NOT_ACTIVE",
    409,
    { run: run.id, status: run.status },
    `Run "${run.id}" is "${run.status}" and cannot be controlled`,
  );
}

/** `{ operationIds: [ … ] }` — at least one, each named once. */
function readOperationIds(body: Record<string, unknown>): string[] {
  const value = body["operationIds"];
  if (!Array.isArray(value)) invalid("operationIds", "must be an array of operation ids");
  const ids = (value as unknown[]).map((entry, index) =>
    asNonEmptyString(entry, `operationIds[${index}]`),
  );
  if (ids.length === 0) invalid("operationIds", "must name at least one operation");
  return [...new Set(ids)];
}

/**
 * The refusal the model reads. docs/10 §3: "The permission callback returns
 * the refusal to the model with the reason", so a caller that gives no
 * reason still sends one the model can act on.
 */
function readReason(body: Record<string, unknown>): string {
  const value = body["reason"];
  if (value === undefined || value === null) return "The user denied this operation.";
  return asNonEmptyString(value, "reason");
}

/**
 * One operation of this run, parked on an answer right now. Anything else is
 * refused before a single answer is given, so a request that names one bad
 * operation changes nothing.
 */
function requireParkedOperation(
  db: Database.Database,
  approvals: ApprovalRegistry,
  run: Run,
  operationId: string,
): Operation {
  const operation = getOperationById(db, operationId);
  if (!operation || operation.runId !== run.id) {
    throw new ApiError(
      "OPERATION_NOT_FOUND",
      404,
      { run: run.id, operation: operationId },
      `Run "${run.id}" has no operation "${operationId}"`,
    );
  }
  if (!approvals.isPending(operation.id)) {
    throw new ApiError(
      "OPERATION_NOT_AWAITING_APPROVAL",
      409,
      { run: run.id, operation: operation.id, status: operation.status },
      `Operation "${operation.id}" is "${operation.status}" and is not waiting for an answer`,
    );
  }
  return operation;
}

/**
 * docs/09 "Restore": a run has a restore point only once it captured one,
 * and a capture that failed leaves one that is not available, "with a stored
 * reason". Capture and the revert itself are the restore work's
 * (specs/09-ai-run.md); what this endpoint owes the caller now is a straight
 * refusal instead of a silent *Cancel and keep the changes*.
 */
function requireRestorePoint(run: Run): void {
  const point = run.restorePoint;
  if (point !== null && point.available) return;
  throw new ApiError(
    "NO_RESTORE_POINT",
    422,
    { run: run.id, reason: point?.reason ?? null },
    point === null
      ? `Run "${run.id}" has no restore point; cancel it without restoring`
      : `Restore is not available for run "${run.id}": ${
          point.reason ?? "the restore point could not be captured"
        }`,
  );
}

export async function runRoutes(app: FastifyInstance, options: RunRoutesOptions): Promise<void> {
  const { getDb, getQueue, approvals, controls } = options;

  app.post<{ Params: { project: string; key: string } }>(
    "/api/projects/:project/tasks/:key/runs",
    async (req, reply) => {
      const db = getDb();
      const project = requireProject(db, req.params.project);
      const task = requireTask(db, project, req.params.key);
      const trigger = readTrigger(asObject(req.body ?? {}, "body"));

      const queue = getQueue();
      // Refuses a project with no workspace (`422 NO_WORKSPACE`) and a
      // model this project does not allow (`422 MODEL_NOT_ALLOWED`); an
      // unmet dependency does not refuse anything — docs/05 allows the
      // queue action and reports the blocker, which is what `blockedBy`
      // carries back.
      const { run, blockedBy, model } = queue.enqueue({ project, task, trigger });

      // Kicks the queue and returns at once: `dispatch` hands each startable
      // run to a background promise, so the agent's work happens after this
      // handler answers ("no endpoint blocks on a run", specs/README).
      queue.dispatch(project.id);

      reply.status(201);
      return {
        data: run,
        blockedBy,
        model: { model: model.model, effort: model.effort },
      };
    },
  );

  app.get<{ Params: { project: string; key: string } }>(
    "/api/projects/:project/tasks/:key/runs",
    async (req) => {
      const db = getDb();
      const project = requireProject(db, req.params.project);
      const task = requireTask(db, project, req.params.key);

      // Newest first, and without the operation log: a task can hold many
      // runs, and the log of one of them is what `GET /api/runs/:run` is
      // for ("one run and its operations", docs/06).
      const runs = listRunsForTask(db, task.id);
      return listEnvelope(runs, { total: runs.length, cursor: null, hasMore: false });
    },
  );

  app.get<{ Params: { run: string } }>("/api/runs/:run", async (req) => {
    const db = getDb();
    return { data: runView(db, requireRun(db, req.params.run)) };
  });

  // --- Approve and deny (docs/10 §4) --------------------------------------
  //
  // The answer goes to the operation the run is parked on. The run record
  // that comes back is the one stored right now — the run reads the answer
  // on its own thread, so it may still say `awaiting_approval`; `GET
  // /api/runs/:run` (and, later, the run stream) is where the result of the
  // answer shows up.

  app.post<{ Params: { run: string } }>("/api/runs/:run/approve", async (req) => {
    const db = getDb();
    const run = requireActiveRun(requireRun(db, req.params.run));
    const ids = readOperationIds(asObject(req.body ?? {}, "body"));

    // Every id is checked before any of them is answered.
    const operations = ids.map((id) => requireParkedOperation(db, approvals, run, id));
    for (const operation of operations) approvals.approve(operation.id);

    return { data: requireRun(db, run.id), approved: operations.map((o) => o.id) };
  });

  app.post<{ Params: { run: string } }>("/api/runs/:run/deny", async (req) => {
    const db = getDb();
    const run = requireActiveRun(requireRun(db, req.params.run));
    const body = asObject(req.body ?? {}, "body");
    const operationId = asNonEmptyString(body["operationId"], "operationId");
    const reason = readReason(body);

    const operation = requireParkedOperation(db, approvals, run, operationId);
    // docs/10 §3: the refusal and its reason reach the model and the run
    // continues — a denied operation does not end it.
    approvals.deny(operation.id, reason);

    return { data: requireRun(db, run.id), denied: operation.id, reason };
  });

  // --- Pause, resume, cancel (docs/09 "Cancel and Restore are different") --

  app.post<{ Params: { run: string } }>("/api/runs/:run/pause", async (req) => {
    const db = getDb();
    const run = requireActiveRun(requireRun(db, req.params.run));

    // Already paused: the caller asked for the state it is already in.
    if (run.status === "paused") return { data: run, paused: true };

    if (controls.has(run.id)) {
      controls.pause(run.id);
      // `paused: false` says the request is recorded and the run stops when
      // the operation it is in the middle of finishes (docs/09). It is not
      // paused yet, and this endpoint does not wait for it to be.
      return { data: requireRun(db, run.id), paused: false };
    }

    // A run still in the queue has no operation to finish, so it pauses at
    // once — it simply stops being a run the queue will serve. Resume puts
    // it back.
    if (run.status === "queued") {
      return { data: updateRun(db, { ...run, status: "paused" }), paused: true };
    }

    throw new ApiError(
      "RUN_NOT_RUNNING",
      409,
      { run: run.id, status: run.status },
      `Run "${run.id}" is "${run.status}" but no runner is driving it`,
    );
  });

  app.post<{ Params: { run: string } }>("/api/runs/:run/resume", async (req) => {
    const db = getDb();
    const run = requireActiveRun(requireRun(db, req.params.run));

    if (controls.has(run.id)) {
      if (!controls.resume(run.id)) {
        throw new ApiError(
          "RUN_NOT_PAUSED",
          409,
          { run: run.id, status: run.status },
          `Run "${run.id}" is "${run.status}" and is not paused`,
        );
      }
      // The run leaves `paused` when it picks the answer up, which is why
      // the record here may still carry it.
      return { data: requireRun(db, run.id) };
    }

    if (run.status !== "paused") {
      throw new ApiError(
        "RUN_NOT_PAUSED",
        409,
        { run: run.id, status: run.status },
        `Run "${run.id}" is "${run.status}" and is not paused`,
      );
    }

    // Paused before it ever started: back in the queue, in its old place —
    // `createdAt` is what orders the queue, and nothing here touched it.
    const queued = updateRun(db, { ...run, status: "queued" });
    getQueue().dispatch(queued.projectId);
    return { data: queued };
  });

  app.post<{ Params: { run: string } }>("/api/runs/:run/cancel", async (req) => {
    const db = getDb();
    const run = requireActiveRun(requireRun(db, req.params.run));
    const body = asObject(req.body ?? {}, "body");
    const restoreValue = body["restore"];
    const restore =
      restoreValue === undefined || restoreValue === null
        ? false
        : asBoolean(restoreValue, "restore");

    // Refused before the run is stopped: a caller who asked for *Cancel and
    // restore* must not silently get *Cancel and keep the changes*.
    if (restore) requireRestorePoint(run);

    // Stops the agent now: the signal aborts, a parked approval comes out of
    // its wait, and the next boundary refuses to propose anything.
    controls.cancel(run.id);

    // The record is written here rather than left to the runner, so the
    // answer to this request is the truth even for a run no runner is
    // driving (one still in the queue). The runner writes the same status
    // when it unwinds.
    const cancelled = updateRun(db, {
      ...run,
      status: "cancelled",
      endedAt: run.endedAt ?? new Date().toISOString(),
    });

    // docs/09: "Cancel and Restore are different actions." The revert is the
    // restore work's (specs/09-ai-run.md); the cancel is done either way.
    return { data: cancelled, restore: { requested: restore, performed: false } };
  });
}

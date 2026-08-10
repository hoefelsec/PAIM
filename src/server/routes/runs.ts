/**
 * The run API (docs/06-rest-api.md "Runs"):
 *
 *   POST /api/projects/:project/tasks/:key/runs   put a run in the queue
 *   GET  /api/projects/:project/tasks/:key/runs   the runs of one task
 *   GET  /api/runs/:run                           one run and its operations
 *
 * The POST enqueues and answers: it never waits for the agent ("no endpoint
 * blocks on a run", specs/README). The queue behind it — dependency gating,
 * the writer slot, model routing — is src/server/runs/queue.ts.
 *
 * The control endpoints (approve, deny, pause, resume, cancel, restore) and
 * the streams are later work (specs/09-ai-run.md).
 */

import type Database from "better-sqlite3";
import type { FastifyInstance, FastifyPluginOptions } from "fastify";
import { getRunById, listOperations, listRunsForTask } from "../db/runs.js";
import { listEnvelope } from "../envelope.js";
import { ApiError } from "../errors.js";
import { asObject } from "../validate.js";
import { RUN_TRIGGERS, type RunTrigger } from "../../shared/runs.js";
import type { RunQueue } from "../runs/queue.js";
import { requireProject } from "./projects.js";
import { requireTask } from "./tasks.js";
import type { Run, RunView } from "../../shared/runs.js";

export interface RunRoutesOptions extends FastifyPluginOptions {
  /** Resolved per request so the database opens lazily. */
  getDb(): Database.Database;
  /** Resolved per request for the same reason: the queue holds the database. */
  getQueue(): RunQueue;
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

export async function runRoutes(app: FastifyInstance, options: RunRoutesOptions): Promise<void> {
  const { getDb, getQueue } = options;

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
}

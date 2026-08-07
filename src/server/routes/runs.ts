/**
 * The read half of the run API (docs/06-rest-api.md "Runs"):
 *
 *   GET /api/projects/:project/tasks/:key/runs   the runs of one task
 *   GET /api/runs/:run                           one run and its operations
 *
 * Starting a run, the control endpoints (approve, deny, pause, resume,
 * cancel, restore) and the streams are later work (specs/09-ai-run.md);
 * this module only reads the records of src/server/db/runs.ts.
 */

import type Database from "better-sqlite3";
import type { FastifyInstance, FastifyPluginOptions } from "fastify";
import { getRunById, listOperations, listRunsForTask } from "../db/runs.js";
import { listEnvelope } from "../envelope.js";
import { ApiError } from "../errors.js";
import { requireProject } from "./projects.js";
import { requireTask } from "./tasks.js";
import type { Run, RunView } from "../../shared/runs.js";

export interface RunRoutesOptions extends FastifyPluginOptions {
  /** Resolved per request so the database opens lazily. */
  getDb(): Database.Database;
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
  const { getDb } = options;

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

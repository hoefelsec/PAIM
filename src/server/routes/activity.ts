/**
 * The activity feed (docs/06-rest-api.md "Activity and usage"; T59):
 *
 *   GET /api/activity          all runs, in all projects
 *   GET /api/activity/stream   the same, live
 *
 * `GET /api/activity` is a plain snapshot: every run this service has ever
 * queued, newest first, each carrying the same `progress` a run stream would
 * show it (docs/07 "Progress" — `planning` before the agent proposes
 * anything, `completed`/`planned` counts after). The stream is the same
 * feed the per-run stream reads (src/server/runs/streams.ts), fanned out
 * unfiltered: "all runs, all projects" is every frame, with no per-run
 * subscription to manage.
 */

import type Database from "better-sqlite3";
import type { FastifyInstance, FastifyPluginOptions } from "fastify";
import { computeRunProgress, type Run, type RunProgress } from "../../shared/runs.js";
import { listAllRuns, listOperations } from "../db/runs.js";
import { SSE_HEADERS } from "../events/sse.js";
import { listEnvelope } from "../envelope.js";
import type { RunStreamRegistry } from "../runs/streams.js";

export interface ActivityRoutesOptions extends FastifyPluginOptions {
  getDb(): Database.Database;
  streams: RunStreamRegistry;
}

/** One row of the activity feed: a run plus the progress a stream shows it. */
export type ActivityRun = Run & { progress: RunProgress };

function activityRow(db: Database.Database, run: Run): ActivityRun {
  return { ...run, progress: computeRunProgress(run, listOperations(db, run.id)) };
}

export async function activityRoutes(
  app: FastifyInstance,
  options: ActivityRoutesOptions,
): Promise<void> {
  const { getDb, streams } = options;

  app.get("/api/activity", async () => {
    const db = getDb();
    const rows = listAllRuns(db).map((run) => activityRow(db, run));
    return listEnvelope(rows, { total: rows.length, cursor: null, hasMore: false });
  });

  app.get("/api/activity/stream", (_req, reply) => {
    // Subscribes the registry to the run feed, the same way `getDb()`
    // subscribes the change bus behind `GET /api/events` — before the
    // stream is registered, so no frame written between here and the first
    // subscriber is missed.
    getDb();

    reply.hijack();
    reply.raw.writeHead(200, SSE_HEADERS);
    streams.activityHub.add(reply.raw, { comment: "connected" });
  });
}

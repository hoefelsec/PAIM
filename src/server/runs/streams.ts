/**
 * The run streams (specs/TASKS.md T59; docs/09-ai-run.md "Streams";
 * docs/06-rest-api.md "Activity and usage"):
 *
 *   GET /api/runs/:run/stream    one run's operation lifecycle + status
 *   GET /api/activity            all runs, all projects (a plain list)
 *   GET /api/activity/stream     the same, live
 *
 * Both streams read the same feed (src/server/events/runFeed.ts) — a run
 * announces itself once, and this registry fans that announcement out to
 * whichever hub(s) want it: every open activity stream, and the run stream
 * of the run named in the event, if anyone is watching it.
 *
 * The registry is a thin layer over two independent {@link SseHub}
 * instances — one hub is *filtered* (a run stream sees only its own run),
 * the other is not (the activity stream sees everything) — plus the
 * per-run watch list that makes the filtering possible without teaching the
 * hub itself about runs.
 */

import type Database from "better-sqlite3";
import { computeRunProgress, type Operation, type Run, type RunProgress } from "../../shared/runs.js";
import { getRunById, listOperations } from "../db/runs.js";
import { onRunEvent, type RunFeedEvent } from "../events/runFeed.js";
import { SseHub, type SseConnection } from "../events/sse.js";

/** One frame of a run or activity stream. */
export interface RunStreamFrame {
  run: Run;
  /** Present only for an `operation` frame — the operation that changed. */
  operation: Operation | null;
  /** docs/07 "Progress": `planning` before the agent proposes anything. */
  progress: RunProgress;
}

export interface RunStreamRegistryOptions {
  /** Overridden by tests only; production keeps `SSE_HEARTBEAT_MS`. */
  heartbeatMs?: number;
}

/**
 * The connection registry behind both streams. One instance per app, like
 * the `SseHub` behind `GET /api/events` — decorated on the Fastify instance
 * so routes and tests reach the same one.
 */
export class RunStreamRegistry {
  /** `GET /api/runs/:run/stream` — filtered per connection by {@link watch}. */
  readonly runHub: SseHub;
  /** `GET /api/activity/stream` — every frame, every run. */
  readonly activityHub: SseHub;

  private readonly watchers = new Map<string, Set<SseConnection>>();
  private unsubscribeFeed: (() => void) | null = null;

  constructor(options: RunStreamRegistryOptions = {}) {
    this.runHub = new SseHub({ heartbeatMs: options.heartbeatMs });
    this.activityHub = new SseHub({ heartbeatMs: options.heartbeatMs });
  }

  /**
   * Wires this registry to `db`'s run feed. Safe to call more than once —
   * the app calls it every time it resolves the database, the same way
   * `onChange` is attached in src/server/app.ts.
   */
  attach(db: Database.Database): void {
    if (this.unsubscribeFeed) return;
    this.unsubscribeFeed = onRunEvent(db, (event) => this.handle(db, event));
  }

  /** Drops the feed subscription — the app's `onClose`. */
  detach(): void {
    this.unsubscribeFeed?.();
    this.unsubscribeFeed = null;
  }

  /** Ends every open stream, of both hubs. */
  closeAll(): void {
    this.runHub.closeAll();
    this.activityHub.closeAll();
  }

  /**
   * Registers `connection` as watching `runId`. Returns the function that
   * removes it — call it when the connection closes, or the watch list
   * leaks one entry per stream that ever opened.
   */
  watch(runId: string, connection: SseConnection): () => void {
    let set = this.watchers.get(runId);
    if (!set) {
      set = new Set();
      this.watchers.set(runId, set);
    }
    set.add(connection);
    return () => {
      const current = this.watchers.get(runId);
      if (!current) return;
      current.delete(connection);
      if (current.size === 0) this.watchers.delete(runId);
    };
  }

  /** How many runs have at least one watcher — a leak check for tests. */
  get watchedRunCount(): number {
    return this.watchers.size;
  }

  private handle(db: Database.Database, event: RunFeedEvent): void {
    const run = event.kind === "run" ? event.run : getRunById(db, event.operation.runId);
    // A run row can vanish between the write and this handler only if the
    // database was closed mid-flight; nothing to announce then.
    if (!run) return;

    const operations = listOperations(db, run.id);
    const frame: RunStreamFrame = {
      run,
      operation: event.kind === "operation" ? event.operation : null,
      progress: computeRunProgress(run, operations),
    };

    this.activityHub.broadcast(frame, event.kind);

    const watchers = this.watchers.get(run.id);
    if (!watchers) return;
    for (const connection of watchers) connection.send(frame, event.kind);
  }
}

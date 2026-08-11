/**
 * The run feed: the choke point every run and operation write passes through
 * on its way to `GET /api/runs/:run/stream` and `GET /api/activity/stream`
 * (specs/TASKS.md T59; docs/09-ai-run.md "Streams").
 *
 * Mirrors src/server/events/changes.ts, which carries tasks, projects,
 * schemas and views only (docs/06 "The events stream") — a run's own
 * lifecycle and its operations are a separate feed, as db/runs.ts already
 * notes: "a run announces itself on its own stream and on the activity
 * feed". The bus hangs off the database handle for the same reason: two
 * databases in one process (a test suite opens one per case) never see each
 * other's runs.
 *
 * No transaction buffering here — unlike the change bus, no run or
 * operation write happens inside `transaction()` today, so every write can
 * announce itself the moment it commits.
 */

import type Database from "better-sqlite3";
import type { Operation, Run } from "../../shared/runs.js";

export type RunFeedEvent =
  | { kind: "run"; run: Run }
  | { kind: "operation"; operation: Operation };

export type RunFeedListener = (event: RunFeedEvent) => void;

const states = new WeakMap<Database.Database, Set<RunFeedListener>>();

function listenersFor(db: Database.Database): Set<RunFeedListener> {
  let listeners = states.get(db);
  if (!listeners) {
    listeners = new Set();
    states.set(db, listeners);
  }
  return listeners;
}

/** Subscribes to every run/operation write on `db`. Returns the unsubscribe function. */
export function onRunEvent(db: Database.Database, listener: RunFeedListener): () => void {
  const listeners = listenersFor(db);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** How many listeners the feed holds — the leak check of a closed app. */
export function runFeedListenerCount(db: Database.Database): number {
  return listenersFor(db).size;
}

/** Announces one run or operation write. Called from src/server/db/runs.ts only. */
export function emitRunEvent(db: Database.Database, event: RunFeedEvent): void {
  for (const listener of [...listenersFor(db)]) listener(event);
}

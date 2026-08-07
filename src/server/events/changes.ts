/**
 * The change bus: the single choke point every data change passes through
 * on its way to `GET /api/events` (specs/06-events.md — "Emitted from the
 * storage layer (single choke point), not from individual route handlers").
 *
 * The bus hangs off the database handle rather than a module-level
 * singleton, so two databases in one process (a test suite opens one per
 * case) never see each other's events, and closing a database drops its bus
 * with it.
 *
 * Writes made inside {@link transaction} are buffered until the outermost
 * one commits: a statement that rolls back changed no record, so it must
 * produce no event.
 */

import type Database from "better-sqlite3";
import type { ChangeEvent } from "../../shared/events.js";

export type ChangeListener = (event: ChangeEvent) => void;

interface BusState {
  listeners: Set<ChangeListener>;
  /** How many {@link transaction} calls are open, counting savepoints. */
  depth: number;
  /** Events emitted inside the open transaction, released on commit. */
  pending: ChangeEvent[];
}

const states = new WeakMap<Database.Database, BusState>();

function stateFor(db: Database.Database): BusState {
  let state = states.get(db);
  if (!state) {
    state = { listeners: new Set(), depth: 0, pending: [] };
    states.set(db, state);
  }
  return state;
}

/**
 * Subscribes to every change on `db`. Returns the unsubscribe function; a
 * caller that forgets it (an app that is never closed) keeps its listener
 * alive for as long as the database handle lives.
 */
export function onChange(db: Database.Database, listener: ChangeListener): () => void {
  const state = stateFor(db);
  state.listeners.add(listener);
  return () => {
    state.listeners.delete(listener);
  };
}

/** How many listeners the bus holds — the leak check of a closed app. */
export function changeListenerCount(db: Database.Database): number {
  return stateFor(db).listeners.size;
}

function deliver(state: BusState, event: ChangeEvent): void {
  // A copy, so a listener that unsubscribes itself while it runs (an SSE
  // connection dropping on a failed write) cannot disturb the walk.
  for (const listener of [...state.listeners]) listener(event);
}

/**
 * Announces one changed record. Called from `src/server/db/*` only — a route
 * handler never emits, so a write made by any other path (a service, a
 * script, a later spec) is on the stream too.
 */
export function emitChange(db: Database.Database, event: ChangeEvent): void {
  const state = stateFor(db);
  if (state.depth > 0) {
    state.pending.push(event);
    return;
  }
  deliver(state, event);
}

/**
 * `db.transaction()` with the change bus attached: the events its writes
 * emit reach subscribers when the outermost transaction commits, and are
 * discarded when it (or the savepoint of a nested call) rolls back.
 *
 * Returns a callable, exactly like `db.transaction()`.
 */
export function transaction<T>(db: Database.Database, fn: () => T): () => T {
  const runInSqlite = db.transaction(fn);

  return (): T => {
    const state = stateFor(db);
    // Where this transaction's own events start. A nested call rolls back to
    // its savepoint, which undoes its writes and no earlier ones.
    const mark = state.pending.length;
    state.depth += 1;

    let result: T;
    try {
      result = runInSqlite();
    } catch (error) {
      state.pending.length = mark;
      state.depth -= 1;
      throw error;
    }

    state.depth -= 1;
    if (state.depth === 0 && state.pending.length > 0) {
      const committed = state.pending.splice(0, state.pending.length);
      for (const event of committed) deliver(state, event);
    }
    return result;
  };
}

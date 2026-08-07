/**
 * Task key generation (docs/02-data-model.md "Task keys", specs/03-tasks.md,
 * T11).
 *
 * The key is the type prefix plus a counter. The prefix comes from the
 * task's `type` value at creation, via the T09 pool
 * (`src/shared/fields.ts` `TYPE_POOL`); a task with no `type` value (or an
 * unrecognized one) uses the `TASK` fallback prefix. The counter is one
 * sequence for the whole project — it lives in its own `task_counters`
 * table (migration 004) and is incremented inside the same transaction as
 * the task insert, so concurrent creates never hand out the same number.
 * The key is permanent: nothing recomputes it, so a later change of `type`
 * never renames it.
 */
import type Database from "better-sqlite3";
import { TYPE_POOL, TYPE_POOL_FALLBACK } from "../../shared/fields.js";

/** The prefix for a task's key, derived from its `type` field value. */
export function prefixForType(type: unknown): string {
  if (typeof type === "string" && Object.prototype.hasOwnProperty.call(TYPE_POOL, type)) {
    return TYPE_POOL[type as keyof typeof TYPE_POOL];
  }
  return TYPE_POOL_FALLBACK;
}

/**
 * Allocates the next task key for `projectId`, deriving the prefix from
 * `type` (docs/02 "Task keys"). The counter row is created on first use
 * (`INSERT ... ON CONFLICT ... RETURNING`) — the increment and the read of
 * the resulting value happen in one statement, so there is no separate
 * read step that could race with another connection's write between the
 * upsert and the read.
 *
 * Callers must run this inside the same `db.transaction()` as the task
 * insert it names, so a failed insert also rolls back the counter bump —
 * see specs/03-tasks.md "Keys".
 */
export function nextTaskKey(db: Database.Database, projectId: string, type: unknown): string {
  const prefix = prefixForType(type);

  const row = db
    .prepare(
      `INSERT INTO task_counters (projectId, counter) VALUES (@projectId, 1)
       ON CONFLICT(projectId) DO UPDATE SET counter = counter + 1
       RETURNING counter`,
    )
    .get({ projectId }) as { counter: number };

  return `${prefix}-${row.counter}`;
}

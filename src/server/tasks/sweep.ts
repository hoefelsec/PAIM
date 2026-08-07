/**
 * Schedules the trash retention sweep (docs/06 "The trash"): "A sweep on
 * startup and every 24 h purges rows older than the project's
 * `trashRetentionDays`." The pure purge logic is
 * {@link import("../db/tasks.js").sweepTrash}; this module only owns the
 * timing, so a test can drive it with a fake clock instead of waiting a
 * real day.
 */

import type Database from "better-sqlite3";
import { sweepTrash } from "../db/tasks.js";

export const TRASH_SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000;

export interface TrashSweepHandle {
  /** Stops the recurring sweep. Safe to call more than once. */
  stop(): void;
}

/**
 * Runs the sweep once immediately (startup) and then every `intervalMs`
 * (default 24 h). The interval timer is `unref`'d so it never keeps the
 * process alive on its own.
 */
export function startTrashSweep(
  db: Database.Database,
  intervalMs: number = TRASH_SWEEP_INTERVAL_MS,
): TrashSweepHandle {
  sweepTrash(db);
  const timer = setInterval(() => sweepTrash(db), intervalMs);
  timer.unref?.();
  return { stop: () => clearInterval(timer) };
}

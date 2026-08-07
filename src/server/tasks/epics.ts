/**
 * Epic invariants (docs/02-data-model.md "Epic") that need more than the
 * shape of a single write to check: whether a parent is itself an epic in
 * the same project, whether making a task a non-epic would strand its
 * children, and the read-time progress count.
 *
 * `kind` derivation and the read-only `kind` write live in
 * src/server/tasks/validate.ts; this module is the pair of checks that need
 * a database lookup, plus the progress computation.
 */

import type Database from "better-sqlite3";
import { categoryOf } from "../../shared/statuses.js";
import type { Task } from "../../shared/types.js";
import { ApiError } from "../errors.js";
import { countChildren } from "../db/tasks.js";

/** docs/02 "Epic — Progress": resolved children, split into done and cancelled. */
export interface EpicProgress {
  /** Children whose status category is `done`. */
  done: number;
  /** Children whose status category is `cancelled`. A cancelled child is resolved. */
  cancelled: number;
  /** Every non-trashed child, resolved or not. */
  total: number;
}

/**
 * docs/02 "One level": a child task cannot be an epic. Checked against the
 * task's own `size`, after any patch has been applied, whenever it will be
 * written with a `parentId`.
 */
export function checkNotNestedEpic(size: Task["size"], parentId: string | null): void {
  if (parentId !== null && size === "Epic") {
    throw new ApiError(
      "EPIC_NESTING",
      422,
      { size, parentId },
      "A child task cannot be an epic",
    );
  }
}

/**
 * docs/02: "parentId must point at an epic in the same project." The
 * project match is already guaranteed by the lookup that resolved `parent`
 * (it only searches the current project); this checks the remaining half.
 */
export function checkParentIsEpic(parent: Task): void {
  if (parent.kind !== "epic") {
    throw new ApiError(
      "PARENT_NOT_EPIC",
      422,
      { parentId: parent.id },
      `"${parent.key}" is not an epic, so it cannot be a parent`,
    );
  }
}

/**
 * docs/02: "The service refuses to change the size away from Epic while the
 * epic has children." Only relevant when the task is currently an epic and
 * the patch turns it into a plain task.
 */
export function checkEpicHasNoChildren(
  db: Database.Database,
  current: Task,
  nextSize: Task["size"],
): void {
  if (current.kind !== "epic" || nextSize === "Epic") return;

  const children = countChildren(db, current.id);
  if (children > 0) {
    throw new ApiError(
      "EPIC_HAS_CHILDREN",
      422,
      { children },
      `"${current.key}" has ${children} child task(s); it cannot stop being an epic`,
    );
  }
}

/**
 * docs/02 "Progress": "the count of resolved children, for example
 * `3/7 done`. When children are cancelled, it reports both counts, for
 * example `5/7 done, 2 cancelled`." An epic with no children reports `0/0`
 * — the empty result of this function on an empty list, never mistaken for
 * "all children resolved".
 */
export function computeEpicProgress(db: Database.Database, epicId: string): EpicProgress {
  const rows = db
    .prepare("SELECT status FROM tasks WHERE parentId = ? AND deletedAt IS NULL")
    .all(epicId) as { status: string }[];

  let done = 0;
  let cancelled = 0;
  for (const row of rows) {
    const category = categoryOf(row.status as Task["status"]);
    if (category === "done") done++;
    else if (category === "cancelled") cancelled++;
  }
  return { done, cancelled, total: rows.length };
}

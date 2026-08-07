/**
 * `dependsOn` validation and the run-gating helper (specs/05, docs/05).
 *
 * A write to `dependsOn` is checked here, not in `applyTaskPatch`
 * (src/server/tasks/validate.js): the shape (`string[]`) is validated
 * there, but "does this id exist, in this project, without closing a
 * cycle" needs a database lookup, the same reason `checkParentIsEpic` and
 * friends live in tasks/epics.js rather than validate.js.
 */

import type Database from "better-sqlite3";
import { getTaskById } from "../db/tasks.js";
import { ApiError } from "../errors.js";
import type { Task } from "../../shared/types.js";

export interface DependsOnContext {
  /**
   * The id the task being written has (or will have, for a create). A
   * self-reference, or a cycle that loops back to it through other tasks,
   * is caught by walking the graph from here.
   */
  taskId: string;
  /** docs/05 "Dependencies stay inside one project". */
  projectId: string;
}

/**
 * docs/05 "Dependencies stay inside one project" + specs/05 "no
 * self-reference, no cycles". Every id newly introduced by this write —
 * present in `dependsOn` but not in `previousDependsOn` — must name an
 * existing task of the same project (`422 DEPENDENCY_NOT_FOUND` if it names
 * no task at all, `422 DEPENDENCY_CROSS_PROJECT` if it names a task in a
 * different project). An id the task already carried is not re-checked
 * here: `unmetDependencies` below already treats a stored id that no
 * longer resolves (e.g. its task was hard-deleted or swept from the trash)
 * as legitimate rather than fatal, and a write that never touches
 * `dependsOn` — or edits it without removing that id — must not brick on a
 * dependency that went away out from under it. Once every new id resolves,
 * the graph formed by this task's new edges plus every other task's
 * *stored* edges must have no path back to `taskId` — a self-reference is
 * a one-step case of the same check (`422 DEPENDENCY_CYCLE`).
 *
 * Read-only: called before the write transaction, the same way
 * `resolveParent` and the epic checks run before it.
 *
 * `previousDependsOn` is the task's dependsOn list before this write (empty
 * for a create, where every id is by definition new).
 */
export function validateDependsOn(
  db: Database.Database,
  context: DependsOnContext,
  dependsOn: readonly string[],
  previousDependsOn: readonly string[] = [],
): void {
  const previous = new Set(previousDependsOn);
  for (const depId of dependsOn) {
    if (previous.has(depId)) continue;
    const dep = getTaskById(db, depId, { includeTrashed: true });
    if (!dep) {
      throw new ApiError(
        "DEPENDENCY_NOT_FOUND",
        422,
        { dependsOn: depId },
        `No task "${depId}" to depend on`,
      );
    }
    if (dep.projectId !== context.projectId) {
      throw new ApiError(
        "DEPENDENCY_CROSS_PROJECT",
        422,
        { dependsOn: depId },
        `The task "${depId}" belongs to a different project`,
      );
    }
  }

  // Depth-first walk of the dependency graph, starting from the edges this
  // write is about to set. Every other node contributes its *stored* edges
  // — the only edges that can change in this write are `taskId`'s own.
  const visited = new Set<string>();
  const stack: string[] = [...dependsOn];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (id === context.taskId) {
      throw new ApiError(
        "DEPENDENCY_CYCLE",
        422,
        { dependsOn: id },
        "This dependsOn change closes a cycle",
      );
    }
    if (visited.has(id)) continue;
    visited.add(id);

    const dep = getTaskById(db, id, { includeTrashed: true });
    if (!dep) continue;
    for (const next of dep.dependsOn) {
      if (!visited.has(next)) stack.push(next);
    }
  }
}

/**
 * specs/TASKS.md T09 "the run queue": "Do not start [a task] before every
 * uuid in its `dependsOn` list [is] done." Returns the dependencies that
 * are not — the blocking set the queue (T55) and the UI name to the user. A
 * `dependsOn` entry that no longer resolves to a task cannot block a start
 * it can never satisfy, so it is left out.
 */
export function unmetDependencies(db: Database.Database, task: Task): Task[] {
  const blocking: Task[] = [];
  for (const id of task.dependsOn) {
    const dep = getTaskById(db, id, { includeTrashed: true });
    if (dep && dep.status !== "done") blocking.push(dep);
  }
  return blocking;
}

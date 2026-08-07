/**
 * The transition engine (specs/04-status-pipeline.md, T26).
 *
 * Two moves change a task's status by themselves:
 *
 *   advance(task, statuses)   the gate is satisfied — on to the next status
 *   fail(task, reason)        the gate failed — back to `executing`, with the
 *                             reason stored for the next run's brief
 *
 * and one guards the third: `checkManualStatusMove` refuses a status written
 * by hand that no legal move allows (`422 GATE_REQUIRED`). docs/04: "A task
 * moves forward only when it satisfies the gate. The service has no override
 * that skips a gate."
 *
 * Every function is pure: it returns the next task record, and the caller
 * writes it (src/server/db/tasks.ts) so one write carries one change event.
 * Which actor satisfies which gate, and the resulting move tables, live in
 * src/shared/pipeline.ts — the client reads the same rules.
 */

import { ApiError } from "../errors.js";
import {
  FAILURE_STATUS,
  closedAtFor,
  gateOf,
  manualMoveTargets,
  nextStatusFor,
} from "../../shared/pipeline.js";
import type { Status } from "../../shared/statuses.js";
import type { Task } from "../../shared/types.js";

/**
 * Moves a task to `status` and keeps everything the status implies in step:
 * the `closedAt` stamp, and the failure reason, which belongs to the run that
 * has not happened yet — any move forward leaves it behind.
 */
export function withStatus(
  task: Task,
  status: Status,
  options: { failureReason?: string | null; now?: string } = {},
): Task {
  const now = options.now ?? new Date().toISOString();
  return {
    ...task,
    status,
    failureReason:
      options.failureReason === undefined ? null : options.failureReason,
    closedAt: closedAtFor(status, task.closedAt, now),
  };
}

/**
 * The gate of the task's current status is satisfied: move it to the next
 * status of the project's pipeline, skipping the ones this task does not use
 * (`open_questions` and `design` — docs/04 "An enabled status is available,
 * not mandatory").
 *
 * The caller is the evidence that the gate is satisfied: the answers
 * endpoint, the review endpoint, the run, the testing gate. `advance` does
 * not second-guess it — it only refuses to invent a status past the end of
 * the pipeline.
 */
export function advance(task: Task, statuses: readonly Status[], now?: string): Task {
  const next = nextStatusFor(task, statuses);
  if (next === null) {
    throw new ApiError(
      "PIPELINE_TERMINAL",
      422,
      { status: task.status, statuses: [...statuses] },
      `"${task.key}" is at "${task.status}"; the pipeline has no status after it`,
    );
  }
  return withStatus(task, next, { now });
}

/**
 * A gate failed. docs/04: "Each gate has one failure path. The task returns to
 * `executing`. The service attaches the reason. The next run receives the
 * reason as part of its instructions."
 *
 * The reason is stored on the task (`failureReason`), so it survives until a
 * run picks it up, and it is readable through the task API meanwhile.
 */
export function fail(task: Task, reason: string, now?: string): Task {
  const trimmed = reason.trim();
  if (trimmed === "") {
    throw new ApiError(
      "FAILURE_REASON_REQUIRED",
      422,
      { status: task.status },
      "A failure carries the reason the next run needs; it cannot be empty",
    );
  }
  return withStatus(task, FAILURE_STATUS, { failureReason: trimmed, now });
}

/**
 * Refuses a status written through the task API that is not one of the legal
 * moves of src/shared/pipeline.ts. A write that repeats the current status
 * changes nothing and is always allowed.
 */
export function checkManualStatusMove(
  task: Task,
  to: Status,
  statuses: readonly Status[],
): void {
  if (to === task.status) return;

  const allowed = manualMoveTargets(task, statuses);
  if (allowed.includes(to)) return;

  const gate = gateOf(task.status);
  throw new ApiError(
    "GATE_REQUIRED",
    422,
    { from: task.status, to, gate, allowed },
    gate === "none"
      ? `"${task.key}" cannot move from "${task.status}" to "${to}"; ` +
          `legal moves: ${allowed.join(", ") || "none"}`
      : `"${task.status}" ends when its gate is satisfied (${gate}); ` +
          `a status write cannot skip it`,
  );
}

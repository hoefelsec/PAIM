/**
 * The status catalogue as a state machine (docs/04-status-pipeline.md).
 *
 * src/shared/statuses.ts holds the identity of the catalogue — the ten
 * statuses, their order, their categories and the required five. This module
 * adds the half that makes it a pipeline: which actor satisfies the gate of
 * each status, which status follows which for a given task, and which moves a
 * caller may write by hand.
 *
 * Everything here is a pure function of a task and a project's enabled
 * statuses, so the client can light up the same controls the server accepts.
 * The writing half (advance, fail, and the `422 GATE_REQUIRED` refusal) lives
 * in src/server/tasks/pipeline.ts.
 */

import { STATUS_CATALOGUE, categoryOf, type Status } from "./statuses.js";

/**
 * Who satisfies a gate — the "Condition to advance" column of the catalogue
 * table in docs/04. A gate is the condition to *leave* the status it belongs
 * to, so `none` means the task may move on the moment somebody asks.
 */
export const GATE_ACTORS = ["none", "user", "claude", "run", "tests"] as const;
export type GateActor = (typeof GATE_ACTORS)[number];

/** The gate of every status of the catalogue (docs/04 "The catalogue"). */
export const STATUS_GATE = {
  // None.
  backlog: "none",
  // "The user answers all questions" — the answers endpoint (docs/04 §1).
  open_questions: "user",
  // "Claude accepts the design direction" (docs/04 §2).
  design: "claude",
  // None.
  ready: "none",
  // "The run ends" (docs/09).
  executing: "run",
  // "All tests pass" (docs/04 §3).
  testing: "tests",
  // "Claude returns approved" (docs/04 §4).
  ai_review: "claude",
  // "The user approves" — the review endpoint (docs/04 §5).
  manual_review: "user",
  // None.
  done: "none",
  // None.
  cancelled: "none",
} as const satisfies Record<Status, GateActor>;

export function gateOf(status: Status): GateActor {
  return STATUS_GATE[status];
}

/**
 * docs/04 "Failure moves the task back to `executing`": every gate has one
 * failure path, and it always leads here.
 */
export const FAILURE_STATUS: Status = "executing";

/**
 * docs/04 "An enabled status is available, not mandatory": a task skips
 * `open_questions` and `design` when it needs neither. "Needs" is visible on
 * the task — the questions it carries and the design options it was offered.
 * Every other status of an enabled pipeline applies to every task.
 */
export interface PipelineTask {
  status: Status;
  questions: readonly unknown[];
  designOptions: readonly unknown[];
}

export function isOptionalFor(status: Status, task: PipelineTask): boolean {
  if (status === "open_questions") return task.questions.length === 0;
  if (status === "design") return task.designOptions.length === 0;
  return false;
}

const CATALOGUE_INDEX = new Map<Status, number>(STATUS_CATALOGUE.map((s, i) => [s, i]));

function indexOf(status: Status): number {
  return CATALOGUE_INDEX.get(status)!;
}

/**
 * The next status of the project's pipeline after `from`, in catalogue order.
 *
 * `cancelled` is never "next": it is a destination a caller chooses, from
 * anywhere, and it sits at the end of the catalogue only because the order is
 * fixed. `done` therefore has no successor — it is the end of the line.
 */
export function nextEnabledStatus(
  statuses: readonly Status[],
  from: Status,
): Status | null {
  const after = indexOf(from);
  let best: Status | null = null;
  for (const status of statuses) {
    if (status === "cancelled") continue;
    if (indexOf(status) <= after) continue;
    if (best === null || indexOf(status) < indexOf(best)) best = status;
  }
  return best;
}

/**
 * The forward path a task may take from its current status: one entry per
 * enabled status it could land on, stopping at the first one that applies to
 * it. The chain has more than one entry only while the statuses in between
 * are optional for this task (`open_questions`, `design` — docs/04), which is
 * how a task with no questions reaches `ready` without pretending to answer
 * any.
 */
export function forwardPath(task: PipelineTask, statuses: readonly Status[]): Status[] {
  const path: Status[] = [];
  let cursor: Status = task.status;
  for (;;) {
    const next = nextEnabledStatus(statuses, cursor);
    if (next === null) break;
    path.push(next);
    if (!isOptionalFor(next, task)) break;
    cursor = next;
  }
  return path;
}

/**
 * The status the *service* moves the task to when a gate is satisfied: the
 * end of the forward path, so the statuses this task does not use are behind
 * it. `null` at the end of the pipeline.
 */
export function nextStatusFor(task: PipelineTask, statuses: readonly Status[]): Status | null {
  const path = forwardPath(task, statuses);
  return path.length === 0 ? null : path[path.length - 1]!;
}

/**
 * Every status a manual write may move this task to (specs/04, T26):
 *
 * - forward, one enabled status at a time, while the gate of the status the
 *   task is leaving needs no actor — a gate with an actor is satisfied
 *   through that actor's endpoint, never by writing `status`;
 * - `cancelled`, from anywhere;
 * - re-open from `done`, to any enabled status that is still open.
 *
 * The result is sorted in catalogue order and never contains the task's
 * current status: a write that repeats it changes nothing.
 */
export function manualMoveTargets(task: PipelineTask, statuses: readonly Status[]): Status[] {
  const targets = new Set<Status>();

  // "cancelled from anywhere" — when the project enables it at all.
  if (statuses.includes("cancelled") && task.status !== "cancelled") targets.add("cancelled");

  if (task.status === "done") {
    // Re-open: the work resumes wherever the user says it resumes.
    for (const status of statuses) {
      const category = categoryOf(status);
      if (category === "todo" || category === "in_progress") targets.add(status);
    }
  } else if (gateOf(task.status) === "none" || isOptionalFor(task.status, task)) {
    for (const status of forwardPath(task, statuses)) targets.add(status);
  }

  return [...targets].sort((a, b) => indexOf(a) - indexOf(b));
}

/** Whether a manual write may move `task` to `to` (a no-op move always may). */
export function isLegalManualMove(
  task: PipelineTask,
  to: Status,
  statuses: readonly Status[],
): boolean {
  return to === task.status || manualMoveTargets(task, statuses).includes(to);
}

/**
 * `closedAt` follows the category of the status (docs/02 lists the stamp; the
 * pipeline is what moves a task in and out of a closed category). A task that
 * re-opens loses its stamp; one that moves between two closed statuses keeps
 * the moment it first closed.
 */
export function closedAtFor(
  status: Status,
  previous: string | null,
  now: string,
): string | null {
  const category = categoryOf(status);
  const closed = category === "done" || category === "cancelled";
  if (!closed) return null;
  return previous ?? now;
}

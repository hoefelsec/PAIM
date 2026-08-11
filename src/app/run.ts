/* What the Run tab needs to know, with no React in it (T69).
 *
 * The tab answers one question — "what happened, in order" (docs/07 "The task
 * view") — over the records of docs/09 "Records". Everything here is a pure
 * reading of those records: how a run status is worded and coloured, how an
 * operation line is split into its parts, how a stored diff is split into
 * lines the screen can colour, and the four numbers of the runfoot.
 *
 * Nothing here decides anything. The service owns risk, reversibility and
 * status; this module only says how they read.
 */

import { fieldView } from "../shared/fields.js";
import type {
  Operation,
  OperationStatus,
  Run,
  RunStatus,
  RunView,
} from "../shared/runs.js";
import type { Status } from "../shared/statuses.js";
import type { Effort, ProjectView } from "../shared/types.js";
import type { TaskView } from "./table";

/* ── the run state bar ──────────────────────────────────────────────────── */

/** docs/09 "Records": the nine statuses, worded for a reader. */
export const RUN_STATUS_LABEL: Record<RunStatus, string> = {
  queued: "Queued",
  planning: "Planning",
  awaiting_approval: "Awaiting approval",
  executing: "Executing",
  paused: "Paused",
  held_budget: "Held — budget",
  succeeded: "Succeeded",
  failed: "Failed",
  cancelled: "Cancelled",
};

/**
 * Colour marks state (docs/13). A run status is not an operation risk, so it
 * reads the *status* palette: brass while the run wants something, the accent
 * while it works, sage when it is done, clay when it failed.
 */
export const RUN_STATUS_VAR: Record<RunStatus, string> = {
  queued: "var(--color-st-backlog)",
  planning: "var(--color-st-executing)",
  awaiting_approval: "var(--color-st-executing)",
  executing: "var(--color-accent)",
  paused: "var(--color-st-ready)",
  held_budget: "var(--color-pr-urgent)",
  succeeded: "var(--color-st-done)",
  failed: "var(--color-pr-urgent)",
  cancelled: "var(--color-st-cancelled)",
};

/** A run in one of these is still moving, so its state dot pulses. */
export function isRunActive(status: RunStatus): boolean {
  return (
    status === "queued" ||
    status === "planning" ||
    status === "awaiting_approval" ||
    status === "executing"
  );
}

/* ── the operation log ──────────────────────────────────────────────────── */

export const OPERATION_STATUS_LABEL: Record<OperationStatus, string> = {
  proposed: "waiting for you",
  approved: "approved",
  denied: "refused",
  running: "running",
  done: "done",
  failed: "failed",
};

/** An operation waiting for an answer — the only row with controls. */
export function isPendingOperation(operation: Operation): boolean {
  return operation.status === "proposed";
}

/**
 * The target of an operation, without the kind that already sits in the badge
 * beside it. The service writes `Edit src/api/tasks.ts` (docs/09 "Records",
 * src/server/runs/tools.ts `summarizeOperation`), and the row prints the kind
 * once, not twice.
 */
export function operationTarget(operation: Operation): string {
  const prefix = `${operation.kind.charAt(0).toUpperCase()}${operation.kind.slice(1)} `;
  return operation.summary.startsWith(prefix)
    ? operation.summary.slice(prefix.length)
    : operation.summary;
}

/**
 * docs/09 "What Restore reverts": "An operation that Restore cannot revert
 * says so on its own row." Only for an operation that actually happened — a
 * refused `npm install` installed nothing, so a warning on that row would be
 * a lie about a thing that never ran.
 */
export function flagsIrreversible(operation: Operation): boolean {
  if (operation.reversible) return false;
  return (
    operation.status === "running" || operation.status === "done" || operation.status === "failed"
  );
}

/**
 * The refusal a denied row states. The service returns the reason to the
 * model rather than storing it on the operation (src/server/runs/runner.ts),
 * so the only exact reason the interface can show is the one it sent itself —
 * `denials` holds those, keyed by operation id, for as long as the tab is
 * open. Everything else was refused by the project's own rules, which is a
 * fact the row can state without inventing the wording.
 */
export function denialReason(
  operation: Operation,
  denials: ReadonlyMap<string, string>,
): string {
  return denials.get(operation.id) ?? "refused by this project's safety rules";
}

/**
 * docs/10 §3: "The permission callback returns the refusal to the model with
 * the reason" — and the run continues. What the model did next is the next
 * operation in the log, so the adaptation is a reading of the log rather than
 * a field: the row says what followed, or that nothing has yet.
 */
export function adaptationAfter(operations: readonly Operation[], index: number): string | null {
  const next = operations[index + 1];
  return next === undefined ? null : next.summary;
}

/* ── diffs ──────────────────────────────────────────────────────────────── */

export type DiffLineKind = "meta" | "hunk" | "add" | "del" | "ctx";

export interface DiffLine {
  kind: DiffLineKind;
  text: string;
}

/**
 * Splits a stored diff into coloured lines. The service builds the diff from
 * the tool's own input (src/server/runs/tools.ts `buildDiff`), so this is a
 * unified diff with `---`/`+++` headers and no hunk header of its own — but a
 * real `@@` line is recognised too, because a future diff source may carry
 * one and a hunk header is not an addition.
 */
export function parseDiff(diff: string): DiffLine[] {
  return diff.split("\n").map((text) => {
    if (text.startsWith("@@")) return { kind: "hunk" as const, text };
    if (text.startsWith("+++") || text.startsWith("---")) return { kind: "meta" as const, text };
    if (text.startsWith("+")) return { kind: "add" as const, text };
    if (text.startsWith("-")) return { kind: "del" as const, text };
    return { kind: "ctx" as const, text };
  });
}

export const DIFF_LINE_VAR: Record<DiffLineKind, string | null> = {
  meta: "var(--color-tx-muted)",
  hunk: "var(--color-tx-muted)",
  add: "var(--color-st-done)",
  del: "var(--color-pr-urgent)",
  ctx: null,
};

/* ── the counts on the bar ──────────────────────────────────────────────── */

export interface RunTally {
  total: number;
  done: number;
  failed: number;
  refused: number;
  /** Operations parked on an answer — "1 awaiting you" on the bar. */
  awaiting: number;
}

export function tallyOperations(operations: readonly Operation[]): RunTally {
  const tally: RunTally = { total: operations.length, done: 0, failed: 0, refused: 0, awaiting: 0 };
  for (const operation of operations) {
    if (operation.status === "done") tally.done += 1;
    else if (operation.status === "failed") tally.failed += 1;
    else if (operation.status === "denied") tally.refused += 1;
    else if (operation.status === "proposed") tally.awaiting += 1;
  }
  return tally;
}

/** `7 operations · 5 done · 1 refused · 1 awaiting you` — zeroes are silent. */
export function describeTally(tally: RunTally): string {
  const parts = [`${tally.total} operation${tally.total === 1 ? "" : "s"}`];
  if (tally.done > 0) parts.push(`${tally.done} done`);
  if (tally.failed > 0) parts.push(`${tally.failed} failed`);
  if (tally.refused > 0) parts.push(`${tally.refused} refused`);
  if (tally.awaiting > 0) parts.push(`${tally.awaiting} awaiting you`);
  return parts.join(" · ");
}

/* ── the runfoot ────────────────────────────────────────────────────────── */

/**
 * How long the run has been going, or how long it took. A run that never
 * started has no duration — not a zero, which would read as "instant".
 */
export function runDurationMs(run: Pick<Run, "startedAt" | "endedAt">, now: number): number | null {
  if (run.startedAt === null) return null;
  const started = Date.parse(run.startedAt);
  if (Number.isNaN(started)) return null;
  const ended = run.endedAt === null ? now : Date.parse(run.endedAt);
  if (Number.isNaN(ended)) return null;
  return Math.max(0, ended - started);
}

/** `1m 12s`, the way the mockup's runfoot prints it. */
export function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/** `38.4k`, `912`. Tokens are read at a glance, not audited on this line. */
export function formatTokens(count: number): string {
  if (count < 1000) return String(count);
  const thousands = count / 1000;
  const printed = thousands >= 100 ? thousands.toFixed(0) : thousands.toFixed(1);
  return `${printed.replace(/\.0$/, "")}k`;
}

/** `$0.27`. A cost too small to round to a cent says so rather than "$0.00". */
export function formatCost(usd: number): string {
  if (usd === 0) return "$0.00";
  if (usd < 0.005) return "<$0.01";
  return `$${usd.toFixed(2)}`;
}

/**
 * The model a run of this task uses, in the order docs/11 "Model routing"
 * fixes: the task's own override, then the project's routing field looked up
 * in `map`, then `fallback`. The run record does not store the choice, so the
 * runfoot resolves it the same way the queue did
 * (src/server/runs/routing.ts) — the same three rules, read from the project
 * the tab already has.
 */
export function resolveTaskModel(
  project: Pick<ProjectView, "modelRouting" | "fieldSchema">,
  task: Pick<TaskView, "model" | "effort" | "size" | "fields">,
): { model: string; effort: Effort | null } {
  const field = project.modelRouting.field;
  let routingValue: string | null = null;

  if (field !== null && field !== "") {
    if (field === "size") {
      routingValue = task.size;
    } else {
      const stored = task.fields[field];
      // docs/03 rule 1: a task that never stored a value still carries the
      // field's default, so it still routes.
      const definition = project.fieldSchema.find((def) => def.key === field);
      const value =
        typeof stored === "string" && stored !== ""
          ? stored
          : definition === undefined
            ? null
            : fieldView(definition).default;
      routingValue = typeof value === "string" && value !== "" ? value : null;
    }
  }

  const entry = routingValue === null ? undefined : project.modelRouting.map[routingValue];
  const choice = entry ?? project.modelRouting.fallback;
  return { model: task.model ?? choice.model, effort: task.effort ?? choice.effort };
}

/**
 * The interface never shows an effort alone (docs/11): an effort has no
 * meaning without the model that spends it.
 */
export function formatModel(choice: { model: string; effort: Effort | null }): string {
  return choice.effort === null ? choice.model : `${choice.model} · ${choice.effort}`;
}

/* ── the Restore control ────────────────────────────────────────────────── */

export type RestoreOffer =
  | { state: "offered" }
  /** docs/09: the Run tab states the reason in the control's position. */
  | { state: "unavailable"; reason: string }
  /** The run wrote nothing, or the task is finished: no control at all. */
  | { state: "none" };

/**
 * docs/09 "Restore": the control is offered while the task is not finished
 * and disappears at `done`, "at that point the changes are the product of the
 * task". A run that captured nothing has nothing to revert; a capture that
 * failed leaves a point that is not available, "with a stored reason".
 */
export function restoreOffer(run: Pick<Run, "restorePoint">, taskStatus: Status): RestoreOffer {
  if (taskStatus === "done") return { state: "none" };
  const point = run.restorePoint;
  if (point === null) return { state: "none" };
  if (point.available) return { state: "offered" };
  return {
    state: "unavailable",
    reason: point.reason ?? "the restore point could not be captured",
  };
}

/** What `POST /api/runs/:run/restore` reports back (src/server/runs/restore.ts). */
export interface RestoreOutcome {
  performed: boolean;
  method?: string;
  restored?: string[];
  deleted?: string[];
}

/** "2 files restored · 1 removed" — the line the tab prints after a revert. */
export function describeRestore(outcome: RestoreOutcome): string {
  const restored = outcome.restored?.length ?? 0;
  const deleted = outcome.deleted?.length ?? 0;
  const parts = [`${restored} file${restored === 1 ? "" : "s"} restored`];
  if (deleted > 0) parts.push(`${deleted} removed`);
  return parts.join(" · ");
}

/* ── merging a stream frame ─────────────────────────────────────────────── */

/**
 * One frame of `GET /api/runs/:run/stream` (T59). The server's shape lives in
 * src/server/runs/streams.ts; this is the client's reading of the same three
 * fields, so nothing in `src/app` imports a server module.
 */
export interface RunFrame {
  run: Run;
  /** Present only on an `operation` frame. */
  operation: Operation | null;
}

/**
 * Folds one frame into the cached run. The frame carries the run and at most
 * one operation, never the whole log, so an operation already in the log is
 * replaced in place and a new one takes its position by `seq` — the order the
 * service assigned, not the order the frames arrived in.
 */
export function applyRunFrame(current: RunView | undefined, frame: RunFrame): RunView | undefined {
  if (current === undefined || current.id !== frame.run.id) return current;
  const operations = [...current.operations];
  if (frame.operation !== null) {
    const at = operations.findIndex((operation) => operation.id === frame.operation!.id);
    if (at === -1) operations.push(frame.operation);
    else operations[at] = frame.operation;
    operations.sort((a, b) => a.seq - b.seq);
  }
  return { ...frame.run, operations };
}

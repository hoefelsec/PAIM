/**
 * The run and operation records, shared by the server that stores them and
 * the client that renders them. See docs/09-ai-run.md "Records".
 *
 * This module is the record layer only: the vocabularies, the derivation of
 * an operation's risk from its kind, and the shapes the storage layer reads
 * and writes. The runner, the approval loop, restore-point capture, and the
 * streams are later work (specs/09-ai-run.md); nothing here knows about the
 * Agent SDK.
 */

/** docs/09: one agent for one task, or the orchestrator of an epic. */
export const RUN_KINDS = ["single", "orchestrated"] as const;
export type RunKind = (typeof RUN_KINDS)[number];

/** docs/09: what put the run in the queue. */
export const RUN_TRIGGERS = ["manual", "schedule", "orchestrator"] as const;
export type RunTrigger = (typeof RUN_TRIGGERS)[number];

/** docs/09 "Records" — the nine statuses, in the order a run walks them. */
export const RUN_STATUSES = [
  "queued",
  "planning",
  "awaiting_approval",
  "executing",
  "paused",
  "held_budget",
  "succeeded",
  "failed",
  "cancelled",
] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

/**
 * A run in one of these statuses is finished: nothing moves it again.
 * docs/09 "Service restart" splits the nine on exactly this line — the
 * others are the runs a stop of the process interrupts.
 */
export const TERMINAL_RUN_STATUSES = ["succeeded", "failed", "cancelled"] as const;
export type TerminalRunStatus = (typeof TERMINAL_RUN_STATUSES)[number];

/**
 * A run the service still owns work for: `queued` waits for its turn, the
 * rest are in flight.
 */
export const ACTIVE_RUN_STATUSES = RUN_STATUSES.filter(
  (status) => !(TERMINAL_RUN_STATUSES as readonly string[]).includes(status),
) as readonly RunStatus[];

export function isTerminalRunStatus(status: RunStatus): status is TerminalRunStatus {
  return (TERMINAL_RUN_STATUSES as readonly string[]).includes(status);
}

/** docs/09 "The library": the six built-in tools of the Agent SDK. */
export const OPERATION_KINDS = ["read", "glob", "grep", "write", "edit", "bash"] as const;
export type OperationKind = (typeof OPERATION_KINDS)[number];

/** docs/13 "Operation risk colours": safe, write, exec. */
export const OPERATION_RISKS = ["safe", "write", "exec"] as const;
export type OperationRisk = (typeof OPERATION_RISKS)[number];

/** docs/09 "Records" — the operation lifecycle. */
export const OPERATION_STATUSES = [
  "proposed",
  "approved",
  "denied",
  "running",
  "done",
  "failed",
] as const;
export type OperationStatus = (typeof OPERATION_STATUSES)[number];

/**
 * docs/09 "Records": `risk` is *derived from kind*, never stored as a
 * separate decision and never accepted from a caller — reading a file
 * cannot be an `exec` operation because someone wrote it down that way.
 *
 *   read | glob | grep → safe    (nothing on the machine changes)
 *   write | edit       → write   (files change; Restore reverts them)
 *   bash               → exec    (anything can happen; docs/13's clay)
 */
export function riskForKind(kind: OperationKind): OperationRisk {
  switch (kind) {
    case "read":
    case "glob":
    case "grep":
      return "safe";
    case "write":
    case "edit":
      return "write";
    case "bash":
      return "exec";
    default: {
      const exhaustive: never = kind;
      throw new Error(`unreachable operation kind: ${String(exhaustive)}`);
    }
  }
}

/**
 * docs/09 "What Restore reverts": the restore point holds file bytes, a
 * commit and a stash — nothing else. A shell command can install a package,
 * restart a service, apply a migration or push to a remote, and none of that
 * comes back. So an operation's reversibility, like its {@link riskForKind
 * risk}, follows from its kind and is never stored: no row can claim a bash
 * command is something Restore undoes.
 *
 * docs/09: "An operation that Restore cannot revert says so on its own row."
 */
export function reversibleByRestore(kind: OperationKind): boolean {
  switch (kind) {
    case "read":
    case "glob":
    case "grep":
    case "write":
    case "edit":
      return true;
    case "bash":
      return false;
    default: {
      const exhaustive: never = kind;
      throw new Error(`unreachable operation kind: ${String(exhaustive)}`);
    }
  }
}

/** docs/09 "Restore": a git repository, or per-file byte snapshots. */
export const RESTORE_METHODS = ["git", "snapshot"] as const;
export type RestoreMethod = (typeof RESTORE_METHODS)[number];

/**
 * What a run captured before its first write (docs/09 "Restore"). The
 * capture itself is src/server/runs/restore.ts; this is the record it
 * leaves behind.
 *
 * A run whose capture failed still gets a restore point — with
 * `available: false` and the `reason` the interface shows in the position
 * of the Restore control (docs/09 "When the service cannot capture a
 * restore point"). A run that has not captured anything yet has none at
 * all (`restorePoint: null`).
 */
export interface RestorePoint {
  method: RestoreMethod;
  /** Whether Restore can run. False after a capture failure. */
  available: boolean;
  /** Why Restore is unavailable; null while it is. */
  reason: string | null;
  /** git: the commit `HEAD` named when the run started. */
  head: string | null;
  /** git: the object id of `git stash create`, null when the tree was clean. */
  stash: string | null;
  /**
   * The directory under `data/restore/<runId>` holding the original bytes.
   * The whole story in `snapshot` mode; in `git` mode it holds only the
   * files git does not track, and stays null when there are none.
   */
  snapshotDir: string | null;
  /**
   * Workspace-relative paths the run created, which Restore deletes. Kept in
   * both modes: naming them is exact, where `git clean` would also sweep up
   * files the user made while the run was working.
   */
  createdPaths: string[];
  capturedAt: string | null;
}

/** docs/09 "Records": what the run cost, read from the SDK result messages. */
export interface RunUsage {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

/**
 * One operation of one run (docs/09 "Records"). `seq` orders the log: the
 * storage layer assigns it, so two operations recorded in the same
 * millisecond still read back in the order they happened.
 */
export interface Operation {
  id: string;
  runId: string;
  seq: number;
  kind: OperationKind;
  /** Derived from `kind` — see {@link riskForKind}. */
  risk: OperationRisk;
  /**
   * Whether Restore undoes what this operation did. Derived from `kind` —
   * see {@link reversibleByRestore}; false marks the row docs/09 says must
   * state its own limit.
   */
  reversible: boolean;
  /** One line, as the run log shows it: `Edit src/api/tasks.ts`. */
  summary: string;
  status: OperationStatus;
  /** write and edit only. */
  diff: string | null;
  /** bash only. */
  stdout: string | null;
  /** bash only. */
  exitCode: number | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * An operation as it is handed to the storage layer: everything except the
 * derived fields (risk, reversibility) and the position, which the storage
 * layer assigns.
 */
export type OperationDraft = Omit<Operation, "risk" | "reversible" | "seq">;

/** One run of one task (docs/09 "Records"). */
export interface Run {
  id: string;
  taskId: string;
  projectId: string;
  kind: RunKind;
  /** Set on the children of an orchestrated run; null otherwise. */
  parentRunId: string | null;
  trigger: RunTrigger;
  status: RunStatus;
  restorePoint: RestorePoint | null;
  usage: RunUsage;
  /**
   * Why a run ended `failed` — `service_stopped` for a run a stop of the
   * process interrupted (docs/09 "Service restart"). Null otherwise.
   */
  failureReason: string | null;
  /** When the run entered the queue. A queued run has only this one. */
  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
}

/** `GET /api/runs/:run`: "one run and its operations" (docs/06). */
export type RunView = Run & { operations: Operation[] };

/**
 * The runner (specs/09-ai-run.md "Runner", docs/09-ai-run.md).
 *
 * One task, one agent, one run record. The runner drives an {@link Agent}
 * over the project's workspace and turns everything it does into the
 * `Run`/`Operation` records of docs/09:
 *
 * - **Control.** Before each tool call the runner touches the operation
 *   boundary of src/server/runs/control.ts: a pause requested through
 *   `POST /api/runs/:run/pause` stops the run *here*, between two
 *   operations — "at the end of the current operation, never
 *   mid-operation", with the agent's context parked on the run's own
 *   promise — and a cancel throws out of the loop so nothing else is
 *   proposed.
 * - **Permission.** Every tool call passes through `canUseTool`, which
 *   confines the target path (docs/10 §2) and then asks the safety policy
 *   (docs/10 §3–§5) via `decide()`. `allow` proceeds; `deny` returns the
 *   refusal *and its reason* to the model and records the operation
 *   `denied` — the run keeps going, because "a denied command must not end
 *   the run"; `ask` records the operation `proposed`, moves the run to
 *   `awaiting_approval`, and parks with no timeout until someone answers
 *   (the approve/deny endpoints are T56's).
 * - **Records.** Each operation is written when it is proposed — with its
 *   diff, for a write or an edit — and updated when its result arrives,
 *   with stdout and the exit code.
 * - **Usage.** Tokens and cost come from the agent's result message.
 *
 * Out of scope here, on purpose: the queue and model routing (T55), restore
 * points (T57), git (T58), the streams (T59), and advancing the task's
 * status when the run ends (T61).
 */

import { randomUUID } from "node:crypto";
import { isAbsolute, relative, resolve } from "node:path";
import type Database from "better-sqlite3";
import type { Operation, Run, RunStatus, RunUsage } from "../../shared/runs.js";
import type { Project, Task } from "../../shared/types.js";
import { insertOperation, updateOperation, updateRun } from "../db/runs.js";
import { ApiError } from "../errors.js";
import { confinePath } from "../safety/confine.js";
import { decide, normalizeCommand, type Operation as PolicyOperation } from "../safety/policy.js";
import {
  emptyUsage,
  type Agent,
  type AgentPermissionDecision,
  type AgentResultMessage,
} from "./agent.js";
import {
  ApprovalAbandonedError,
  type ApprovalAnswer,
  type ApprovalRegistry,
} from "./approvals.js";
import { RunCancelledError, type RunControlRegistry } from "./control.js";
import { buildDiff, describeTool, summarizeOperation } from "./tools.js";

export interface ExecuteRunOptions {
  db: Database.Database;
  /** The run record to drive. Created by the queue (T55) or by a test. */
  run: Run;
  task: Task;
  project: Project;
  agent: Agent;
  approvals: ApprovalRegistry;
  /**
   * Where pause, resume and cancel reach this run (T56). Omitted, the run
   * cannot be paused or cancelled — which is what a test that only
   * exercises the permission loop wants.
   */
  controls?: RunControlRegistry;
  /**
   * The resolved model. Routing is T55's; passing null lets the agent use
   * its own default, which is what the live smoke test does.
   */
  model?: string | null;
  signal?: AbortSignal;
  /** Injectable clock and id source, so tests get stable records. */
  now?: () => string;
  newId?: () => string;
}

/** What one run left behind. */
export interface RunOutcome {
  run: Run;
  operations: Operation[];
}

/**
 * The brief the model receives. Deliberately plain: the task's identity, its
 * description, and the words the user originally wrote (docs/02 "Task"
 * `sourcePrompt`). Gate-failure context is folded in by the pipeline hookup
 * (T61), not here.
 */
export function buildRunPrompt(task: Task): string {
  const sections: string[] = [`Task ${task.key}: ${task.title}`];
  if (task.description.trim() !== "") {
    sections.push(task.description.trim());
  }
  const source = task.sourcePrompt.trim();
  if (source !== "" && source !== task.description.trim()) {
    sections.push(`Original request:\n${source}`);
  }
  return sections.join("\n\n");
}

/**
 * The workspace root in the same canonical, symlink-free form
 * {@link confinePath} returns, so a relative path can be computed from the
 * two. Asking `confinePath` for the root itself is what guarantees the two
 * agree — a root that does not exist yet, or one reached through a symlink,
 * is canonicalized by exactly the same code that canonicalized the target.
 */
function canonicalRoot(root: string): string {
  const confined = confinePath(root, ".");
  return confined.ok ? confined.path : resolve(root);
}

/** A workspace-relative path for the run log; absolute if somehow outside. */
function displayPath(root: string, absolutePath: string): string {
  const rel = relative(root, absolutePath);
  if (rel === "") return ".";
  if (rel.startsWith("..") || isAbsolute(rel)) return absolutePath;
  return rel;
}

export async function executeRun(options: ExecuteRunOptions): Promise<RunOutcome> {
  const {
    db,
    task,
    project,
    agent,
    approvals,
    controls,
    model = null,
    signal,
    now = () => new Date().toISOString(),
    newId = () => randomUUID(),
  } = options;

  const workspacePath = project.workspacePath;
  if (workspacePath === null || workspacePath === "") {
    // docs/10 §2: "A project without a workspace path cannot run tasks."
    // The queue refuses this earlier (T55); the runner refuses it too, so
    // no caller can drive an agent with no root to confine it to.
    throw new ApiError(
      "NO_WORKSPACE",
      422,
      { project: project.slug },
      `Project "${project.slug}" has no workspace path`,
    );
  }

  const displayRoot = canonicalRoot(workspacePath);
  // Registered before anything runs, so `POST /api/runs/:run/pause|cancel`
  // can reach this run from its first operation on. The handle owns the
  // signal from here: a cancel aborts it, and everything the run waits on —
  // the agent, a parked approval — waits on it.
  const control = controls?.register(options.run.id, signal) ?? null;
  const runSignal = control?.signal ?? signal;
  let current: Run = { ...options.run };
  /** Operations recorded by this run, in the order they happened. */
  const recorded = new Map<string, Operation>();
  /** toolUseId → operation id, so a result can find the row it belongs to. */
  const byToolUse = new Map<string, string>();
  /** Operations parked in the approval registry right now. */
  const parked = new Set<string>();

  function saveRun(patch: Partial<Run>): void {
    current = { ...current, ...patch };
    updateRun(db, current);
  }

  function setStatus(status: RunStatus): void {
    if (current.status === status) return;
    saveRun({ status });
  }

  function addOperation(
    kind: Operation["kind"],
    summary: string,
    status: Operation["status"],
    diff: string | null,
  ): Operation {
    const timestamp = now();
    const operation = insertOperation(db, {
      id: newId(),
      runId: current.id,
      kind,
      summary,
      status,
      diff,
      stdout: null,
      exitCode: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    recorded.set(operation.id, operation);
    return operation;
  }

  function patchOperation(id: string, patch: Partial<Operation>): void {
    const existing = recorded.get(id);
    if (!existing) return;
    const next = updateOperation(db, { ...existing, ...patch, updatedAt: now() });
    recorded.set(id, next);
  }

  /**
   * The operation boundary (docs/09 "Cancel and Restore are different
   * actions"). Reached once per tool call, *before* the tool is described,
   * decided or recorded — so a paused run holds no half-formed operation,
   * and a cancelled run proposes nothing more.
   */
  async function operationBoundary(): Promise<void> {
    if (!control) return;
    if (!control.isPaused()) {
      // Resolves at once, or throws for a run that was cancelled.
      await control.boundary();
      return;
    }
    // The previous operation has already reported back; this is the end of
    // it. The status the run returns to is the one it was in, because a
    // pause changes nothing about the work — only when it happens.
    const resumeTo: RunStatus = current.status === "paused" ? "executing" : current.status;
    setStatus("paused");
    await control.boundary();
    setStatus(resumeTo);
  }

  const canUseTool = async (
    toolName: string,
    input: Record<string, unknown>,
    context: { toolUseId: string; signal?: AbortSignal },
  ): Promise<AgentPermissionDecision> => {
    await operationBoundary();

    const described = describeTool(toolName, input);
    if (!described) {
      // Not one of the six built-in tools (docs/09 "The library"). Refuse
      // without a record: there is no operation kind that describes it.
      return {
        behavior: "deny",
        message: `The tool "${toolName}" is not available to this run. Use Read, Write, Edit, Bash, Glob, or Grep.`,
      };
    }

    // --- The target, canonicalized and confined (docs/10 §2) -------------
    let policyOperation: PolicyOperation;
    let display: string;

    if (described.command !== null) {
      display = normalizeCommand(described.command);
      policyOperation = { kind: "bash", command: described.command };
    } else {
      // Glob and Grep may omit their path; that means the workspace root.
      const candidate = described.path ?? ".";
      const confined = confinePath(workspacePath, candidate);
      if (!confined.ok) {
        addOperation(described.kind, summarizeOperation(described.kind, candidate), "denied", null);
        return {
          behavior: "deny",
          message: `The path "${candidate}" is outside the project workspace. Every path must resolve inside ${workspacePath}.`,
        };
      }
      display = displayPath(displayRoot, confined.path);
      // docs/10 §4: an entry is matched against "the target path of a file
      // operation", and every entry the docs and the project policy use is
      // written relative to the workspace — `secrets/**`, `src/**`, `.env`,
      // `*.env`. The policy therefore sees that same relative form, not the
      // absolute path the tool will touch: anchored entries never match an
      // absolute path (`secrets/**` does not match `/tmp/ws/secrets/db.env`),
      // so feeding `confined.path` here would silently disable exactly the
      // deny-list entries docs/10 §3 says cannot be overridden.
      policyOperation = { kind: "file", path: display };
    }

    const summary = summarizeOperation(described.kind, display);
    const diff = buildDiff(described.kind, input, display);

    // --- The policy (docs/10 §3–§5) --------------------------------------
    const decision = decide(policyOperation, project.safety, task.safety?.mode ?? null);

    if (decision === "deny") {
      addOperation(described.kind, summary, "denied", diff);
      // The refusal and its reason go back to the model; the run continues.
      return {
        behavior: "deny",
        message: `Refused: "${display}" matches this project's deny list, which cannot be overridden by a task or an approval. Choose a different approach.`,
      };
    }

    if (decision === "allow") {
      const operation = addOperation(described.kind, summary, "running", diff);
      byToolUse.set(context.toolUseId, operation.id);
      setStatus("executing");
      return { behavior: "allow" };
    }

    // --- ask: park, with no deadline (docs/10 §4) -------------------------
    const operation = addOperation(described.kind, summary, "proposed", diff);
    byToolUse.set(context.toolUseId, operation.id);
    setStatus("awaiting_approval");
    parked.add(operation.id);

    let answer: ApprovalAnswer;
    try {
      answer = await approvals.wait(operation.id, context.signal ?? runSignal);
    } finally {
      parked.delete(operation.id);
    }

    if (!answer.approved) {
      patchOperation(operation.id, { status: "denied" });
      byToolUse.delete(context.toolUseId);
      setStatus("executing");
      return { behavior: "deny", message: answer.reason };
    }

    // Both transitions are written: `approved` is the answer the user gave
    // and `running` is what happens next, and docs/09 "Records" walks the
    // lifecycle through both. The run stream (T59) reads this sequence.
    patchOperation(operation.id, { status: "approved" });
    patchOperation(operation.id, { status: "running" });
    setStatus("executing");
    return { behavior: "allow" };
  };

  // --- Drive the agent ----------------------------------------------------
  // The outer `finally` releases the run's controls *after* the final record
  // is written: until then a cancel must still find this run in flight
  // rather than race its ending.
  try {
    saveRun({ status: "planning", startedAt: current.startedAt ?? now() });

    let result: AgentResultMessage | null = null;
    let failure: string | null = null;

    try {
      for await (const message of agent.run({
        prompt: buildRunPrompt(task),
        cwd: workspacePath,
        model,
        canUseTool,
        ...(runSignal ? { signal: runSignal } : {}),
      })) {
        if (message.type === "tool_result") {
          const operationId = byToolUse.get(message.toolUseId);
          if (!operationId) continue;
          byToolUse.delete(message.toolUseId);
          patchOperation(operationId, {
            status: message.isError ? "failed" : "done",
            stdout: message.stdout ?? message.text,
            exitCode: message.exitCode,
          });
          continue;
        }
        // The agent may report more than once in a resumed session; docs say
        // to read the latest, so the last result wins.
        result = message;
      }
    } catch (error) {
      failure =
        error instanceof RunCancelledError
          ? "cancelled_by_user"
          : error instanceof ApprovalAbandonedError
            ? "approval_abandoned"
            : error instanceof Error
              ? error.message
              : String(error);
    } finally {
      // A run that ends while an operation is parked must not leave a
      // promise waiting forever on a run nobody is driving any more.
      for (const operationId of parked) approvals.abandon(operationId);
      parked.clear();
    }

    // Any operation still running when the stream ended never reported back.
    for (const operationId of byToolUse.values()) {
      const operation = recorded.get(operationId);
      if (operation && (operation.status === "running" || operation.status === "proposed")) {
        patchOperation(operationId, { status: "failed" });
      }
    }
    byToolUse.clear();

    const usage: RunUsage = result?.usage ?? emptyUsage();

    if (failure === null && result === null) {
      failure = "agent_ended_without_result";
    } else if (failure === null && result && !result.ok) {
      failure = result.errorMessage ?? "agent_failed";
    }

    // docs/09: "Cancel — the run stops. The changes stay." A cancelled run
    // is not a failed one, whatever the agent was doing when it stopped, and
    // it carries no `failureReason`: the status is the whole story.
    const cancelled = control?.isCancelled() ?? false;

    saveRun({
      status: cancelled ? "cancelled" : failure === null ? "succeeded" : "failed",
      failureReason: cancelled ? null : failure,
      usage,
      endedAt: now(),
    });

    return {
      run: current,
      operations: [...recorded.values()].sort((a, b) => a.seq - b.seq),
    };
  } finally {
    control?.release();
  }
}

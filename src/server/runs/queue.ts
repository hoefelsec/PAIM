/**
 * The run queue (specs/09-ai-run.md "Queue", docs/05-dependencies.md, T55).
 *
 * Two operations, deliberately separate, because docs/05 makes them
 * separate:
 *
 * - **enqueue** always succeeds for a runnable project. "The user can put
 *   such a task in the queue" — a task whose dependencies are not done is
 *   queued anyway; only a project with no `workspacePath` is refused
 *   (`422 NO_WORKSPACE`, docs/10 §2), together with a model this project
 *   does not allow (`422 MODEL_NOT_ALLOWED`, docs/11).
 * - **start** is the strict one. "The queue stops the task when its turn
 *   arrives. The queue reports the name of the unfinished dependency": an
 *   unmet dependency refuses the start with `409 DEPENDENCY_NOT_MET`
 *   naming the blocker, and a start that passes waits for a writer slot
 *   from the safety kernel's semaphore (docs/10 §6) before the agent
 *   touches the workspace. The task moves to `executing` at that moment —
 *   when the run really begins, not when it was queued.
 *
 * `dispatch` is the loop between them: it walks the project's queued runs
 * oldest first, skips the ones a dependency blocks, and starts the rest in
 * the background. Nothing here is awaited by an HTTP handler — "no endpoint
 * blocks on a run" (specs/README) — so the route enqueues, kicks the
 * dispatcher, and answers.
 *
 * Out of scope, on purpose: the control endpoints (T56), git (T58), the
 * streams (T59), and budget caps (T63).
 *
 * What happens when a run ends belongs here too (docs/04
 * "Failure moves the task back to `executing`", T61):
 *
 * - `succeeded` → `advance()` the task into the next enabled gate
 *   (`testing`/`ai_review`/`manual_review`/`done`) — the "run" gate of
 *   `executing` is exactly this, ending without error.
 * - `failed` → `fail()` the task, which is a no-op move back to the status
 *   it is already in (`executing`) that stores the reason for the next
 *   run's brief (`buildRunPrompt`, src/server/runs/runner.ts).
 * - `cancelled` → nothing. docs/09: "Cancel — the run stops. The changes
 *   stay." It is not a failure, and the task is already `executing`.
 */

import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { getProjectById } from "../db/projects.js";
import { getRunById, insertRun, listQueuedRuns, updateRun } from "../db/runs.js";
import { getTaskById, nextTimestamp, updateTask } from "../db/tasks.js";
import { ApiError } from "../errors.js";
import type { WriterSemaphore } from "../safety/semaphore.js";
import { unmetDependencies } from "../tasks/dependencies.js";
import { closedAtFor } from "../../shared/pipeline.js";
import { advance, fail } from "../tasks/pipeline.js";
import type { Run, RunTrigger } from "../../shared/runs.js";
import type { Project, Task } from "../../shared/types.js";
import type { Agent } from "./agent.js";
import type { ApprovalRegistry } from "./approvals.js";
import type { RunControlRegistry } from "./control.js";
import { resolveRunModel, type ResolvedRunModel } from "./routing.js";
import { executeRun, type RunOutcome } from "./runner.js";

/** How the queue names a task that blocks a start, on the wire. */
export interface Blocker {
  id: string;
  key: string;
  title: string;
  status: string;
}

function describeBlockers(tasks: readonly Task[]): Blocker[] {
  return tasks.map((task) => ({
    id: task.id,
    key: task.key,
    title: task.title,
    status: task.status,
  }));
}

export interface EnqueueInput {
  project: Project;
  task: Task;
  /** docs/09 "Records": what put the run in the queue. Defaults to `manual`. */
  trigger?: RunTrigger;
  /** Set on the children of an orchestrated run (T60). */
  parentRunId?: string | null;
}

export interface EnqueueResult {
  run: Run;
  /**
   * The dependencies that are not done. Empty for a run that can start at
   * once; otherwise the names docs/05 says the queue reports.
   */
  blockedBy: Blocker[];
  /** What the run will use if it starts now (docs/11). */
  model: ResolvedRunModel;
}

export interface RunQueueOptions {
  db: Database.Database;
  semaphore: WriterSemaphore;
  approvals: ApprovalRegistry;
  /**
   * Where pause, resume and cancel reach a run the queue started (T56).
   * Handed straight to the runner, which registers each run it drives.
   */
  controls?: RunControlRegistry;
  /** One {@link Agent} per run. Tests pass a fake; production passes the SDK. */
  createAgent?: () => Agent;
  /**
   * Whether {@link RunQueue.dispatch} actually starts anything. A test that
   * only exercises the enqueue half turns it off.
   */
  autoStart?: boolean;
  /**
   * Where `data/restore/<runId>` is rooted (docs/09 "Restore"). Handed
   * straight to the runner; a test points it at a temp directory.
   */
  restoreRoot?: string;
  /** Injectable clock and id source, so tests get stable records. */
  now?: () => string;
  newId?: () => string;
}

export interface RunQueue {
  /** Puts a run in the queue. Never blocked by a dependency (docs/05). */
  enqueue(input: EnqueueInput): EnqueueResult;
  /**
   * Starts one queued run: dependency check, writer slot, task to
   * `executing`, agent. Rejects with `409 DEPENDENCY_NOT_MET` when a
   * dependency of the task is not done.
   */
  start(runId: string): Promise<RunOutcome>;
  /** Starts every queued run of a project that nothing blocks. */
  dispatch(projectId: string): void;
  /** The unfinished dependencies of a task, as the queue reports them. */
  blockers(task: Task): Blocker[];
  /** Resolves what a run of this task would use (docs/11). */
  resolveModel(project: Project, task: Task): ResolvedRunModel;
  /** Resolves once every run this queue started has ended. For tests. */
  idle(): Promise<void>;
  /** Runs this queue is currently driving. */
  running(): string[];
}

/**
 * The Agent SDK, imported the first time a run actually needs it. Keeping
 * the import out of the module graph means creating the Fastify app — which
 * every route test does — never loads the SDK.
 */
function lazySdkAgent(): Agent {
  return {
    async *run(request) {
      const { createSdkAgent } = await import("./sdkAgent.js");
      yield* createSdkAgent().run(request);
    },
  };
}

/** docs/10 §2: "A project without a workspace path cannot run tasks." */
function requireWorkspace(project: Project): string {
  if (project.workspacePath === null || project.workspacePath === "") {
    throw new ApiError(
      "NO_WORKSPACE",
      422,
      { project: project.slug },
      `Project "${project.slug}" has no workspace path; set one before running a task`,
    );
  }
  return project.workspacePath;
}

export function createRunQueue(options: RunQueueOptions): RunQueue {
  const {
    db,
    semaphore,
    approvals,
    controls,
    createAgent = lazySdkAgent,
    autoStart = true,
    restoreRoot,
    now = () => new Date().toISOString(),
    newId = () => randomUUID(),
  } = options;

  /** Runs this queue has handed to `start` and not yet seen finish. */
  const inFlight = new Map<string, Promise<unknown>>();
  /** Runs a start refused for a reason retrying cannot fix. */
  const abandoned = new Set<string>();

  function blockers(task: Task): Blocker[] {
    return describeBlockers(unmetDependencies(db, task));
  }

  function enqueue(input: EnqueueInput): EnqueueResult {
    const { project, task, trigger = "manual", parentRunId = null } = input;
    requireWorkspace(project);
    // Refused here as well as at start: a task pinned to a model the
    // project does not allow can never run, and saying so when the user
    // asks is better than a run that fails on its turn.
    const model = resolveRunModel(project, task);

    const timestamp = now();
    const run = insertRun(db, {
      id: newId(),
      taskId: task.id,
      projectId: project.id,
      // An epic starts an orchestrator instead (docs/09); that run kind is
      // T60's, so every run this queue creates is a single one.
      kind: "single",
      parentRunId,
      trigger,
      status: "queued",
      restorePoint: null,
      usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
      failureReason: null,
      createdAt: timestamp,
      startedAt: null,
      endedAt: null,
    });

    return { run, blockedBy: blockers(task), model };
  }

  /** Moves the task to `executing` — docs/09: the run has begun. */
  function markExecuting(task: Task): Task {
    if (task.status === "executing") return task;
    const timestamp = nextTimestamp(task.updatedAt);
    // Not `withStatus`: that clears `failureReason`, and docs/04 keeps the
    // reason of the last failed gate until the *next advance*, because the
    // run about to start is the one that has to read it (T61).
    return updateTask(db, {
      ...task,
      status: "executing",
      closedAt: closedAtFor("executing", task.closedAt, timestamp),
      updatedAt: timestamp,
    });
  }

  /**
   * The pipeline hookup (T61): what a finished run does to the task it ran
   * for. Applied once the run reaches a terminal status, so a paused or
   * awaiting-approval run — which is not finished — leaves the task alone.
   */
  function applyRunOutcome(project: Project, run: Run): void {
    const task = getTaskById(db, run.taskId);
    // The task may have been trashed while the run was in flight; there is
    // nothing left to advance.
    if (!task) return;

    if (run.status === "succeeded") {
      const timestamp = nextTimestamp(task.updatedAt);
      updateTask(db, { ...advance(task, project.statuses, timestamp), updatedAt: timestamp });
      return;
    }

    if (run.status === "failed") {
      const timestamp = nextTimestamp(task.updatedAt);
      const reason = run.failureReason?.trim() || "The run failed";
      updateTask(db, { ...fail(task, reason, timestamp), updatedAt: timestamp });
      return;
    }

    // `cancelled`, or any other status: the task stays exactly where it is.
  }

  async function start(runId: string): Promise<RunOutcome> {
    const run = getRunById(db, runId);
    if (!run) {
      throw new ApiError("RUN_NOT_FOUND", 404, { run: runId }, `No run "${runId}"`);
    }
    if (run.status !== "queued") {
      throw new ApiError(
        "RUN_NOT_QUEUED",
        409,
        { run: run.id, status: run.status },
        `Run "${run.id}" is "${run.status}"; only a queued run starts`,
      );
    }

    const task = getTaskById(db, run.taskId);
    if (!task) {
      throw new ApiError(
        "TASK_NOT_FOUND",
        404,
        { run: run.id, task: run.taskId },
        `The task of run "${run.id}" no longer exists`,
      );
    }
    const project = getProjectById(db, run.projectId);
    if (!project) {
      throw new ApiError(
        "PROJECT_NOT_FOUND",
        404,
        { run: run.id, project: run.projectId },
        `The project of run "${run.id}" no longer exists`,
      );
    }

    requireWorkspace(project);

    // docs/05: "The service does not start work when the condition of the
    // work is false." The run keeps its place in the queue; only the start
    // is refused, and the refusal names the blocker.
    const blocking = unmetDependencies(db, task);
    if (blocking.length > 0) {
      const named = describeBlockers(blocking);
      throw new ApiError(
        "DEPENDENCY_NOT_MET",
        409,
        { run: run.id, task: task.key, blockedBy: named },
        `"${task.key}" depends on ${named.map((b) => `"${b.key}"`).join(", ")}, ` +
          `which ${named.length === 1 ? "is" : "are"} not done`,
      );
    }

    // Resolved before the wait, so a task routed to a model the project
    // forbids does not sit in a slot to find out (docs/11).
    const routed = resolveRunModel(project, task);

    // docs/10 §6: only a writing agent holds a slot, and the capacity read
    // here is the project's current `maxConcurrentRuns`, so a change to it
    // applies to the next acquisition.
    return semaphore.run(project.id, project.maxConcurrentRuns, async () => {
      // The wait can be long. Everything is re-read on the other side of
      // it: another caller may have cancelled the run (T56), and the task
      // may have moved.
      const current = getRunById(db, run.id);
      if (!current || current.status !== "queued") {
        throw new ApiError(
          "RUN_NOT_QUEUED",
          409,
          { run: run.id, status: current?.status ?? null },
          `Run "${run.id}" left the queue while it waited for a writer slot`,
        );
      }
      const freshTask = getTaskById(db, current.taskId) ?? task;
      const freshProject = getProjectById(db, current.projectId) ?? project;

      const executing = markExecuting(freshTask);

      const outcome = await executeRun({
        db,
        run: current,
        task: executing,
        project: freshProject,
        agent: createAgent(),
        approvals,
        ...(controls ? { controls } : {}),
        ...(restoreRoot === undefined ? {} : { restoreRoot }),
        model: routed.model,
        now,
        newId,
      });

      applyRunOutcome(freshProject, outcome.run);

      return outcome;
    });
  }

  /**
   * Records a start this queue cannot retry. A dependency is not one of
   * those: it can become met, and the run stays queued for that.
   */
  function handleStartFailure(runId: string, error: unknown): void {
    const code = error instanceof ApiError ? error.code : null;
    if (code === "DEPENDENCY_NOT_MET") return;

    const run = getRunById(db, runId);
    // A run someone paused while it waited for a writer slot left the queue
    // for a reason that reverses itself: resume puts it back (T56), and the
    // next dispatch must consider it again. Everything else here is final.
    if (run?.status === "paused") return;

    abandoned.add(runId);
    if (!run || run.status !== "queued") return;
    updateRun(db, {
      ...run,
      status: "failed",
      failureReason: code ?? (error instanceof Error ? error.message : String(error)),
      endedAt: now(),
    });
  }

  function dispatch(projectId: string): void {
    if (!autoStart) return;

    // Oldest first: the queue serves the run that has waited longest.
    const queued = listQueuedRuns(db, projectId).filter(
      (run) => !inFlight.has(run.id) && !abandoned.has(run.id),
    );

    for (const run of queued) {
      const task = getTaskById(db, run.taskId);
      // docs/05: a blocked run keeps its place and is looked at again the
      // next time the queue is dispatched.
      if (!task || unmetDependencies(db, task).length > 0) continue;

      // `start` is synchronous up to its first `await`, so calling it in
      // this loop reaches the semaphore in queue order — the FIFO the
      // semaphore then preserves.
      const promise = start(run.id)
        .catch((error: unknown) => {
          handleStartFailure(run.id, error);
        })
        .finally(() => {
          inFlight.delete(run.id);
          // A slot just freed and a dependency may just have been met.
          dispatch(projectId);
        });
      inFlight.set(run.id, promise);
    }
  }

  async function idle(): Promise<void> {
    while (inFlight.size > 0) {
      await Promise.allSettled([...inFlight.values()]);
    }
  }

  return {
    enqueue,
    start,
    dispatch,
    blockers,
    resolveModel: (project, task) => resolveRunModel(project, task),
    idle,
    running: () => [...inFlight.keys()],
  };
}

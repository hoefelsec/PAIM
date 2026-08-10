/**
 * The run queue (T55's Done line: "queue/start separation; dependency block
 * at start time"; specs/09-ai-run.md "Queue", docs/05-dependencies.md).
 *
 * No SDK and no network: every run is driven by a scripted agent, and the
 * only workspace involved is a temporary directory.
 */

import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase } from "../../../src/server/db/index.js";
import { insertProject, updateProject } from "../../../src/server/db/projects.js";
import { getRunById } from "../../../src/server/db/runs.js";
import { getTaskById, insertTask, updateTask } from "../../../src/server/db/tasks.js";
import { ApiError } from "../../../src/server/errors.js";
import { defaultSettings } from "../../../src/server/projects/defaults.js";
import { createApprovalRegistry } from "../../../src/server/runs/approvals.js";
import { createFakeAgent } from "../../../src/server/runs/fakeAgent.js";
import { createRunQueue, type RunQueue } from "../../../src/server/runs/queue.js";
import { createWriterSemaphore } from "../../../src/server/safety/semaphore.js";
import type { Agent, AgentMessage, AgentRequest } from "../../../src/server/runs/agent.js";
import type { Project, SafetyPolicy, Task } from "../../../src/shared/types.js";

const ALLOW_ALL: SafetyPolicy = { denyList: [], mode: "allow_all", askList: [] };

let dir: string;
let workspace: string;
let db: Database.Database;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "paim-queue-"));
  workspace = mkdtempSync(join(tmpdir(), "paim-workspace-"));
  db = openDatabase(join(dir, "paim.db"));
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
  rmSync(workspace, { recursive: true, force: true });
});

function makeProject(overrides: Partial<Project> = {}): Project {
  const now = new Date().toISOString();
  return insertProject(db, {
    ...defaultSettings(),
    id: randomUUID(),
    slug: `project-${randomUUID()}`,
    name: "PAIM",
    workspacePath: workspace,
    safety: ALLOW_ALL,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    ...overrides,
  });
}

let keyCounter = 0;

function makeTask(project: Project, overrides: Partial<Task> = {}): Task {
  const now = new Date().toISOString();
  keyCounter += 1;
  return insertTask(db, {
    id: randomUUID(),
    key: `FEAT-${keyCounter}`,
    projectId: project.id,
    title: "Queue this",
    description: "Do the work.",
    status: "ready",
    priority: "none",
    size: "M",
    kind: "task",
    labels: [],
    assignee: null,
    parentId: null,
    order: 0,
    fields: {},
    model: null,
    effort: null,
    safety: null,
    childManualReview: null,
    schedule: null,
    dependsOn: [],
    questions: [],
    designOptions: [],
    tests: [],
    reviews: [],
    sourcePrompt: "queue this",
    evaluatedAt: null,
    staleReason: null,
    failureReason: null,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
    closedAt: null,
    ...overrides,
  });
}

interface QueueHarness {
  queue: RunQueue;
  /** Every agent the queue built, in the order it built them. */
  agents: ReturnType<typeof createFakeAgent>[];
  semaphore: ReturnType<typeof createWriterSemaphore>;
}

function makeQueue(
  options: { autoStart?: boolean; createAgent?: () => Agent; now?: () => string } = {},
): QueueHarness {
  const agents: ReturnType<typeof createFakeAgent>[] = [];
  const semaphore = createWriterSemaphore();
  const queue = createRunQueue({
    db,
    semaphore,
    approvals: createApprovalRegistry(),
    createAgent:
      options.createAgent ??
      (() => {
        const agent = createFakeAgent({ result: { usage: { inputTokens: 10, outputTokens: 2 } } });
        agents.push(agent);
        return agent;
      }),
    ...(options.autoStart === undefined ? {} : { autoStart: options.autoStart }),
    ...(options.now ? { now: options.now } : {}),
  });
  return { queue, agents, semaphore };
}

function expectApiError(thrown: unknown, code: string, status: number): ApiError {
  expect(thrown).toBeInstanceOf(ApiError);
  const error = thrown as ApiError;
  expect(error.code).toBe(code);
  expect(error.status).toBe(status);
  return error;
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected the promise to reject");
}

describe("enqueue", () => {
  it("puts a queued run on the task and starts nothing by itself", () => {
    const project = makeProject();
    const task = makeTask(project);
    const { queue } = makeQueue({ autoStart: false });

    const { run, blockedBy } = queue.enqueue({ project, task });

    expect(run.status).toBe("queued");
    expect(run.kind).toBe("single");
    expect(run.trigger).toBe("manual");
    expect(run.startedAt).toBeNull();
    expect(blockedBy).toEqual([]);
    // The task moves to `executing` on start, not on queue (T55).
    expect(getTaskById(db, task.id)?.status).toBe("ready");
  });

  it("refuses a project with no workspace path (422 NO_WORKSPACE)", () => {
    const project = makeProject({ workspacePath: null });
    const task = makeTask(project);
    const { queue } = makeQueue({ autoStart: false });

    let thrown: unknown;
    try {
      queue.enqueue({ project, task });
    } catch (error) {
      thrown = error;
    }
    expectApiError(thrown, "NO_WORKSPACE", 422);
  });

  it("refuses a model the project does not allow (422 MODEL_NOT_ALLOWED)", () => {
    const project = makeProject({ allowedModels: ["claude-sonnet-5"] });
    const task = makeTask(project, { model: "claude-fable-5" });
    const { queue } = makeQueue({ autoStart: false });

    let thrown: unknown;
    try {
      queue.enqueue({ project, task });
    } catch (error) {
      thrown = error;
    }
    const error = expectApiError(thrown, "MODEL_NOT_ALLOWED", 422);
    expect(error.details).toMatchObject({ model: "claude-fable-5" });
  });

  it("queues a task with an unmet dependency and names the blocker", () => {
    const project = makeProject();
    const blocker = makeTask(project, { title: "Ship the schema" });
    const task = makeTask(project, { dependsOn: [blocker.id] });
    const { queue } = makeQueue({ autoStart: false });

    const { run, blockedBy } = queue.enqueue({ project, task });

    expect(run.status).toBe("queued");
    expect(blockedBy).toEqual([
      { id: blocker.id, key: blocker.key, title: "Ship the schema", status: blocker.status },
    ]);
  });

  it("reports the routed model the run will use", () => {
    const project = makeProject({
      modelRouting: {
        field: "size",
        map: { XS: { model: "claude-haiku-4-5", effort: "low" } },
        fallback: { model: "claude-opus-5", effort: "high" },
      },
    });
    const task = makeTask(project, { size: "XS" });
    const { queue } = makeQueue({ autoStart: false });

    expect(queue.enqueue({ project, task }).model).toMatchObject({
      model: "claude-haiku-4-5",
      effort: "low",
    });
  });
});

describe("start", () => {
  it("refuses an unmet dependency with 409 DEPENDENCY_NOT_MET naming the blocker", async () => {
    const project = makeProject();
    const blocker = makeTask(project, { title: "Ship the schema" });
    const task = makeTask(project, { dependsOn: [blocker.id] });
    const { queue } = makeQueue({ autoStart: false });
    const { run } = queue.enqueue({ project, task });

    const error = expectApiError(await rejection(queue.start(run.id)), "DEPENDENCY_NOT_MET", 409);
    expect(error.message).toContain(blocker.key);
    expect(error.details).toMatchObject({
      task: task.key,
      blockedBy: [{ key: blocker.key, title: "Ship the schema" }],
    });

    // The run keeps its place; the task never moved.
    expect(getRunById(db, run.id)?.status).toBe("queued");
    expect(getTaskById(db, task.id)?.status).toBe("ready");
  });

  it("starts once the dependency is done, and moves the task to executing", async () => {
    const project = makeProject();
    const blocker = makeTask(project);
    const task = makeTask(project, { dependsOn: [blocker.id] });
    const { queue, agents } = makeQueue({ autoStart: false });
    const { run } = queue.enqueue({ project, task });

    await rejection(queue.start(run.id));
    updateTask(db, { ...blocker, status: "done" });

    const outcome = await queue.start(run.id);

    expect(outcome.run.status).toBe("succeeded");
    expect(outcome.run.startedAt).not.toBeNull();
    expect(getTaskById(db, task.id)?.status).toBe("executing");
    expect(agents).toHaveLength(1);
    expect(agents[0]!.requests[0]?.cwd).toBe(workspace);
    expect(getRunById(db, run.id)?.usage.inputTokens).toBe(10);
  });

  it("hands the agent the routed model", async () => {
    const project = makeProject({
      modelRouting: {
        field: "size",
        map: { S: { model: "claude-sonnet-5", effort: "medium" } },
        fallback: { model: "claude-opus-5", effort: "high" },
      },
    });
    const task = makeTask(project, { size: "S" });
    const { queue, agents } = makeQueue({ autoStart: false });
    const { run } = queue.enqueue({ project, task });

    await queue.start(run.id);

    expect(agents[0]!.requests[0]?.model).toBe("claude-sonnet-5");
  });

  it("refuses a run that is not queued (409 RUN_NOT_QUEUED)", async () => {
    const project = makeProject();
    const task = makeTask(project);
    const { queue } = makeQueue({ autoStart: false });
    const { run } = queue.enqueue({ project, task });

    await queue.start(run.id);
    expectApiError(await rejection(queue.start(run.id)), "RUN_NOT_QUEUED", 409);
  });

  it("keeps a failure reason the last gate left on the task", async () => {
    const project = makeProject();
    const task = makeTask(project, { status: "executing", failureReason: "two tests fail" });
    const { queue } = makeQueue({ autoStart: false });
    const { run } = queue.enqueue({ project, task });

    await queue.start(run.id);

    expect(getTaskById(db, task.id)?.failureReason).toBe("two tests fail");
  });
});

/** An agent that reports it started and waits until the test lets it finish. */
function gateAgent(): { agent: Agent; started: string[]; release: () => void } {
  const started: string[] = [];
  let release = (): void => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const agent: Agent = {
    async *run(request: AgentRequest): AsyncIterable<AgentMessage> {
      started.push(request.prompt);
      await gate;
      yield {
        type: "result",
        ok: true,
        usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
        errorMessage: null,
      };
    },
  };
  return { agent, started, release: () => release() };
}

describe("the writer semaphore gates starts", () => {
  it("capacity 1: the second run of a project waits for the first", async () => {
    const project = makeProject({ maxConcurrentRuns: 1 });
    const first = makeTask(project, { title: "First" });
    const second = makeTask(project, { title: "Second" });
    const gate = gateAgent();
    const { queue } = makeQueue({ autoStart: false, createAgent: () => gate.agent });

    const runA = queue.enqueue({ project, task: first }).run;
    const runB = queue.enqueue({ project, task: second }).run;

    const a = queue.start(runA.id);
    const b = queue.start(runB.id);
    await Promise.resolve();
    await Promise.resolve();

    expect(gate.started).toHaveLength(1);
    expect(getTaskById(db, second.id)?.status).toBe("ready");

    gate.release();
    await Promise.all([a, b]);

    expect(gate.started).toHaveLength(2);
    expect(getTaskById(db, second.id)?.status).toBe("executing");
  });

  it("capacity 2: both runs of a project execute at once", async () => {
    const project = makeProject({ maxConcurrentRuns: 2 });
    const first = makeTask(project);
    const second = makeTask(project);
    const gate = gateAgent();
    const { queue } = makeQueue({ autoStart: false, createAgent: () => gate.agent });

    const a = queue.start(queue.enqueue({ project, task: first }).run.id);
    const b = queue.start(queue.enqueue({ project, task: second }).run.id);
    await Promise.resolve();
    await Promise.resolve();

    expect(gate.started).toHaveLength(2);

    gate.release();
    await Promise.all([a, b]);
  });

  it("two projects never contend", async () => {
    const one = makeProject({ maxConcurrentRuns: 1 });
    const two = makeProject({ maxConcurrentRuns: 1 });
    const gate = gateAgent();
    const { queue } = makeQueue({ autoStart: false, createAgent: () => gate.agent });

    const a = queue.start(queue.enqueue({ project: one, task: makeTask(one) }).run.id);
    const b = queue.start(queue.enqueue({ project: two, task: makeTask(two) }).run.id);
    await Promise.resolve();
    await Promise.resolve();

    expect(gate.started).toHaveLength(2);

    gate.release();
    await Promise.all([a, b]);
  });
});

describe("dispatch", () => {
  it("starts what it can and leaves a blocked run queued", async () => {
    const project = makeProject();
    const blocker = makeTask(project, { title: "Ship the schema" });
    const blocked = makeTask(project, { dependsOn: [blocker.id] });
    const free = makeTask(project);
    const { queue } = makeQueue();

    const blockedRun = queue.enqueue({ project, task: blocked }).run;
    const freeRun = queue.enqueue({ project, task: free }).run;

    queue.dispatch(project.id);
    await queue.idle();

    expect(getRunById(db, freeRun.id)?.status).toBe("succeeded");
    expect(getRunById(db, blockedRun.id)?.status).toBe("queued");
    expect(getTaskById(db, blocked.id)?.status).toBe("ready");

    // Its turn comes when the dependency is done.
    updateTask(db, { ...blocker, status: "done" });
    queue.dispatch(project.id);
    await queue.idle();

    expect(getRunById(db, blockedRun.id)?.status).toBe("succeeded");
    expect(getTaskById(db, blocked.id)?.status).toBe("executing");
  });

  it("fails a run it can never start, and does not retry it", async () => {
    const project = makeProject();
    const task = makeTask(project, { model: "claude-fable-5" });
    const { queue, agents } = makeQueue();

    const { run } = queue.enqueue({ project, task });
    // The project's allowance changes after the run was queued.
    updateProject(db, { ...project, allowedModels: ["claude-sonnet-5"] });

    queue.dispatch(project.id);
    await queue.idle();

    const stored = getRunById(db, run.id);
    expect(stored?.status).toBe("failed");
    expect(stored?.failureReason).toBe("MODEL_NOT_ALLOWED");
    expect(agents).toHaveLength(0);

    queue.dispatch(project.id);
    await queue.idle();
    expect(agents).toHaveLength(0);
  });

  it("serves a project's queue in the order it was filled", async () => {
    const project = makeProject({ maxConcurrentRuns: 1 });
    const first = makeTask(project, { title: "First" });
    const second = makeTask(project, { title: "Second" });
    const order: string[] = [];
    // A frozen clock: both runs carry the same `createdAt`, so only the
    // insertion order can tell the queue which one waited longer.
    const { queue } = makeQueue({
      now: () => "2026-01-01T00:00:00.000Z",
      createAgent: () => ({
        async *run(request: AgentRequest): AsyncIterable<AgentMessage> {
          order.push(request.prompt.split("\n")[0]!);
          yield {
            type: "result",
            ok: true,
            usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
            errorMessage: null,
          };
        },
      }),
    });

    queue.enqueue({ project, task: first });
    queue.enqueue({ project, task: second });
    queue.dispatch(project.id);
    await queue.idle();

    expect(order).toEqual([`Task ${first.key}: First`, `Task ${second.key}: Second`]);
  });

  it("does nothing when autoStart is off", async () => {
    const project = makeProject();
    const task = makeTask(project);
    const { queue, agents } = makeQueue({ autoStart: false });
    const { run } = queue.enqueue({ project, task });

    queue.dispatch(project.id);
    await queue.idle();

    expect(getRunById(db, run.id)?.status).toBe("queued");
    expect(agents).toHaveLength(0);
  });
});

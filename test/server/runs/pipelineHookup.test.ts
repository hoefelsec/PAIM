/**
 * T61 — Pipeline hookup: runs drive statuses (docs/04-status-pipeline.md).
 *
 * The queue (T55) already moves a task to `executing` when its run starts;
 * this closes the loop for what happens when the run ends:
 *
 * - a successful run advances the task into the next enabled gate
 *   (`testing`/`ai_review`/`manual_review`/`done`), same as any other gate
 *   the pipeline engine (T26) knows how to satisfy;
 * - a failed run leaves the task at `executing` with the reason stored, and
 *   the next run's prompt carries that reason (docs/04 "The next run
 *   receives the reason as part of its instructions");
 * - a cancelled run leaves the task exactly where it is — cancelling is not
 *   failing.
 *
 * No SDK and no network: every run is driven by a scripted {@link FakeAgent},
 * and the gates a run does not satisfy by itself (`testing`, `ai_review`,
 * `manual_review` — T62/T63's endpoints, not yet built) are satisfied here
 * the same way those endpoints will: by calling the pipeline engine's own
 * `advance()`.
 */

import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase } from "../../../src/server/db/index.js";
import { insertProject } from "../../../src/server/db/projects.js";
import { getTaskById, insertTask, updateTask } from "../../../src/server/db/tasks.js";
import { defaultSettings } from "../../../src/server/projects/defaults.js";
import { createApprovalRegistry } from "../../../src/server/runs/approvals.js";
import { createFakeAgent, type FakeAgent } from "../../../src/server/runs/fakeAgent.js";
import { createRunQueue, type RunQueue } from "../../../src/server/runs/queue.js";
import { createWriterSemaphore } from "../../../src/server/safety/semaphore.js";
import { createRunControlRegistry } from "../../../src/server/runs/control.js";
import { advance } from "../../../src/server/tasks/pipeline.js";
import { STATUS_CATALOGUE, type Status } from "../../../src/shared/statuses.js";
import type { Project, SafetyPolicy, Task } from "../../../src/shared/types.js";

const ALLOW_ALL: SafetyPolicy = { denyList: [], mode: "allow_all", askList: [] };

/** Every status the catalogue holds, so the walk can reach every gate. */
const FULL_PIPELINE: Status[] = [...STATUS_CATALOGUE];

let dir: string;
let workspace: string;
let db: Database.Database;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "paim-pipeline-hookup-"));
  workspace = mkdtempSync(join(tmpdir(), "paim-pipeline-hookup-ws-"));
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
    statuses: FULL_PIPELINE,
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
    title: "Ship the pipeline hookup",
    description: "Wire runs into the status pipeline.",
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
    sourcePrompt: "wire runs into the pipeline",
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

function makeQueue(createAgent: () => FakeAgent): RunQueue {
  return createRunQueue({
    db,
    semaphore: createWriterSemaphore(),
    approvals: createApprovalRegistry(),
    createAgent,
    autoStart: false,
  });
}

/** Simulates the gate an endpoint outside T61's scope would satisfy. */
function satisfyGate(task: Task, statuses: readonly Status[]): Task {
  const next = advance(task, statuses);
  return updateTask(db, next);
}

describe("T61 — a run driving the task through the pipeline", () => {
  it("walks executing -> testing -> ai_review -> manual_review -> done", async () => {
    const project = makeProject();
    const task = makeTask(project);
    const agents: FakeAgent[] = [];
    const queue = makeQueue(() => {
      const agent = createFakeAgent();
      agents.push(agent);
      return agent;
    });

    const { run } = queue.enqueue({ project, task });
    const outcome = await queue.start(run.id);

    // The run itself is the `executing` gate (docs/04: "The run ends").
    expect(outcome.run.status).toBe("succeeded");
    let current = getTaskById(db, task.id)!;
    expect(current.status).toBe("testing");
    expect(current.failureReason).toBeNull();

    // `testing`: "All tests pass" — an endpoint outside T61 satisfies this.
    current = satisfyGate(current, project.statuses);
    expect(current.status).toBe("ai_review");

    // `ai_review`: "Claude returns approved".
    current = satisfyGate(current, project.statuses);
    expect(current.status).toBe("manual_review");

    // `manual_review`: "The user approves".
    current = satisfyGate(current, project.statuses);
    expect(current.status).toBe("done");

    expect(agents).toHaveLength(1);
  });

  it("leaves the task at executing on a run failure, records the reason, and folds it into the next run's prompt", async () => {
    const project = makeProject();
    const task = makeTask(project);
    const agents: FakeAgent[] = [];
    const queue = makeQueue(() => {
      const agent = createFakeAgent({ result: { ok: false, errorMessage: "two tests fail" } });
      agents.push(agent);
      return agent;
    });

    const { run: firstRun } = queue.enqueue({ project, task });
    const firstOutcome = await queue.start(firstRun.id);

    expect(firstOutcome.run.status).toBe("failed");
    expect(firstOutcome.run.failureReason).toBe("two tests fail");

    const afterFailure = getTaskById(db, task.id)!;
    // docs/04: "Failure moves the task back to `executing`" — it was
    // already there, so this is a no-op move that only stores the reason.
    expect(afterFailure.status).toBe("executing");
    expect(afterFailure.failureReason).toBe("two tests fail");

    // The next run reads the reason as part of its brief.
    const { run: secondRun } = queue.enqueue({ project, task: afterFailure });
    await queue.start(secondRun.id);

    expect(agents).toHaveLength(2);
    expect(agents[0]!.requests[0]?.prompt).not.toContain("two tests fail");
    expect(agents[1]!.requests[0]?.prompt).toContain("two tests fail");
  });

  it("leaves the task at executing, untouched, when the run is cancelled", async () => {
    // `ask_all` parks the run's first write on the approval registry, which
    // gives the test a moment to cancel before the agent ever finishes.
    const project = makeProject({ safety: { denyList: [], mode: "ask_all", askList: [] } });
    const task = makeTask(project, { status: "executing" });
    const controls = createRunControlRegistry();
    const agent = createFakeAgent({
      steps: [{ name: "Write", input: { file_path: "a.ts", content: "x" } }],
    });
    const queue = createRunQueue({
      db,
      semaphore: createWriterSemaphore(),
      approvals: createApprovalRegistry(),
      controls,
      createAgent: () => agent,
      autoStart: false,
    });

    const { run } = queue.enqueue({ project, task });
    const outcomePromise = queue.start(run.id);

    // Cancel it from outside — exactly the shape T56's `/cancel` endpoint
    // produces — once the runner has registered and parked.
    while (!controls.has(run.id)) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    controls.cancel(run.id);

    const outcome = await outcomePromise;
    // docs/09: "Cancel — the run stops. The changes stay." Not a failure.
    expect(outcome.run.status).toBe("cancelled");
    expect(outcome.run.failureReason).toBeNull();

    // The task started at, and remains at, `executing` — cancelling never
    // advances or fails it.
    const after = getTaskById(db, task.id)!;
    expect(after.status).toBe("executing");
    expect(after.failureReason).toBeNull();
  });
});

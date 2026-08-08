/**
 * The runner over a scripted agent (specs/09-ai-run.md "Runner"; T54's Done
 * line: "fake-agent tests for allow/deny-continue/ask-park and operation
 * recording").
 *
 * No SDK, no network, no credentials: `createFakeAgent` plays a written
 * transcript through the same permission callback the real agent uses.
 */

import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase } from "../../../src/server/db/index.js";
import { insertProject } from "../../../src/server/db/projects.js";
import { insertRun, listOperations } from "../../../src/server/db/runs.js";
import { insertTask } from "../../../src/server/db/tasks.js";
import { defaultSettings } from "../../../src/server/projects/defaults.js";
import { createApprovalRegistry } from "../../../src/server/runs/approvals.js";
import { createFakeAgent, type FakeToolStep } from "../../../src/server/runs/fakeAgent.js";
import { buildRunPrompt, executeRun } from "../../../src/server/runs/runner.js";
import { ApiError } from "../../../src/server/errors.js";
import type { Operation, Run } from "../../../src/shared/runs.js";
import type { Project, SafetyPolicy, Task } from "../../../src/shared/types.js";

let dir: string;
let workspace: string;
let db: Database.Database;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "paim-runner-"));
  workspace = mkdtempSync(join(tmpdir(), "paim-workspace-"));
  db = openDatabase(join(dir, "paim.db"));
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
  rmSync(workspace, { recursive: true, force: true });
});

const ALLOW_ALL: SafetyPolicy = { denyList: [], mode: "allow_all", askList: [] };

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

function makeTask(project: Project, overrides: Partial<Task> = {}): Task {
  const now = new Date().toISOString();
  return insertTask(db, {
    id: randomUUID(),
    key: `PAIM-${Math.floor(Math.random() * 1_000_000)}`,
    projectId: project.id,
    title: "Add the runner",
    description: "Drive the Agent SDK.",
    status: project.statuses[0]!,
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
    sourcePrompt: "make the runner work",
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

function makeRun(task: Task): Run {
  return insertRun(db, {
    id: randomUUID(),
    taskId: task.id,
    projectId: task.projectId,
    kind: "single",
    parentRunId: null,
    trigger: "manual",
    status: "queued",
    restorePoint: null,
    usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
    failureReason: null,
    createdAt: new Date().toISOString(),
    startedAt: null,
    endedAt: null,
  });
}

/** Spins the event loop until `predicate` holds, so a parked run can be observed. */
async function waitFor(predicate: () => boolean, label: string): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`timed out waiting for ${label}`);
}

function operationsOf(run: Run): Operation[] {
  return listOperations(db, run.id);
}

describe("executeRun — allow", () => {
  it("records each allowed operation and captures usage from the result", async () => {
    const project = makeProject();
    const task = makeTask(project);
    const run = makeRun(task);

    const agent = createFakeAgent({
      steps: [
        { name: "Read", input: { file_path: "src/app.ts" }, outcome: { text: "file body" } },
        {
          name: "Bash",
          input: { command: "npm   test" },
          outcome: { stdout: "3 passing", exitCode: 0 },
        },
      ],
      result: { usage: { inputTokens: 1200, outputTokens: 350, costUsd: 0.042 } },
    });

    const outcome = await executeRun({
      db,
      run,
      task,
      project,
      agent,
      approvals: createApprovalRegistry(),
      model: "claude-opus-5",
    });

    expect(outcome.run.status).toBe("succeeded");
    expect(outcome.run.failureReason).toBeNull();
    expect(outcome.run.startedAt).not.toBeNull();
    expect(outcome.run.endedAt).not.toBeNull();
    expect(outcome.run.usage).toEqual({
      inputTokens: 1200,
      outputTokens: 350,
      costUsd: 0.042,
    });

    const operations = operationsOf(run);
    expect(operations).toHaveLength(2);
    expect(operations[0]).toMatchObject({
      kind: "read",
      risk: "safe",
      status: "done",
      summary: "Read src/app.ts",
      stdout: "file body",
      exitCode: null,
      diff: null,
    });
    expect(operations[1]).toMatchObject({
      kind: "bash",
      risk: "exec",
      status: "done",
      // docs/10 §4: the command is normalized before it is matched, and the
      // log shows the normalized form.
      summary: "Bash npm test",
      stdout: "3 passing",
      exitCode: 0,
    });
  });

  it("hands the agent the workspace path, the routed model, and the task brief", async () => {
    const project = makeProject();
    const task = makeTask(project);
    const agent = createFakeAgent();

    await executeRun({
      db,
      run: makeRun(task),
      task,
      project,
      agent,
      approvals: createApprovalRegistry(),
      model: "claude-opus-5",
    });

    expect(agent.requests).toHaveLength(1);
    expect(agent.requests[0]!.cwd).toBe(workspace);
    expect(agent.requests[0]!.model).toBe("claude-opus-5");
    expect(agent.requests[0]!.prompt).toBe(buildRunPrompt(task));
    expect(agent.requests[0]!.prompt).toContain(task.key);
    expect(agent.requests[0]!.prompt).toContain("make the runner work");
  });

  it("records a diff for a write and for an edit, and nothing else", async () => {
    const project = makeProject();
    const task = makeTask(project);
    const run = makeRun(task);

    const agent = createFakeAgent({
      steps: [
        { name: "Write", input: { file_path: "docs/new.md", content: "line one\nline two" } },
        {
          name: "Edit",
          input: { file_path: "src/app.ts", old_string: "const a = 1;", new_string: "const a = 2;" },
        },
        { name: "Grep", input: { pattern: "TODO" } },
      ],
    });

    await executeRun({
      db,
      run,
      task,
      project,
      agent,
      approvals: createApprovalRegistry(),
    });

    const [write, edit, grep] = operationsOf(run);
    expect(write).toMatchObject({ kind: "write", risk: "write", status: "done" });
    expect(write!.diff).toBe("--- /dev/null\n+++ docs/new.md\n+line one\n+line two");
    expect(edit).toMatchObject({ kind: "edit", risk: "write", status: "done" });
    expect(edit!.diff).toBe(
      "--- src/app.ts\n+++ src/app.ts\n-const a = 1;\n+const a = 2;",
    );
    // Grep with no `path` searches the workspace root.
    expect(grep).toMatchObject({ kind: "grep", risk: "safe", summary: "Grep .", diff: null });
  });

  it("marks an operation failed when its tool reports an error", async () => {
    const project = makeProject();
    const task = makeTask(project);
    const run = makeRun(task);

    const agent = createFakeAgent({
      steps: [
        {
          name: "Bash",
          input: { command: "npm test" },
          outcome: { stdout: "1 failing", exitCode: 1, isError: true },
        },
      ],
    });

    await executeRun({
      db,
      run,
      task,
      project,
      agent,
      approvals: createApprovalRegistry(),
    });

    expect(operationsOf(run)[0]).toMatchObject({
      status: "failed",
      stdout: "1 failing",
      exitCode: 1,
    });
  });
});

describe("executeRun — deny continues the run", () => {
  it("refuses a deny-listed command with its reason and keeps going", async () => {
    // docs/10 §3: "A denied operation does not stop the run."
    const project = makeProject({
      safety: { denyList: ["git push --force*"], mode: "allow_all", askList: [] },
    });
    const task = makeTask(project);
    const run = makeRun(task);

    const agent = createFakeAgent({
      steps: [
        { name: "Bash", input: { command: "git push --force origin main" } },
        { name: "Bash", input: { command: "git push origin main" }, outcome: { stdout: "done" } },
      ],
      result: { usage: { inputTokens: 10, outputTokens: 4, costUsd: 0.001 } },
    });

    const outcome = await executeRun({
      db,
      run,
      task,
      project,
      agent,
      approvals: createApprovalRegistry(),
    });

    // The refusal, with its reason, went back to the model...
    expect(agent.decisions[0]).toMatchObject({ behavior: "deny" });
    expect((agent.decisions[0] as { message: string }).message).toContain("deny list");
    // ...the model tried something else, and the run finished.
    expect(agent.attempted).toEqual(["Bash", "Bash"]);
    expect(outcome.run.status).toBe("succeeded");

    const operations = operationsOf(run);
    expect(operations.map((operation) => operation.status)).toEqual(["denied", "done"]);
    expect(operations[0]).toMatchObject({
      kind: "bash",
      summary: "Bash git push --force origin main",
      stdout: null,
      exitCode: null,
    });
  });

  it("refuses a file operation whose path matches the deny list", async () => {
    // docs/10 §4: an entry is matched against "the target path of a file
    // operation", and the path is the workspace-relative one the deny list is
    // written in — `secrets/**` and `.env`, the exact forms T51's own tests
    // use. Matching the absolute path instead would make both entries dead.
    const project = makeProject({
      safety: { denyList: ["secrets/**", ".env"], mode: "allow_all", askList: [] },
    });
    const task = makeTask(project);
    const run = makeRun(task);

    const agent = createFakeAgent({
      steps: [
        { name: "Write", input: { file_path: "secrets/db.env", content: "PASSWORD=hunter2" } },
        { name: "Read", input: { file_path: ".env" } },
        { name: "Write", input: { file_path: "docs/new.md", content: "fine" } },
      ],
    });

    const outcome = await executeRun({
      db,
      run,
      task,
      project,
      agent,
      approvals: createApprovalRegistry(),
    });

    // The refusal names the path the way the run log shows it, and the run
    // kept going after both denials.
    expect((agent.decisions[0] as { message: string }).message).toContain("secrets/db.env");
    expect((agent.decisions[0] as { message: string }).message).toContain("deny list");
    expect((agent.decisions[1] as { message: string }).message).toContain("deny list");
    expect(agent.attempted).toEqual(["Write", "Read", "Write"]);
    expect(outcome.run.status).toBe("succeeded");

    const operations = operationsOf(run);
    expect(operations.map((operation) => operation.status)).toEqual(["denied", "denied", "done"]);
    expect(operations[0]).toMatchObject({ kind: "write", summary: "Write secrets/db.env" });
    expect(operations[1]).toMatchObject({ kind: "read", summary: "Read .env" });
    expect(operations[2]).toMatchObject({ kind: "write", summary: "Write docs/new.md" });
  });

  it("refuses a path that leaves the workspace and records it denied", async () => {
    // docs/10 §2: the confinement rule is not a setting — allow_all does not
    // widen it.
    const project = makeProject();
    const task = makeTask(project);
    const run = makeRun(task);

    const agent = createFakeAgent({
      steps: [
        { name: "Read", input: { file_path: "../../etc/passwd" } },
        { name: "Read", input: { file_path: "src/app.ts" } },
      ],
    });

    const outcome = await executeRun({
      db,
      run,
      task,
      project,
      agent,
      approvals: createApprovalRegistry(),
    });

    expect((agent.decisions[0] as { message: string }).message).toContain("outside the project");
    expect(outcome.run.status).toBe("succeeded");
    expect(operationsOf(run).map((operation) => operation.status)).toEqual(["denied", "done"]);
  });

  it("refuses a tool that is not one of the six and records nothing", async () => {
    const project = makeProject();
    const task = makeTask(project);
    const run = makeRun(task);

    const agent = createFakeAgent({
      steps: [
        { name: "WebFetch", input: { url: "https://example.com" } },
        { name: "Read", input: { file_path: "src/app.ts" } },
      ],
    });

    await executeRun({
      db,
      run,
      task,
      project,
      agent,
      approvals: createApprovalRegistry(),
    });

    expect((agent.decisions[0] as { message: string }).message).toContain("not available");
    const operations = operationsOf(run);
    expect(operations).toHaveLength(1);
    expect(operations[0]).toMatchObject({ kind: "read", status: "done" });
  });
});

describe("executeRun — ask parks the run", () => {
  it("parks the first operation and resumes when it is approved", async () => {
    // docs/10 §4: ask_all is the default and stops every operation,
    // including a read; the approval has no time limit.
    const project = makeProject({
      safety: { denyList: [], mode: "ask_all", askList: [] },
    });
    const task = makeTask(project);
    const run = makeRun(task);
    const approvals = createApprovalRegistry();

    const agent = createFakeAgent({
      steps: [{ name: "Read", input: { file_path: "src/app.ts" }, outcome: { text: "body" } }],
    });

    const pending = executeRun({ db, run, task, project, agent, approvals });

    await waitFor(() => approvals.pending().length === 1, "the operation to park");

    const parkedId = approvals.pending()[0]!;
    const parked = operationsOf(run);
    expect(parked).toHaveLength(1);
    expect(parked[0]).toMatchObject({ id: parkedId, status: "proposed", summary: "Read src/app.ts" });

    // The run itself is `awaiting_approval` while it waits, and stays there.
    const runRow = db.prepare("SELECT status FROM runs WHERE id = ?").get(run.id) as {
      status: string;
    };
    expect(runRow.status).toBe("awaiting_approval");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(approvals.isPending(parkedId)).toBe(true);

    expect(approvals.approve(parkedId)).toBe(true);
    const outcome = await pending;

    expect(outcome.run.status).toBe("succeeded");
    expect(operationsOf(run)[0]).toMatchObject({ status: "done", stdout: "body" });
  });

  it("returns the reason to the model when a parked operation is denied", async () => {
    const project = makeProject({
      safety: { denyList: [], mode: "ask_listed", askList: ["rm *"] },
    });
    const task = makeTask(project);
    const run = makeRun(task);
    const approvals = createApprovalRegistry();

    const agent = createFakeAgent({
      steps: [
        { name: "Bash", input: { command: "rm -r build" } },
        { name: "Bash", input: { command: "npm run clean" }, outcome: { stdout: "cleaned" } },
      ],
    });

    const pending = executeRun({ db, run, task, project, agent, approvals });
    await waitFor(() => approvals.pending().length === 1, "the operation to park");
    expect(approvals.deny(approvals.pending()[0]!, "delete it yourself")).toBe(true);

    const outcome = await pending;

    expect((agent.decisions[0] as { message: string }).message).toBe("delete it yourself");
    expect(outcome.run.status).toBe("succeeded");
    expect(operationsOf(run).map((operation) => operation.status)).toEqual(["denied", "done"]);
  });

  it("parks the file operations the ask list names, and only those", async () => {
    // docs/10 §4: the ask list matches the target path of a file operation.
    // `*.env` matches a nested `config/prod.env`, `src/**` matches a file two
    // levels down, and neither matches `docs/new.md` — all three against the
    // workspace-relative path, which is how the entries are written.
    const project = makeProject({
      safety: { denyList: [], mode: "ask_listed", askList: ["*.env", "src/**"] },
    });
    const task = makeTask(project);
    const run = makeRun(task);
    const approvals = createApprovalRegistry();

    const agent = createFakeAgent({
      steps: [
        { name: "Write", input: { file_path: "config/prod.env", content: "TOKEN=1" } },
        {
          name: "Edit",
          input: { file_path: "src/app.ts", old_string: "const a = 1;", new_string: "const a = 2;" },
        },
        { name: "Write", input: { file_path: "docs/new.md", content: "no approval needed" } },
      ],
    });

    const answered: string[] = [];
    /** Waits for the next operation to park and returns it, still parked. */
    async function nextParked(label: string): Promise<string> {
      const next = (): string | undefined =>
        approvals.pending().find((id) => !answered.includes(id));
      await waitFor(() => next() !== undefined, label);
      const operationId = next()!;
      answered.push(operationId);
      return operationId;
    }

    const pending = executeRun({ db, run, task, project, agent, approvals });

    const envWrite = await nextParked("the .env write to park");
    expect(operationsOf(run)[0]).toMatchObject({
      id: envWrite,
      kind: "write",
      status: "proposed",
      summary: "Write config/prod.env",
    });
    expect(approvals.approve(envWrite)).toBe(true);

    const srcEdit = await nextParked("the src edit to park");
    expect(operationsOf(run)[1]).toMatchObject({
      id: srcEdit,
      kind: "edit",
      status: "proposed",
      summary: "Edit src/app.ts",
    });
    expect(approvals.approve(srcEdit)).toBe(true);

    const outcome = await pending;

    expect(outcome.run.status).toBe("succeeded");
    // The third write never matched the ask list, so nothing parked for it.
    expect(answered).toHaveLength(2);
    expect(approvals.pending()).toEqual([]);

    const operations = operationsOf(run);
    expect(operations.map((operation) => operation.status)).toEqual(["done", "done", "done"]);
    expect(operations[2]).toMatchObject({ kind: "write", summary: "Write docs/new.md" });
  });

  it("a task-level mode override replaces the project mode", async () => {
    // docs/10 §5: the task overrides the mode only.
    const project = makeProject({
      safety: { denyList: [], mode: "ask_all", askList: [] },
    });
    const task = makeTask(project, {
      safety: { denyList: [], mode: "allow_all", askList: [] },
    });
    const run = makeRun(task);
    const approvals = createApprovalRegistry();

    const agent = createFakeAgent({
      steps: [{ name: "Read", input: { file_path: "src/app.ts" } }],
    });

    const outcome = await executeRun({ db, run, task, project, agent, approvals });

    expect(approvals.pending()).toEqual([]);
    expect(outcome.run.status).toBe("succeeded");
    expect(operationsOf(run)[0]!.status).toBe("done");
  });

  it("the deny list still applies to a task that asks for allow everything", async () => {
    const project = makeProject({
      safety: { denyList: ["rm -rf /*"], mode: "ask_all", askList: [] },
    });
    const task = makeTask(project, {
      safety: { denyList: [], mode: "allow_all", askList: [] },
    });
    const run = makeRun(task);

    const agent = createFakeAgent({
      steps: [{ name: "Bash", input: { command: "rm -rf /var/tmp" } }],
    });

    await executeRun({
      db,
      run,
      task,
      project,
      agent,
      approvals: createApprovalRegistry(),
    });

    expect(operationsOf(run)[0]!.status).toBe("denied");
  });
});

describe("executeRun — endings", () => {
  it("fails the run when the agent throws, keeping the operations it recorded", async () => {
    const project = makeProject();
    const task = makeTask(project);
    const run = makeRun(task);

    const steps: FakeToolStep[] = [{ name: "Read", input: { file_path: "src/app.ts" } }];
    const agent = createFakeAgent({
      steps,
      throwAfter: 1,
      error: new Error("connection reset"),
    });

    const outcome = await executeRun({
      db,
      run,
      task,
      project,
      agent,
      approvals: createApprovalRegistry(),
    });

    expect(outcome.run.status).toBe("failed");
    expect(outcome.run.failureReason).toBe("connection reset");
    expect(outcome.run.endedAt).not.toBeNull();
    expect(operationsOf(run)[0]!.status).toBe("done");
  });

  it("fails the run when the agent's result says it did not succeed", async () => {
    const project = makeProject();
    const task = makeTask(project);

    const outcome = await executeRun({
      db,
      run: makeRun(task),
      task,
      project,
      agent: createFakeAgent({
        result: { ok: false, errorMessage: "error_max_turns", usage: { inputTokens: 9 } },
      }),
      approvals: createApprovalRegistry(),
    });

    expect(outcome.run.status).toBe("failed");
    expect(outcome.run.failureReason).toBe("error_max_turns");
    expect(outcome.run.usage.inputTokens).toBe(9);
  });

  it("fails the run when the agent ends without a result message", async () => {
    const project = makeProject();
    const task = makeTask(project);

    const outcome = await executeRun({
      db,
      run: makeRun(task),
      task,
      project,
      agent: createFakeAgent({ result: null }),
      approvals: createApprovalRegistry(),
    });

    expect(outcome.run.status).toBe("failed");
    expect(outcome.run.failureReason).toBe("agent_ended_without_result");
  });

  it("refuses to run a project without a workspace path", async () => {
    // docs/10 §2: "A project without a workspace path cannot run tasks."
    const project = makeProject({ workspacePath: null });
    const task = makeTask(project);

    await expect(
      executeRun({
        db,
        run: makeRun(task),
        task,
        project,
        agent: createFakeAgent(),
        approvals: createApprovalRegistry(),
      }),
    ).rejects.toBeInstanceOf(ApiError);
  });
});

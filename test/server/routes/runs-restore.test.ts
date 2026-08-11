/**
 * `POST /api/runs/:run/restore` and *Cancel and restore* (T57; docs/06
 * "Runs", docs/09-ai-run.md "Restore").
 *
 * The revert itself is covered over the module in
 * test/server/runs/restore.test.ts; what this suite owns is the endpoint's
 * side of docs/09 — when Restore is offered, when it is refused, and that a
 * run driven end to end through the API really comes back byte for byte.
 *
 * Every run is driven by a scripted agent whose steps perform the writes the
 * model would have performed, so no test reaches the Agent SDK, the network
 * or a credential — and a real file really changes.
 */

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type Database from "better-sqlite3";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../../src/server/app.js";
import { openDatabase } from "../../../src/server/db/index.js";
import { getRunById, updateRun } from "../../../src/server/db/runs.js";
import { getTaskById, updateTask } from "../../../src/server/db/tasks.js";
import { clearValidatorCache } from "../../../src/server/fields/validator.js";
import { clearVersionCache } from "../../../src/server/projects/version.js";
import {
  createFakeAgent,
  type FakeAgentScript,
  type FakeToolStep,
} from "../../../src/server/runs/fakeAgent.js";
import type { Run, RunView } from "../../../src/shared/runs.js";
import type { ProjectView, Task } from "../../../src/shared/types.js";

const HEADERS = { host: "localhost:4400" };
const ALLOW_ALL = { denyList: [], mode: "allow_all", askList: [] };

let dir: string;
let workspace: string;
let restoreRoot: string;
let db: Database.Database;
let app: FastifyInstance;
let scripts: FakeAgentScript[];

function build(): FastifyInstance {
  return createApp({
    db,
    runs: {
      restoreRoot,
      createAgent: () => createFakeAgent(scripts.shift() ?? {}),
    },
  });
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "paim-run-restore-"));
  workspace = mkdtempSync(join(tmpdir(), "paim-workspace-"));
  restoreRoot = join(dir, "restore");
  db = openDatabase(join(dir, "paim.db"));
  scripts = [];
  app = build();
  clearVersionCache();
  clearValidatorCache();
});

afterEach(async () => {
  await app.close();
  db.close();
  rmSync(dir, { recursive: true, force: true });
  rmSync(workspace, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function initRepo(root: string): void {
  git(root, "init", "-q");
  git(root, "config", "user.email", "test@example.com");
  git(root, "config", "user.name", "Test");
  git(root, "config", "commit.gpgsign", "false");
  git(root, "config", "core.hooksPath", join(root, ".git", "no-hooks"));
}

function write(relativePath: string, content: string): string {
  const absolute = join(workspace, relativePath);
  mkdirSync(join(absolute, ".."), { recursive: true });
  writeFileSync(absolute, content);
  return absolute;
}

function read(relativePath: string): string {
  return readFileSync(join(workspace, relativePath), "utf-8");
}

/** A Write the scripted agent really performs, once the runner allows it. */
function writeStep(relativePath: string, content: string): FakeToolStep {
  return {
    name: "Write",
    input: { file_path: relativePath, content },
    onDecision: (decision) => {
      if (decision.behavior === "allow") write(relativePath, content);
    },
  };
}

async function createProject(body: Record<string, unknown> = {}): Promise<ProjectView> {
  const res = await app.inject({
    method: "POST",
    url: "/api/projects",
    headers: HEADERS,
    payload: {
      name: `PAIM ${Math.random().toString(36).slice(2, 8)}`,
      workspacePath: workspace,
      safety: ALLOW_ALL,
      ...body,
    },
  });
  expect(res.statusCode).toBe(201);
  return res.json().data as ProjectView;
}

async function createTask(slug: string): Promise<Task> {
  const res = await app.inject({
    method: "POST",
    url: `/api/projects/${slug}/tasks`,
    headers: HEADERS,
    payload: { title: "Revert what the run wrote" },
  });
  expect(res.statusCode).toBe(201);
  return res.json().data as Task;
}

async function startRun(slug: string, key: string): Promise<Run> {
  const res = await app.inject({
    method: "POST",
    url: `/api/projects/${slug}/tasks/${key}/runs`,
    headers: HEADERS,
    payload: {},
  });
  expect(res.statusCode).toBe(201);
  return res.json().data as Run;
}

function post(url: string, payload: Record<string, unknown> = {}) {
  return app.inject({ method: "POST", url, headers: HEADERS, payload });
}

async function readRun(runId: string): Promise<RunView> {
  const res = await app.inject({ method: "GET", url: `/api/runs/${runId}`, headers: HEADERS });
  expect(res.statusCode).toBe(200);
  return res.json().data as RunView;
}

/** One finished run of one fresh task, with the transcript it was driven by. */
async function runScript(script: FakeAgentScript): Promise<{ project: ProjectView; task: Task; run: RunView }> {
  const project = await createProject();
  const task = await createTask(project.slug);
  scripts.push(script);
  const started = await startRun(project.slug, task.key);
  await app.runQueue.idle();
  return { project, task, run: await readRun(started.id) };
}

// ---------------------------------------------------------------------------
// The revert
// ---------------------------------------------------------------------------

describe("POST /api/runs/:run/restore", () => {
  it("returns the workspace byte-identical in snapshot mode", async () => {
    const original = "export const value = 1;\n";
    write("src/app.ts", original);

    const { run } = await runScript({
      steps: [
        writeStep("src/app.ts", "export const value = 2;\n"),
        writeStep("src/added.ts", "export const added = true;\n"),
      ],
    });

    expect(run.status).toBe("succeeded");
    expect(read("src/app.ts")).toBe("export const value = 2;\n");
    expect(run.restorePoint?.method).toBe("snapshot");
    expect(run.restorePoint?.available).toBe(true);

    const res = await post(`/api/runs/${run.id}/restore`);

    expect(res.statusCode).toBe(200);
    expect(res.json().restore).toMatchObject({
      performed: true,
      method: "snapshot",
      restored: [join("src", "app.ts")],
      deleted: [join("src", "added.ts")],
    });
    expect(read("src/app.ts")).toBe(original);
    expect(existsSync(join(workspace, "src/added.ts"))).toBe(false);
  });

  it("returns the workspace byte-identical in a git repository", async () => {
    initRepo(workspace);
    write("src/app.ts", "committed\n");
    git(workspace, "add", "-A");
    git(workspace, "commit", "-q", "-m", "first");
    const head = git(workspace, "rev-parse", "HEAD");
    // Uncommitted work the user had in flight; only the stash brings it back.
    write("src/app.ts", "committed\nmine\n");

    const { run } = await runScript({
      steps: [
        writeStep("src/app.ts", "the agent's version\n"),
        writeStep("src/added.ts", "export const added = true;\n"),
      ],
    });

    expect(run.restorePoint?.method).toBe("git");
    expect(run.restorePoint?.head).toBe(head);

    const res = await post(`/api/runs/${run.id}/restore`);

    expect(res.statusCode).toBe(200);
    expect(res.json().restore).toMatchObject({ performed: true, method: "git" });
    expect(read("src/app.ts")).toBe("committed\nmine\n");
    expect(existsSync(join(workspace, "src/added.ts"))).toBe(false);
    expect(git(workspace, "rev-parse", "HEAD")).toBe(head);
  });

  it("answers with the run and its operations", async () => {
    write("src/app.ts", "one\n");
    const { run } = await runScript({ steps: [writeStep("src/app.ts", "two\n")] });

    const res = await post(`/api/runs/${run.id}/restore`);

    expect(res.statusCode).toBe(200);
    const data = res.json().data as RunView;
    expect(data.id).toBe(run.id);
    expect(data.operations.map((operation) => operation.kind)).toEqual(["write"]);
  });

  it("says on the row which operations it could not have reverted", async () => {
    // docs/09: "An operation that Restore cannot revert says so on its own
    // row." The interface reads this off the run view.
    write("src/app.ts", "one\n");
    const { run } = await runScript({
      steps: [
        writeStep("src/app.ts", "two\n"),
        { name: "Bash", input: { command: "npm install left-pad" } },
      ],
    });

    const byKind = new Map(run.operations.map((operation) => [operation.kind, operation]));
    expect(byKind.get("write")?.reversible).toBe(true);
    expect(byKind.get("bash")?.reversible).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// When Restore is not offered
// ---------------------------------------------------------------------------

describe("when Restore is not available", () => {
  it("refuses once the task is done", async () => {
    // docs/09: "The control disappears when the task reaches `done`. At that
    // point the changes are the product of the task."
    write("src/app.ts", "one\n");
    const { task, run } = await runScript({ steps: [writeStep("src/app.ts", "two\n")] });

    const stored = getTaskById(db, task.id)!;
    updateTask(db, { ...stored, status: "done", updatedAt: new Date().toISOString() });

    const res = await post(`/api/runs/${run.id}/restore`);

    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatchObject({
      code: "RESTORE_UNAVAILABLE",
      details: { task: task.key, status: "done" },
    });
    // Nothing moved.
    expect(read("src/app.ts")).toBe("two\n");
  });

  it("is still offered while the task is in review", async () => {
    write("src/app.ts", "one\n");
    const { task, run } = await runScript({ steps: [writeStep("src/app.ts", "two\n")] });

    const stored = getTaskById(db, task.id)!;
    updateTask(db, { ...stored, status: "manual_review", updatedAt: new Date().toISOString() });

    expect((await post(`/api/runs/${run.id}/restore`)).statusCode).toBe(200);
    expect(read("src/app.ts")).toBe("one\n");
  });

  it("refuses with the stored reason when the capture failed", async () => {
    // docs/09: "The Run tab states the reason in the position of the Restore
    // control." The reason travels on the error, not just in the log.
    mkdirSync(join(workspace, "src"), { recursive: true });
    const { run } = await runScript({
      steps: [
        {
          name: "Write",
          input: { file_path: "src", content: "clobbered" },
          outcome: { isError: true, text: "EISDIR" },
        },
        writeStep("other.ts", "written anyway\n"),
      ],
    });

    // docs/09: the run is not refused; only Restore is.
    expect(run.status).toBe("succeeded");
    expect(read("other.ts")).toBe("written anyway\n");

    const res = await post(`/api/runs/${run.id}/restore`);

    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("NO_RESTORE_POINT");
    expect(res.json().error.details.reason).toMatch(/could not be read/);
  });

  it("refuses a run that wrote nothing", async () => {
    const { run } = await runScript({
      steps: [{ name: "Read", input: { file_path: "src/app.ts" } }],
    });

    expect(run.restorePoint).toBeNull();
    const res = await post(`/api/runs/${run.id}/restore`);

    expect(res.statusCode).toBe(422);
    expect(res.json().error).toMatchObject({ code: "NO_RESTORE_POINT", details: { run: run.id } });
  });

  it("refuses a run that has not finished", async () => {
    // docs/09 gives the in-flight case its own control: *Cancel and restore*.
    const project = await createProject();
    const task = await createTask(project.slug);
    const started = await startRun(project.slug, task.key);
    updateRun(db, { ...getRunById(db, started.id)!, status: "executing" });

    const res = await post(`/api/runs/${started.id}/restore`);

    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatchObject({
      code: "RUN_NOT_FINISHED",
      details: { status: "executing" },
    });
    await app.runQueue.idle();
  });

  it("404s an unknown run", async () => {
    const res = await post("/api/runs/00000000-0000-4000-8000-000000000000/restore");
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("RUN_NOT_FOUND");
  });
});

// ---------------------------------------------------------------------------
// Cancel and restore
// ---------------------------------------------------------------------------

describe("POST /api/runs/:run/cancel { restore: true }", () => {
  it("stops the run and reverts what it had written", async () => {
    const original = "export const value = 1;\n";
    write("src/app.ts", original);

    const project = await createProject();
    const task = await createTask(project.slug);
    // The transcript parks on the second step until the test releases it, so
    // the cancel lands while the run is genuinely in flight.
    let release = (): void => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    scripts.push({
      steps: [
        writeStep("src/app.ts", "export const value = 2;\n"),
        { name: "Read", input: { file_path: "src/app.ts" }, onDecision: () => held },
      ],
    });

    const started = await startRun(project.slug, task.key);
    for (let attempt = 0; attempt < 400; attempt += 1) {
      if ((await readRun(started.id)).operations.length === 2) break;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(read("src/app.ts")).toBe("export const value = 2;\n");

    const res = await post(`/api/runs/${started.id}/cancel`, { restore: true });
    release();

    expect(res.statusCode).toBe(200);
    expect((res.json().data as Run).status).toBe("cancelled");
    expect(res.json().restore).toMatchObject({
      requested: true,
      performed: true,
      method: "snapshot",
      restored: [join("src", "app.ts")],
    });
    expect(read("src/app.ts")).toBe(original);
    await app.runQueue.idle();
  });

  it("refuses before it stops the run when the task is already done", async () => {
    write("src/app.ts", "one\n");
    const { task, run } = await runScript({ steps: [writeStep("src/app.ts", "two\n")] });
    // A finished run cannot be controlled at all; re-open it so the refusal
    // under test is the restore rule and not the terminal-status one.
    updateRun(db, { ...getRunById(db, run.id)!, status: "paused", endedAt: null });
    const stored = getTaskById(db, task.id)!;
    updateTask(db, { ...stored, status: "done", updatedAt: new Date().toISOString() });

    const res = await post(`/api/runs/${run.id}/cancel`, { restore: true });

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("RESTORE_UNAVAILABLE");
    // Neither half happened: the run is still paused and the file still new.
    expect(getRunById(db, run.id)?.status).toBe("paused");
    expect(read("src/app.ts")).toBe("two\n");
  });

  it("keeps the changes when restore is not asked for", async () => {
    write("src/app.ts", "one\n");
    const { run } = await runScript({ steps: [writeStep("src/app.ts", "two\n")] });
    updateRun(db, { ...getRunById(db, run.id)!, status: "paused", endedAt: null });

    const res = await post(`/api/runs/${run.id}/cancel`, { restore: false });

    expect(res.statusCode).toBe(200);
    expect(res.json().restore).toEqual({ requested: false, performed: false });
    expect(read("src/app.ts")).toBe("two\n");
  });
});

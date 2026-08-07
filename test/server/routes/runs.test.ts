import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type Database from "better-sqlite3";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../../src/server/app.js";
import { openDatabase } from "../../../src/server/db/index.js";
import { insertOperation, insertRun } from "../../../src/server/db/runs.js";
import { clearValidatorCache } from "../../../src/server/fields/validator.js";
import { clearVersionCache } from "../../../src/server/projects/version.js";
import type { Operation, OperationDraft, Run, RunView } from "../../../src/shared/runs.js";
import type { ProjectView, Task } from "../../../src/shared/types.js";

const HEADERS = { host: "localhost:4400" };

let dir: string;
let db: Database.Database;
let app: FastifyInstance;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "paim-runs-api-"));
  db = openDatabase(join(dir, "paim.db"));
  app = createApp({ db });
  clearVersionCache();
  clearValidatorCache();
});

afterEach(async () => {
  await app.close();
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

async function createProject(body: Record<string, unknown> = {}): Promise<ProjectView> {
  const res = await app.inject({
    method: "POST",
    url: "/api/projects",
    headers: HEADERS,
    payload: { name: "PAIM", ...body },
  });
  expect(res.statusCode).toBe(201);
  return res.json().data as ProjectView;
}

async function createTask(slug: string, title = "Add the run records"): Promise<Task> {
  const res = await app.inject({
    method: "POST",
    url: `/api/projects/${slug}/tasks`,
    headers: HEADERS,
    payload: { title },
  });
  expect(res.statusCode).toBe(201);
  return res.json().data as Task;
}

/**
 * Runs are seeded through the storage layer: starting one is the queue
 * work's endpoint (specs/09), not this module's.
 */
function seedRun(task: Task, overrides: Partial<Run> = {}): Run {
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
    ...overrides,
  });
}

function seedOperation(run: Run, overrides: Partial<OperationDraft> = {}): Operation {
  const now = new Date().toISOString();
  return insertOperation(db, {
    id: randomUUID(),
    runId: run.id,
    kind: "read",
    summary: "Read src/server/app.ts",
    status: "done",
    diff: null,
    stdout: null,
    exitCode: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  });
}

function listRuns(slug: string, ref: string) {
  return app.inject({
    method: "GET",
    url: `/api/projects/${slug}/tasks/${ref}/runs`,
    headers: HEADERS,
  });
}

function readRun(id: string) {
  return app.inject({ method: "GET", url: `/api/runs/${id}`, headers: HEADERS });
}

describe("GET /api/projects/:project/tasks/:key/runs", () => {
  it("returns an empty list envelope for a task that never ran", async () => {
    const project = await createProject();
    const task = await createTask(project.slug);

    const res = await listRuns(project.slug, task.key);

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      data: [],
      meta: { total: 0, cursor: null, hasMore: false },
    });
  });

  it("returns the runs of the task, newest first", async () => {
    const project = await createProject();
    const task = await createTask(project.slug);
    const first = seedRun(task, {
      createdAt: "2026-01-01T10:00:00.000Z",
      startedAt: "2026-01-01T10:00:01.000Z",
      endedAt: "2026-01-01T10:04:00.000Z",
      status: "succeeded",
      usage: { inputTokens: 900, outputTokens: 120, costUsd: 0.02 },
    });
    const second = seedRun(task, { createdAt: "2026-01-02T10:00:00.000Z", status: "queued" });

    const res = await listRuns(project.slug, task.key);
    const body = res.json() as { data: Run[]; meta: { total: number } };

    expect(res.statusCode).toBe(200);
    expect(body.meta.total).toBe(2);
    expect(body.data.map((run) => run.id)).toEqual([second.id, first.id]);
    expect(body.data[1]).toMatchObject({
      taskId: task.id,
      projectId: project.id,
      kind: "single",
      trigger: "manual",
      status: "succeeded",
      usage: { inputTokens: 900, outputTokens: 120, costUsd: 0.02 },
    });
  });

  it("finds the task by its UUID as well as its key", async () => {
    const project = await createProject();
    const task = await createTask(project.slug);
    const run = seedRun(task);

    const res = await listRuns(project.slug, task.id);

    expect((res.json() as { data: Run[] }).data.map((r) => r.id)).toEqual([run.id]);
  });

  it("does not leak the runs of another task", async () => {
    const project = await createProject();
    const task = await createTask(project.slug);
    const other = await createTask(project.slug, "Another task");
    seedRun(other);

    expect((await listRuns(project.slug, task.key)).json().data).toEqual([]);
  });

  it("404s on an unknown project", async () => {
    const res = await listRuns("nope", "TASK-1");

    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("PROJECT_NOT_FOUND");
  });

  it("404s on an unknown task", async () => {
    const project = await createProject();

    const res = await listRuns(project.slug, "TASK-999");

    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("TASK_NOT_FOUND");
  });
});

describe("GET /api/runs/:run", () => {
  it("returns one run with its operations, in the order they happened", async () => {
    const project = await createProject();
    const task = await createTask(project.slug);
    const run = seedRun(task, {
      status: "awaiting_approval",
      startedAt: "2026-01-01T10:00:01.000Z",
      restorePoint: {
        method: "git",
        available: true,
        reason: null,
        head: "9f1c0a3",
        stash: null,
        snapshotDir: null,
        createdPaths: [],
        capturedAt: "2026-01-01T10:00:02.000Z",
      },
    });
    const read = seedOperation(run);
    const edit = seedOperation(run, {
      kind: "edit",
      summary: "Edit src/api/tasks.ts",
      diff: "@@ -1 +1 @@\n-a\n+b\n",
    });
    const bash = seedOperation(run, {
      kind: "bash",
      summary: "npm test",
      status: "proposed",
    });

    const res = await readRun(run.id);
    const view = res.json().data as RunView;

    expect(res.statusCode).toBe(200);
    expect(view.id).toBe(run.id);
    expect(view.status).toBe("awaiting_approval");
    expect(view.restorePoint).toEqual(run.restorePoint);
    expect(view.operations.map((op) => op.id)).toEqual([read.id, edit.id, bash.id]);
    // docs/09: risk is derived from kind, and travels with the record.
    expect(view.operations.map((op) => op.risk)).toEqual(["safe", "write", "exec"]);
    expect(view.operations[1]?.diff).toBe("@@ -1 +1 @@\n-a\n+b\n");
    expect(view.operations[2]?.status).toBe("proposed");
  });

  it("returns a run with no operations yet as an empty log", async () => {
    const project = await createProject();
    const run = seedRun(await createTask(project.slug));

    const view = (await readRun(run.id)).json().data as RunView;

    expect(view.operations).toEqual([]);
  });

  it("404s with a stable code on an unknown run", async () => {
    const res = await readRun(randomUUID());

    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("RUN_NOT_FOUND");
  });
});

/**
 * `GET /api/activity` and `GET /api/activity/stream` (T59; docs/06 "Activity
 * and usage": "all runs in all projects").
 *
 * Runs are seeded through the storage layer — starting one for real is the
 * queue's endpoint (T55) and its own test file's job — so this module only
 * has to show that the activity feed reaches across every project, keeps
 * newest-first order, and that the stream carries the same live writes.
 */

import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type Database from "better-sqlite3";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../../src/server/app.js";
import { openDatabase } from "../../../src/server/db/index.js";
import { insertOperation, insertRun, updateRun } from "../../../src/server/db/runs.js";
import { clearValidatorCache } from "../../../src/server/fields/validator.js";
import { clearVersionCache } from "../../../src/server/projects/version.js";
import type { ActivityRun } from "../../../src/server/routes/activity.js";
import type { OperationDraft, Run } from "../../../src/shared/runs.js";
import type { ProjectView, Task } from "../../../src/shared/types.js";

const HEADERS = { host: "localhost:4400" };

let dir: string;
let db: Database.Database;
let app: FastifyInstance;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "paim-activity-"));
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

async function createProject(name: string): Promise<ProjectView> {
  const res = await app.inject({
    method: "POST",
    url: "/api/projects",
    headers: HEADERS,
    payload: { name },
  });
  expect(res.statusCode).toBe(201);
  return res.json().data as ProjectView;
}

async function createTask(slug: string, title = "Do the work"): Promise<Task> {
  const res = await app.inject({
    method: "POST",
    url: `/api/projects/${slug}/tasks`,
    headers: HEADERS,
    payload: { title },
  });
  expect(res.statusCode).toBe(201);
  return res.json().data as Task;
}

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

function seedOperation(run: Run, overrides: Partial<OperationDraft> = {}) {
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

function getActivity() {
  return app.inject({ method: "GET", url: "/api/activity", headers: HEADERS });
}

describe("GET /api/activity", () => {
  it("returns an empty list envelope when nothing has ever run", async () => {
    await createProject("PAIM");

    const res = await getActivity();

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ data: [], meta: { total: 0, cursor: null, hasMore: false } });
  });

  it("reflects runs in two projects, newest first", async () => {
    const projectA = await createProject("Alpha");
    const projectB = await createProject("Bravo");
    const taskA = await createTask(projectA.slug);
    const taskB = await createTask(projectB.slug);

    const first = seedRun(taskA, {
      createdAt: "2026-01-01T10:00:00.000Z",
      status: "succeeded",
    });
    const second = seedRun(taskB, {
      createdAt: "2026-01-02T10:00:00.000Z",
      status: "executing",
    });

    const res = await getActivity();
    const body = res.json() as { data: ActivityRun[]; meta: { total: number } };

    expect(res.statusCode).toBe(200);
    expect(body.meta.total).toBe(2);
    // Newest first, and each row still names the project it belongs to —
    // "all runs in all projects" (docs/06), not "all runs of one project".
    expect(body.data.map((run) => [run.id, run.projectId])).toEqual([
      [second.id, projectB.id],
      [first.id, projectA.id],
    ]);
  });

  it("shows `planning` before the agent has proposed anything", async () => {
    const project = await createProject("PAIM");
    const task = await createTask(project.slug);
    const run = seedRun(task, { status: "planning" });

    const body = (await getActivity()).json() as { data: ActivityRun[] };

    expect(body.data.find((row) => row.id === run.id)?.progress).toEqual({ state: "planning" });
  });

  it("counts completed of planned once the run has left planning", async () => {
    const project = await createProject("PAIM");
    const task = await createTask(project.slug);
    const run = seedRun(task, { status: "executing" });
    seedOperation(run, { status: "done" });
    seedOperation(run, { status: "running" });
    seedOperation(run, { status: "proposed" });

    const body = (await getActivity()).json() as { data: ActivityRun[] };

    expect(body.data.find((row) => row.id === run.id)?.progress).toEqual({
      state: "counted",
      planned: 3,
      completed: 1,
    });
  });
});

describe("GET /api/activity/stream", () => {
  interface OpenFrame {
    name: string;
    data: { run: { id: string; projectId: string; status: string } };
  }
  interface OpenStream {
    comments: string[];
    frames: OpenFrame[];
    close(): void;
  }

  async function openStream(): Promise<OpenStream> {
    const res = await app.inject({
      method: "GET",
      url: "/api/activity/stream",
      headers: HEADERS,
      payloadAsStream: true,
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/event-stream");

    const stream = res.stream();
    const open: OpenStream = { comments: [], frames: [], close: () => stream.destroy() };
    let buffer = "";
    stream.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf-8");
      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        boundary = buffer.indexOf("\n\n");
        if (frame.startsWith(":")) {
          open.comments.push(frame.slice(1).trim());
          continue;
        }
        const lines = frame.split("\n");
        const name = lines.find((line) => line.startsWith("event:"));
        const data = lines
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice("data:".length).trim())
          .join("\n");
        if (data.length > 0) {
          open.frames.push({
            name: name === undefined ? "message" : name.slice("event:".length).trim(),
            data: JSON.parse(data) as OpenFrame["data"],
          });
        }
      }
    });
    await settle();
    return open;
  }

  function settle(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 5));
  }

  it("opens with a comment and carries writes from both projects", async () => {
    const projectA = await createProject("Alpha");
    const projectB = await createProject("Bravo");
    const taskA = await createTask(projectA.slug);
    const taskB = await createTask(projectB.slug);

    const stream = await openStream();
    expect(stream.comments).toEqual(["connected"]);

    const runA = seedRun(taskA);
    const runB = seedRun(taskB, { status: "planning" });
    await settle();

    expect(stream.frames.map((f) => f.data.run.id)).toEqual([runA.id, runB.id]);
    expect(stream.frames.map((f) => f.data.run.projectId)).toEqual([
      taskA.projectId,
      taskB.projectId,
    ]);
    for (const frame of stream.frames) expect(frame.name).toBe("run");

    updateRun(db, { ...runA, status: "succeeded", endedAt: new Date().toISOString() });
    await settle();
    expect(stream.frames.map((f) => f.data.run.status)).toEqual([
      "queued",
      "planning",
      "succeeded",
    ]);

    stream.close();
  });
});

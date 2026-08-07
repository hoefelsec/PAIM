/**
 * T26 — the pipeline through the task API: a status written by hand is only
 * ever a legal move (`422 GATE_REQUIRED` otherwise), and the reason of a
 * failed gate is retrievable on the task
 * (specs/04-status-pipeline.md, docs/04-status-pipeline.md).
 *
 * The transition rules themselves are covered by
 * test/server/tasks/pipeline.test.ts; this suite is the HTTP surface.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type Database from "better-sqlite3";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../../src/server/app.js";
import { openDatabase } from "../../../src/server/db/index.js";
import { getTaskByRef, updateTask } from "../../../src/server/db/tasks.js";
import { clearValidatorCache } from "../../../src/server/fields/validator.js";
import { clearVersionCache } from "../../../src/server/projects/version.js";
import { fail } from "../../../src/server/tasks/pipeline.js";
import { STATUS_CATALOGUE } from "../../../src/shared/statuses.js";
import type { ProjectView, Task } from "../../../src/shared/types.js";

const HEADERS = { host: "localhost:4400" };
/** Every status enabled, so the matrix has every gate in it. */
const STATUSES = [...STATUS_CATALOGUE];

let dir: string;
let db: Database.Database;
let app: FastifyInstance;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "paim-pipeline-"));
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
    payload: { name: "PAIM", statuses: STATUSES, ...body },
  });
  expect(res.statusCode).toBe(201);
  return res.json().data as ProjectView;
}

async function createTask(slug: string, body: Record<string, unknown> = {}): Promise<Task> {
  const res = await app.inject({
    method: "POST",
    url: `/api/projects/${slug}/tasks`,
    headers: HEADERS,
    payload: { title: "A task", ...body },
  });
  expect(res.statusCode).toBe(201);
  return res.json().data as Task;
}

function patch(slug: string, ref: string, body: Record<string, unknown>) {
  return app.inject({
    method: "PATCH",
    url: `/api/projects/${slug}/tasks/${ref}`,
    headers: HEADERS,
    payload: body,
  });
}

function read(slug: string, ref: string) {
  return app.inject({ method: "GET", url: `/api/projects/${slug}/tasks/${ref}`, headers: HEADERS });
}

describe("status writes are limited to legal moves", () => {
  it("accepts a step forward whose gate needs no actor", async () => {
    const project = await createProject();
    const task = await createTask(project.slug, { status: "ready" });

    const res = await patch(project.slug, task.key, { status: "executing" });

    expect(res.statusCode).toBe(200);
    expect((res.json().data as Task).status).toBe("executing");
  });

  it("refuses ready → done while the project runs its tests (422 GATE_REQUIRED)", async () => {
    const project = await createProject();
    const task = await createTask(project.slug, { status: "ready" });

    const res = await patch(project.slug, task.key, { status: "done" });

    expect(res.statusCode).toBe(422);
    expect(res.json().error).toMatchObject({
      code: "GATE_REQUIRED",
      details: { from: "ready", to: "done", allowed: ["executing", "cancelled"] },
    });
    // Refused means unchanged.
    expect(((await read(project.slug, task.key)).json().data as Task).status).toBe("ready");
  });

  it("refuses to stand in for the run that ends `executing`", async () => {
    const project = await createProject();
    const task = await createTask(project.slug, { status: "executing" });

    const res = await patch(project.slug, task.key, { status: "testing" });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("GATE_REQUIRED");
  });

  it("cancels from anywhere and stamps closedAt", async () => {
    const project = await createProject();

    for (const from of ["backlog", "ready", "executing", "testing", "manual_review"] as const) {
      const task = await createTask(project.slug, { title: `From ${from}`, status: from });
      const res = await patch(project.slug, task.key, { status: "cancelled" });

      expect(res.statusCode, from).toBe(200);
      const cancelled = res.json().data as Task;
      expect(cancelled.status).toBe("cancelled");
      expect(cancelled.closedAt).not.toBeNull();
    }
  });

  it("re-opens a task from done and clears its closedAt", async () => {
    const project = await createProject();
    const task = await createTask(project.slug, {
      status: "done",
      closedAt: "2026-08-01T12:00:00.000Z",
    });

    const res = await patch(project.slug, task.key, { status: "executing" });

    expect(res.statusCode).toBe(200);
    const reopened = res.json().data as Task;
    expect(reopened.status).toBe("executing");
    expect(reopened.closedAt).toBeNull();
  });

  it("keeps a closedAt the same write states explicitly", async () => {
    const project = await createProject();
    const task = await createTask(project.slug, { status: "ready" });

    const res = await patch(project.slug, task.key, {
      status: "cancelled",
      closedAt: "2026-07-04T08:00:00.000Z",
    });

    expect((res.json().data as Task).closedAt).toBe("2026-07-04T08:00:00.000Z");
  });

  it("accepts a write that repeats the current status", async () => {
    const project = await createProject();
    const task = await createTask(project.slug, { status: "executing" });

    const res = await patch(project.slug, task.key, { status: "executing", title: "Renamed" });

    expect(res.statusCode).toBe(200);
    expect((res.json().data as Task).title).toBe("Renamed");
  });

  it("leaves the status alone on a write that does not mention it", async () => {
    const project = await createProject();
    const task = await createTask(project.slug, { status: "manual_review" });

    const res = await patch(project.slug, task.key, { priority: "high" });

    expect(res.statusCode).toBe(200);
    expect((res.json().data as Task).status).toBe("manual_review");
  });

  it("applies the same rule to the bulk endpoint, task by task", async () => {
    const project = await createProject();
    // One move is legal (`ready` has no gate), the other skips `ready`.
    const legal = await createTask(project.slug, { title: "Legal", status: "ready" });
    const illegal = await createTask(project.slug, { title: "Illegal", status: "backlog" });

    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${project.slug}/tasks/bulk`,
      headers: HEADERS,
      payload: { ids: [legal.key, illegal.key], patch: { status: "executing" } },
    });

    expect(res.statusCode).toBe(200);
    const results = res.json().data as { success: boolean; error?: { code: string } }[];
    expect(results.map((r) => r.success)).toEqual([true, false]);
    expect(results[1]!.error!.code).toBe("GATE_REQUIRED");
    expect(((await read(project.slug, legal.key)).json().data as Task).status).toBe("executing");
    expect(((await read(project.slug, illegal.key)).json().data as Task).status).toBe("backlog");
  });

  it("still refuses a status the project does not enable, before any gate", async () => {
    const project = await createProject({
      slug: "lean",
      name: "Lean",
      statuses: ["open_questions", "design", "ready", "executing", "done"],
    });
    const task = await createTask(project.slug, { status: "ready" });

    const res = await patch(project.slug, task.key, { status: "cancelled" });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("STATUS_NOT_ENABLED");
  });
});

describe("the failure reason", () => {
  it("is retrievable on the task after a gate fails", async () => {
    const project = await createProject();
    const task = await createTask(project.slug, { status: "testing" });

    // The gate endpoints that call `fail` are later tasks' work (T28, T12);
    // the engine is what stores the reason.
    const stored = getTaskByRef(db, project.id, task.key)!;
    updateTask(db, fail(stored, "regression: 2 of 41 tests failed"));

    const res = await read(project.slug, task.key);

    expect(res.statusCode).toBe(200);
    const failed = res.json().data as Task;
    expect(failed.status).toBe("executing");
    expect(failed.failureReason).toBe("regression: 2 of 41 tests failed");
  });

  it("is null on a task that never failed", async () => {
    const project = await createProject();
    const task = await createTask(project.slug);

    expect(task.failureReason).toBeNull();
  });

  it("survives an unrelated write and a manual move", async () => {
    const project = await createProject();
    const task = await createTask(project.slug, { status: "manual_review" });
    updateTask(db, fail(getTaskByRef(db, project.id, task.key)!, "the copy is wrong"));

    await patch(project.slug, task.key, { priority: "high" });
    const moved = await patch(project.slug, task.key, { status: "cancelled" });

    expect((moved.json().data as Task).failureReason).toBe("the copy is wrong");
  });

  it("is server-owned: a write that names it is refused", async () => {
    const project = await createProject();
    const task = await createTask(project.slug);

    const res = await patch(project.slug, task.key, { failureReason: "made up" });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatchObject({
      code: "READ_ONLY_PROPERTY",
      details: { field: "failureReason" },
    });
  });
});

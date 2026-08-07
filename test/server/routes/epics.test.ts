/**
 * T15 — Epic invariants (docs/02-data-model.md "Epic").
 *
 * One test per invariant: a child cannot be an epic (EPIC_NESTING), a size
 * change away from Epic is refused while children exist (EPIC_HAS_CHILDREN),
 * a parent must be an epic in the same project, and the progress counts
 * (done / cancelled / total) computed on read.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type Database from "better-sqlite3";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../../src/server/app.js";
import { openDatabase } from "../../../src/server/db/index.js";
import { clearValidatorCache } from "../../../src/server/fields/validator.js";
import { clearVersionCache } from "../../../src/server/projects/version.js";
import { DEFAULT_STATUSES } from "../../../src/shared/statuses.js";
import type { ProjectView, Task } from "../../../src/shared/types.js";

const HEADERS = { host: "localhost:4400" };
// The default pipeline has no `cancelled`; the progress tests need it.
const STATUSES = [...DEFAULT_STATUSES, "cancelled"];

let dir: string;
let db: Database.Database;
let app: FastifyInstance;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "paim-epics-"));
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

function post(slug: string, body: Record<string, unknown>) {
  return app.inject({
    method: "POST",
    url: `/api/projects/${slug}/tasks`,
    headers: HEADERS,
    payload: body,
  });
}

async function createTask(slug: string, body: Record<string, unknown>): Promise<Task> {
  const res = await post(slug, body);
  expect(res.statusCode).toBe(201);
  return res.json().data as Task;
}

function patch(slug: string, ref: string, body: Record<string, unknown>) {
  return app.inject({
    method: "POST",
    url: `/api/projects/${slug}/tasks/${ref}`,
    headers: HEADERS,
    payload: body,
  });
}

function read(slug: string, ref: string) {
  return app.inject({ method: "GET", url: `/api/projects/${slug}/tasks/${ref}`, headers: HEADERS });
}

describe("epic invariants (T15)", () => {
  it("refuses to create a child that is itself an epic (422 EPIC_NESTING)", async () => {
    const project = await createProject();
    const epic = await createTask(project.slug, { title: "The epic", size: "Epic" });

    const res = await post(project.slug, {
      title: "Nested epic",
      size: "Epic",
      parentId: epic.key,
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error).toMatchObject({
      code: "EPIC_NESTING",
      details: { size: "Epic", parentId: epic.id },
    });
  });

  it("refuses to patch a child's size to Epic while it has a parent (422 EPIC_NESTING)", async () => {
    const project = await createProject();
    const epic = await createTask(project.slug, { title: "The epic", size: "Epic" });
    const child = await createTask(project.slug, { title: "A child", parentId: epic.key });

    const res = await patch(project.slug, child.key, { size: "Epic" });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("EPIC_NESTING");
  });

  it("refuses to change an epic's size away from Epic while it has children (422 EPIC_HAS_CHILDREN)", async () => {
    const project = await createProject();
    const epic = await createTask(project.slug, { title: "The epic", size: "Epic" });
    await createTask(project.slug, { title: "A child", parentId: epic.key });

    const res = await patch(project.slug, epic.key, { size: "L" });

    expect(res.statusCode).toBe(422);
    expect(res.json().error).toMatchObject({
      code: "EPIC_HAS_CHILDREN",
      details: { children: 1 },
    });

    // The epic is unchanged.
    const stillEpic = (await read(project.slug, epic.key)).json().data as Task;
    expect(stillEpic.size).toBe("Epic");
    expect(stillEpic.kind).toBe("epic");
  });

  it("allows changing an epic's size away from Epic once it has no children", async () => {
    const project = await createProject();
    const epic = await createTask(project.slug, { title: "The epic", size: "Epic" });

    const res = await patch(project.slug, epic.key, { size: "L" });

    expect(res.statusCode).toBe(200);
    const next = res.json().data as Task;
    expect(next.size).toBe("L");
    expect(next.kind).toBe("task");
  });

  it("refuses a parentId that is not an epic in the same project (422 PARENT_NOT_EPIC)", async () => {
    const project = await createProject();
    const notAnEpic = await createTask(project.slug, { title: "A plain task" });

    const res = await post(project.slug, { title: "Orphan", parentId: notAnEpic.key });

    expect(res.statusCode).toBe(422);
    expect(res.json().error).toMatchObject({
      code: "PARENT_NOT_EPIC",
      details: { parentId: notAnEpic.id },
    });
  });

  it("refuses to patch parentId to a non-epic task", async () => {
    const project = await createProject();
    const task = await createTask(project.slug, { title: "Free-floating" });
    const notAnEpic = await createTask(project.slug, { title: "A plain task" });

    const res = await patch(project.slug, task.key, { parentId: notAnEpic.key });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("PARENT_NOT_EPIC");
  });

  it("accepts a parentId that names an epic", async () => {
    const project = await createProject();
    const epic = await createTask(project.slug, { title: "The epic", size: "Epic" });

    const child = await createTask(project.slug, { title: "A child", parentId: epic.key });

    expect(child.parentId).toBe(epic.id);
  });

  it("reports 0/0 progress for an epic with no children", async () => {
    const project = await createProject();
    const epic = await createTask(project.slug, { title: "The epic", size: "Epic" });

    const res = await read(project.slug, epic.key);

    expect(res.statusCode).toBe(200);
    expect(res.json().data.progress).toEqual({ done: 0, cancelled: 0, total: 0 });
  });

  it("computes progress counts including cancelled children", async () => {
    const project = await createProject();
    const epic = await createTask(project.slug, { title: "The epic", size: "Epic" });
    const a = await createTask(project.slug, { title: "A", parentId: epic.key });
    const b = await createTask(project.slug, { title: "B", parentId: epic.key });
    const c = await createTask(project.slug, { title: "C", parentId: epic.key });
    await createTask(project.slug, { title: "D", parentId: epic.key });
    await createTask(project.slug, { title: "E", parentId: epic.key });

    await patch(project.slug, a.key, { status: "done" });
    await patch(project.slug, b.key, { status: "done" });
    await patch(project.slug, c.key, { status: "cancelled" });

    const res = await read(project.slug, epic.key);

    expect(res.statusCode).toBe(200);
    // 5 children, 2 done, 1 cancelled, 2 still open — "5/7 done, 2 cancelled"
    // in docs/02's example shape is (done, cancelled, total).
    expect(res.json().data.progress).toEqual({ done: 2, cancelled: 1, total: 5 });
  });

  it("does not report progress for a plain task", async () => {
    const project = await createProject();
    const task = await createTask(project.slug, { title: "Not an epic" });

    const res = await read(project.slug, task.key);

    expect(res.json().data.progress).toBeUndefined();
  });

  it("excludes trashed children from the progress count", async () => {
    const project = await createProject();
    const epic = await createTask(project.slug, { title: "The epic", size: "Epic" });
    const child = await createTask(project.slug, { title: "A child", parentId: epic.key });

    const del = await app.inject({
      method: "DELETE",
      url: `/api/projects/${project.slug}/tasks/${child.key}`,
      headers: HEADERS,
    });
    expect(del.statusCode).toBe(200);

    const res = await read(project.slug, epic.key);

    expect(res.json().data.progress).toEqual({ done: 0, cancelled: 0, total: 0 });
  });
});

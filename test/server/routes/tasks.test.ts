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
import type { FieldDef, ProjectView, Task } from "../../../src/shared/types.js";

const HEADERS = { host: "localhost:4400" };

let dir: string;
let db: Database.Database;
let app: FastifyInstance;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "paim-tasks-"));
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

function post(slug: string, body: Record<string, unknown>, query = "") {
  return app.inject({
    method: "POST",
    url: `/api/projects/${slug}/tasks${query}`,
    headers: HEADERS,
    payload: body,
  });
}

async function createTask(
  slug: string,
  body: Record<string, unknown>,
  query = "",
): Promise<Task> {
  const res = await post(slug, body, query);
  expect(res.statusCode).toBe(201);
  return res.json().data as Task;
}

function read(slug: string, ref: string) {
  return app.inject({ method: "GET", url: `/api/projects/${slug}/tasks/${ref}`, headers: HEADERS });
}

function patch(
  slug: string,
  ref: string,
  body: Record<string, unknown>,
  extra: { headers?: Record<string, string>; query?: string; method?: "POST" | "PATCH" } = {},
) {
  return app.inject({
    method: extra.method ?? "POST",
    url: `/api/projects/${slug}/tasks/${ref}${extra.query ?? ""}`,
    headers: { ...HEADERS, ...extra.headers },
    payload: body,
  });
}

async function update(
  slug: string,
  ref: string,
  body: Record<string, unknown>,
  extra?: Parameters<typeof patch>[3],
): Promise<Task> {
  const res = await patch(slug, ref, body, extra);
  expect(res.statusCode).toBe(200);
  return res.json().data as Task;
}

function remove(slug: string, ref: string, query = "") {
  return app.inject({
    method: "DELETE",
    url: `/api/projects/${slug}/tasks/${ref}${query}`,
    headers: HEADERS,
  });
}

function getTrash(slug: string) {
  return app.inject({ method: "GET", url: `/api/projects/${slug}/trash`, headers: HEADERS });
}

function restore(slug: string, ref: string) {
  return app.inject({
    method: "POST",
    url: `/api/projects/${slug}/trash/${ref}`,
    headers: HEADERS,
  });
}

/** The stored row, including a trashed one — reads through the API hide it. */
function storedRow(id: string): { deletedAt: string | null } | undefined {
  return db.prepare("SELECT deletedAt FROM tasks WHERE id = ?").get(id) as
    | { deletedAt: string | null }
    | undefined;
}

const TYPE_FIELD: FieldDef = {
  key: "type",
  type: "select",
  options: ["feature", "bug", "chore", "spike", "debt"],
};

describe("create", () => {
  it("creates a task from a title alone", async () => {
    const project = await createProject();

    const task = await createTask(project.slug, { title: "Ship the task API" });

    expect(task).toMatchObject({
      key: "TASK-1",
      projectId: project.id,
      title: "Ship the task API",
      description: "",
      priority: "none",
      kind: "task",
      labels: [],
      assignee: null,
      parentId: null,
      fields: {},
      dependsOn: [],
      questions: [],
      deletedAt: null,
      closedAt: null,
    });
    expect(task.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(task.createdAt).toBe(task.updatedAt);
  });

  it("refuses a create without a title", async () => {
    const project = await createProject();

    const res = await post(project.slug, { description: "no title" });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatchObject({ code: "TITLE_REQUIRED", details: { field: "title" } });
  });

  it("starts a task in backlog when the project enables it", async () => {
    const project = await createProject();
    expect(project.statuses).toContain("backlog");

    const task = await createTask(project.slug, { title: "First" });

    expect(task.status).toBe("backlog");
  });

  it("starts a task in ready when the pipeline has no backlog", async () => {
    const project = await createProject({
      slug: "no-backlog",
      statuses: ["open_questions", "design", "ready", "executing", "done"],
    });

    const task = await createTask(project.slug, { title: "First" });

    expect(task.status).toBe("ready");
  });

  it("takes the key prefix from the type value", async () => {
    const project = await createProject({ fieldSchema: [TYPE_FIELD] });

    const bug = await createTask(project.slug, { title: "Fix it", fields: { type: "bug" } });
    const plain = await createTask(project.slug, { title: "Do it" });

    expect(bug.key).toBe("BUG-1");
    expect(plain.key).toBe("TASK-2");
  });

  it("derives kind from size and refuses a direct kind write", async () => {
    const project = await createProject();

    const epic = await createTask(project.slug, { title: "The epic", size: "Epic" });
    const res = await post(project.slug, { title: "Nope", kind: "epic" });

    expect(epic.kind).toBe("epic");
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatchObject({ code: "READ_ONLY_PROPERTY", details: { field: "kind" } });
  });

  it("refuses a status the project does not enable", async () => {
    const project = await createProject();

    const res = await post(project.slug, { title: "Later", status: "ai_review" });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("STATUS_NOT_ENABLED");
  });

  it("reports 404 for an unknown project", async () => {
    const res = await post("ghost", { title: "Nowhere" });

    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("PROJECT_NOT_FOUND");
  });
});

describe("custom field values on a write", () => {
  async function projectWithFields(): Promise<ProjectView> {
    return createProject({
      fieldSchema: [
        { key: "layer", type: "select", options: ["backend", "ui"] },
        { key: "points", type: "number" },
      ],
    });
  }

  it("stores values the project's schema accepts", async () => {
    const project = await projectWithFields();

    const task = await createTask(project.slug, {
      title: "With fields",
      fields: { layer: "backend", points: 3 },
    });

    expect(task.fields).toEqual({ layer: "backend", points: 3 });
  });

  it("rejects a value of the wrong type through the project's validator", async () => {
    const project = await projectWithFields();

    const res = await post(project.slug, { title: "Bad", fields: { points: "many" } });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatchObject({
      code: "VALIDATION_FAILED",
      details: { field: "fields.points" },
    });
  });

  it("rejects a value outside a select field's options", async () => {
    const project = await projectWithFields();

    const res = await post(project.slug, { title: "Bad", fields: { layer: "database" } });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_FAILED");
  });

  it("refuses an unknown field key, and creates it with allowUnknownFields", async () => {
    const project = await projectWithFields();

    const refused = await post(project.slug, { title: "Bad", fields: { squad: "core" } });
    const allowed = await post(
      project.slug,
      { title: "Fine", fields: { squad: "core" } },
      "?allowUnknownFields=true",
    );

    expect(refused.statusCode).toBe(400);
    expect(refused.json().error).toMatchObject({
      code: "FIELD_UNKNOWN",
      details: { key: "squad" },
    });
    expect(allowed.statusCode).toBe(201);
    expect(allowed.json().data.fields.squad).toBe("core");
    expect(allowed.json().warnings).toEqual([`field "squad" was created as a hidden text field`]);
  });

  it("reports a missing required value as a warning, not a rejection", async () => {
    const project = await createProject({
      fieldSchema: [{ key: "owner", type: "text", required: true }],
    });

    const res = await post(project.slug, { title: "No owner" });

    expect(res.statusCode).toBe(201);
    expect(res.json().warnings).toEqual([`field "owner" is required and has no value`]);
  });

  it("reads a field with no stored value as its default", async () => {
    const project = await createProject({
      fieldSchema: [{ key: "layer", type: "select", options: ["backend"], default: "backend" }],
    });

    const task = await createTask(project.slug, { title: "Defaulted" });

    expect(task.fields).toEqual({ layer: "backend" });
  });
});

describe("read", () => {
  it("addresses a task by key and by uuid", async () => {
    const project = await createProject();
    const task = await createTask(project.slug, { title: "Addressable" });

    const byKey = await read(project.slug, task.key);
    const byId = await read(project.slug, task.id);

    expect(byKey.statusCode).toBe(200);
    expect(byId.statusCode).toBe(200);
    expect(byKey.json().data).toEqual(byId.json().data);
    expect(byKey.json().data.id).toBe(task.id);
  });

  it("does not read a task of another project", async () => {
    const one = await createProject({ slug: "one" });
    const two = await createProject({ name: "Other", slug: "two" });
    const task = await createTask(one.slug, { title: "Mine" });

    const res = await read(two.slug, task.key);

    expect(res.statusCode).toBe(404);
    expect(res.json().error).toMatchObject({ code: "TASK_NOT_FOUND" });
  });
});

describe("update", () => {
  async function seeded() {
    const project = await createProject({
      fieldSchema: [
        { key: "layer", type: "select", options: ["backend", "ui"] },
        { key: "points", type: "number" },
      ],
    });
    const task = await createTask(project.slug, {
      title: "Original",
      description: "The first description",
      labels: ["backend"],
      assignee: "edu",
      priority: "high",
      fields: { layer: "backend", points: 3 },
    });
    return { project, task };
  }

  it("merges core fields and leaves the rest untouched", async () => {
    const { project, task } = await seeded();

    const next = await update(project.slug, task.key, { title: "Renamed" });

    expect(next).toMatchObject({
      key: task.key,
      title: "Renamed",
      description: "The first description",
      labels: ["backend"],
      assignee: "edu",
      priority: "high",
      fields: { layer: "backend", points: 3 },
    });
  });

  it("merges the fields object instead of replacing it", async () => {
    const { project, task } = await seeded();

    const next = await update(project.slug, task.key, { fields: { points: 5 } });

    expect(next.fields).toEqual({ layer: "backend", points: 5 });
  });

  it("clears a core value with null", async () => {
    const { project, task } = await seeded();

    const next = await update(project.slug, task.key, {
      assignee: null,
      labels: null,
      description: null,
      priority: null,
    });

    expect(next).toMatchObject({
      assignee: null,
      labels: [],
      description: "",
      priority: "none",
    });
  });

  it("clears one custom field value with null", async () => {
    const { project, task } = await seeded();

    const next = await update(project.slug, task.key, { fields: { points: null } });

    expect(next.fields).toEqual({ layer: "backend", points: null });
    const stored = db.prepare("SELECT fields FROM tasks WHERE id = ?").get(task.id) as {
      fields: string;
    };
    expect(JSON.parse(stored.fields)).toEqual({ layer: "backend" });
  });

  it("accepts PATCH as an alias of POST", async () => {
    const { project, task } = await seeded();

    const next = await update(project.slug, task.id, { title: "Patched" }, { method: "PATCH" });

    expect(next.title).toBe("Patched");
  });

  it("moves updatedAt forward on every write", async () => {
    const { project, task } = await seeded();

    const first = await update(project.slug, task.key, { title: "One" });
    const second = await update(project.slug, task.key, { title: "Two" });

    expect(first.updatedAt > task.updatedAt).toBe(true);
    expect(second.updatedAt > first.updatedAt).toBe(true);
    expect(second.createdAt).toBe(task.createdAt);
  });

  it("never renames the key when the type changes", async () => {
    const project = await createProject({ slug: "typed", fieldSchema: [TYPE_FIELD] });
    const task = await createTask(project.slug, { title: "A bug", fields: { type: "bug" } });

    const next = await update(project.slug, task.key, { fields: { type: "chore" } });

    expect(next.key).toBe("BUG-1");
    expect(next.fields).toEqual({ type: "chore" });
  });

  it("reports 404 for an unknown task", async () => {
    const project = await createProject();

    const res = await patch(project.slug, "TASK-99", { title: "Ghost" });

    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("TASK_NOT_FOUND");
  });
});

describe("If-Match", () => {
  it("applies the write when the version matches", async () => {
    const project = await createProject();
    const task = await createTask(project.slug, { title: "Guarded" });

    const res = await patch(
      project.slug,
      task.key,
      { title: "Guarded twice" },
      { headers: { "if-match": task.updatedAt } },
    );

    expect(res.statusCode).toBe(200);
    expect(res.json().data.title).toBe("Guarded twice");
  });

  it("rejects a stale version and leaves the task unchanged", async () => {
    const project = await createProject();
    const task = await createTask(project.slug, { title: "Guarded" });
    const winner = await update(project.slug, task.key, { title: "First writer" });

    const res = await patch(
      project.slug,
      task.key,
      { title: "Second writer" },
      { headers: { "if-match": task.updatedAt } },
    );

    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatchObject({
      code: "IF_MATCH_FAILED",
      details: { expected: task.updatedAt, current: winner.updatedAt },
    });
    const after = await read(project.slug, task.key);
    expect(after.json().data).toMatchObject({
      title: "First writer",
      updatedAt: winner.updatedAt,
    });
  });

  it("accepts the quoted entity-tag spelling of the header", async () => {
    const project = await createProject();
    const task = await createTask(project.slug, { title: "Quoted" });

    const res = await patch(
      project.slug,
      task.key,
      { title: "Still fine" },
      { headers: { "if-match": `"${task.updatedAt}"` } },
    );

    expect(res.statusCode).toBe(200);
  });

  it("lets the last write win without the header", async () => {
    const project = await createProject();
    const task = await createTask(project.slug, { title: "Unguarded" });

    await update(project.slug, task.key, { title: "First writer" });
    const second = await update(project.slug, task.key, { title: "Second writer" });

    expect(second.title).toBe("Second writer");
  });
});

describe("delete", () => {
  it("moves a task to the trash, where reads no longer find it", async () => {
    const project = await createProject();
    const task = await createTask(project.slug, { title: "Trashed" });

    const res = await remove(project.slug, task.key);

    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({ id: task.id, key: task.key, hard: false });
    expect((await read(project.slug, task.key)).statusCode).toBe(404);
    expect(storedRow(task.id)?.deletedAt).toEqual(expect.any(String));
  });

  it("removes the row for good with hard=true", async () => {
    const project = await createProject();
    const task = await createTask(project.slug, { title: "Gone" });

    const res = await remove(project.slug, task.key, "?hard=true");

    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({ id: task.id, hard: true });
    expect((await read(project.slug, task.key)).statusCode).toBe(404);
    expect(storedRow(task.id)).toBeUndefined();
  });

  it("deletes by uuid as well as by key", async () => {
    const project = await createProject();
    const task = await createTask(project.slug, { title: "By id" });

    const res = await remove(project.slug, task.id, "?hard=true");

    expect(res.statusCode).toBe(200);
    expect(storedRow(task.id)).toBeUndefined();
  });

  it("refuses a hard delete that would orphan children", async () => {
    const project = await createProject();
    const epic = await createTask(project.slug, { title: "The epic", size: "Epic" });
    await createTask(project.slug, { title: "A child", parentId: epic.key });

    const res = await remove(project.slug, epic.key, "?hard=true");

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("TASK_HAS_CHILDREN");
  });

  it("rejects a hard flag that is not a boolean", async () => {
    const project = await createProject();
    const task = await createTask(project.slug, { title: "Flagged" });

    const res = await remove(project.slug, task.key, "?hard=yes");

    expect(res.statusCode).toBe(400);
    expect(res.json().error.details).toMatchObject({ field: "hard" });
  });
});

describe("trash", () => {
  it("lists a soft-deleted task and restores it intact under the same key", async () => {
    const project = await createProject();
    const task = await createTask(project.slug, { title: "Trashed", priority: "high" });
    expect((await remove(project.slug, task.key)).statusCode).toBe(200);

    // Invisible everywhere except the trash.
    expect((await read(project.slug, task.key)).statusCode).toBe(404);
    const listRes = await app.inject({
      method: "GET",
      url: `/api/projects/${project.slug}/tasks`,
      headers: HEADERS,
    });
    expect((listRes.json().data as Task[]).find((t) => t.id === task.id)).toBeUndefined();

    const trashRes = await getTrash(project.slug);
    expect(trashRes.statusCode).toBe(200);
    expect(trashRes.json().meta).toMatchObject({ total: 1, hasMore: false });
    const trashed = trashRes.json().data as Task[];
    expect(trashed).toHaveLength(1);
    expect(trashed[0]).toMatchObject({ id: task.id, key: task.key });
    expect(trashed[0]!.deletedAt).toEqual(expect.any(String));

    const restoreRes = await restore(project.slug, task.key);
    expect(restoreRes.statusCode).toBe(200);
    const restored = restoreRes.json().data as Task;
    expect(restored).toMatchObject({
      id: task.id,
      key: task.key,
      title: "Trashed",
      priority: "high",
      deletedAt: null,
    });

    // Restored intact: visible again under a normal read and in the list.
    const again = await read(project.slug, task.key);
    expect(again.statusCode).toBe(200);
    expect(again.json().data).toMatchObject({ key: task.key, deletedAt: null });
    expect((await getTrash(project.slug)).json().data).toEqual([]);
  });

  it("restores by uuid as well as by key", async () => {
    const project = await createProject();
    const task = await createTask(project.slug, { title: "By id" });
    await remove(project.slug, task.key);

    const res = await restore(project.slug, task.id);

    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({ key: task.key });
  });

  it("404s restoring a task that was never trashed", async () => {
    const project = await createProject();
    const task = await createTask(project.slug, { title: "Never trashed" });

    const res = await restore(project.slug, task.key);

    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("TASK_NOT_FOUND");
  });

  it("404s restoring a ref that does not exist", async () => {
    const project = await createProject();

    const res = await restore(project.slug, "TASK-404");

    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("TASK_NOT_FOUND");
  });

  it("404s restoring a hard-deleted task", async () => {
    const project = await createProject();
    const task = await createTask(project.slug, { title: "Gone for good" });
    await remove(project.slug, task.key, "?hard=true");

    const res = await restore(project.slug, task.key);

    expect(res.statusCode).toBe(404);
  });

  it("lists an empty trash for a project with nothing deleted", async () => {
    const project = await createProject();
    await createTask(project.slug, { title: "Still around" });

    const res = await getTrash(project.slug);

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ data: [], meta: { total: 0 } });
  });
});

describe("parentId", () => {
  it("resolves a parent given by key to its uuid", async () => {
    const project = await createProject();
    const epic = await createTask(project.slug, { title: "The epic", size: "Epic" });

    const child = await createTask(project.slug, { title: "A child", parentId: epic.key });

    expect(child.parentId).toBe(epic.id);
  });

  it("refuses a parent that does not exist", async () => {
    const project = await createProject();

    const res = await post(project.slug, { title: "Orphan", parentId: "TASK-404" });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("PARENT_NOT_FOUND");
  });

  it("updates a child whose parent is in the trash", async () => {
    const project = await createProject();
    const epic = await createTask(project.slug, { title: "The epic", size: "Epic" });
    const child = await createTask(project.slug, { title: "A child", parentId: epic.key });
    expect((await remove(project.slug, epic.key)).statusCode).toBe(200);

    const next = await update(project.slug, child.key, { title: "Renamed" });

    expect(next).toMatchObject({ title: "Renamed", parentId: epic.id });
  });

  it("still refuses a write that names a trashed task as the parent", async () => {
    const project = await createProject();
    const epic = await createTask(project.slug, { title: "The epic", size: "Epic" });
    const orphan = await createTask(project.slug, { title: "No parent yet" });
    expect((await remove(project.slug, epic.key)).statusCode).toBe(200);

    const res = await patch(project.slug, orphan.key, { parentId: epic.key });

    expect(res.statusCode).toBe(422);
    expect(res.json().error).toMatchObject({
      code: "PARENT_NOT_FOUND",
      details: { parentId: epic.key },
    });
  });

  it("detaches a child from its parent with null", async () => {
    const project = await createProject();
    const epic = await createTask(project.slug, { title: "The epic", size: "Epic" });
    const child = await createTask(project.slug, { title: "A child", parentId: epic.key });

    const next = await update(project.slug, child.key, { parentId: null });

    expect(next.parentId).toBeNull();
  });
});

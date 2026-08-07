import { mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type Database from "better-sqlite3";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../../src/server/app.js";
import { openDatabase } from "../../../src/server/db/index.js";
import { clearValidatorCache, getValidator } from "../../../src/server/fields/validator.js";
import { clearVersionCache } from "../../../src/server/projects/version.js";
import { nextTaskKey } from "../../../src/server/tasks/keys.js";
import { STATUS_CATALOGUE } from "../../../src/shared/statuses.js";
import type { Project, ProjectView } from "../../../src/shared/types.js";

const HEADERS = { host: "localhost:4400" };

let dir: string;
let db: Database.Database;
let app: FastifyInstance;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "paim-projects-"));
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

async function create(body: Record<string, unknown>) {
  return app.inject({ method: "POST", url: "/api/projects", headers: HEADERS, payload: body });
}

async function createProject(body: Record<string, unknown>): Promise<ProjectView> {
  const res = await create(body);
  expect(res.statusCode).toBe(201);
  return res.json().data as ProjectView;
}

async function patch(slug: string, body: Record<string, unknown>) {
  return app.inject({
    method: "POST",
    url: `/api/projects/${slug}`,
    headers: HEADERS,
    payload: body,
  });
}

async function read(slug: string) {
  return app.inject({ method: "GET", url: `/api/projects/${slug}`, headers: HEADERS });
}

/**
 * A minimal, valid row in the real `tasks` table (T10) — enough for DELETE's
 * task count and cascade to exercise against, without depending on the
 * create/read work of a later task.
 */
function seedTask(projectId: string, id: string): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO tasks (id, key, projectId, title, status, size, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, `TASK-${id}`, projectId, "Seed task", "backlog", "S", now, now);
}

describe("the projects migration", () => {
  it("creates the projects table", () => {
    const row = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'projects'")
      .get();

    expect(row).toEqual({ name: "projects" });
  });
});

describe("POST /api/projects", () => {
  it("creates a project from a name alone, deriving the slug", async () => {
    const project = await createProject({ name: "Project AI Manager" });

    expect(project.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(project.slug).toBe("project-ai-manager");
    expect(project.name).toBe("Project AI Manager");
    expect(project.createdAt).toEqual(project.updatedAt);
    expect(project.archivedAt).toBeNull();
  });

  it("applies the documented defaults to every setting", async () => {
    const project = await createProject({ name: "Defaults" });

    expect(project.maxConcurrentRuns).toBe(1);
    expect(project.trashRetentionDays).toBe(30);
    expect(project.safety).toEqual({ denyList: [], mode: "ask_all", askList: [] });
    expect(project.status).toBe("active");
    expect(project.type).toBe("generic");
    expect(project.description).toBe("");
    expect(project.icon).toBeNull();
    expect(project.color).toBeNull();
    expect(project.workspacePath).toBeNull();
    expect(project.autoCommit).toBe(false);
    expect(project.autoPush).toBe(false);
    expect(project.fieldSchema).toEqual([]);
    expect(project.regressionTests).toEqual([]);
    expect(project.testFramework).toBeNull();
    expect(project.allowedModels).toEqual([]);
    expect(project.usageCaps).toEqual({ fiveHour: null, weekly: null, fable: null });
    expect(project.statuses).toEqual([
      "backlog",
      "open_questions",
      "design",
      "ready",
      "executing",
      "testing",
      "done",
    ]);
  });

  it("rejects a request without a name", async () => {
    const res = await create({ description: "no name here" });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("NAME_REQUIRED");
  });

  it("rejects an empty name", async () => {
    const res = await create({ name: "   " });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_FAILED");
  });

  it("derives a URL-safe slug from a name full of punctuation", async () => {
    const project = await createProject({ name: "Ünïcödé / Ops & Tools!" });

    expect(project.slug).toBe("unicode-ops-tools");
    expect(encodeURIComponent(project.slug)).toBe(project.slug);
  });

  it("keeps derived slugs unique by suffixing", async () => {
    const first = await createProject({ name: "PAIM" });
    const second = await createProject({ name: "PAIM" });
    const third = await createProject({ name: "paim" });

    expect(first.slug).toBe("paim");
    expect(second.slug).toBe("paim-2");
    expect(third.slug).toBe("paim-3");
  });

  it("accepts an explicit slug", async () => {
    const project = await createProject({ name: "Anything", slug: "chosen-slug" });

    expect(project.slug).toBe("chosen-slug");
  });

  it("rejects an explicit slug that is not URL-safe", async () => {
    const res = await create({ name: "Anything", slug: "Not A Slug" });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.details).toMatchObject({ field: "slug" });
  });

  it("rejects an explicit slug that is already taken", async () => {
    await createProject({ name: "PAIM" });
    const res = await create({ name: "Other", slug: "paim" });

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("SLUG_TAKEN");
  });

  it("refuses to accept server-owned properties", async () => {
    const res = await create({ name: "PAIM", createdAt: "2020-01-01T00:00:00.000Z" });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("READ_ONLY_PROPERTY");
  });

  it("refuses an unknown property", async () => {
    const res = await create({ name: "PAIM", nonsense: true });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatchObject({
      code: "UNKNOWN_PROPERTY",
      details: { field: "nonsense" },
    });
  });
});

describe("settings round-trip", () => {
  // Every field of docs/02 "Project" that a caller can write, in one payload.
  const settings = {
    description: "# PAIM\n\nA local task service.",
    icon: "🗂",
    color: "teal",
    type: "node",
    workspacePath: "/Users/edu/Projects/paim",
    autoCommit: true,
    autoPush: true,
    statuses: [
      "backlog",
      "open_questions",
      "design",
      "ready",
      "executing",
      "testing",
      "ai_review",
      "manual_review",
      "done",
      "cancelled",
    ],
    fieldSchema: [
      { key: "layer", label: "Layer", type: "select", options: ["api", "ui"], order: 1 },
      { key: "notes", label: "Notes", type: "long_text", order: 2 },
    ],
    testFramework: "vitest",
    regressionTests: [
      {
        id: "t1",
        name: "api/cursor-pagination",
        command: "npm test -- pagination",
        timeoutMs: 1000,
      },
    ],
    safety: {
      denyList: ["rm -rf /*", "git push --force*"],
      mode: "ask_listed",
      askList: ["git push*", "*.env"],
    },
    composeModel: { model: "claude-haiku-4-5", effort: "low" },
    modelRouting: {
      field: "size",
      map: {
        XS: { model: "claude-haiku-4-5", effort: "low" },
        M: { model: "claude-opus-5", effort: "high" },
      },
      fallback: { model: "claude-opus-5", effort: "xhigh" },
    },
    allowedModels: ["claude-opus-5", "claude-haiku-4-5"],
    usageCaps: { fiveHour: 2_000_000, weekly: 10_000_000, fable: null },
    maxConcurrentRuns: 3,
    trashRetentionDays: 7,
  } as const;

  it("stores and returns every settings field unchanged, across a fresh read", async () => {
    const created = await createProject({ name: "Full", ...settings });
    expect(created).toMatchObject(settings);

    const fetched = (await read("full")).json().data as Project;
    expect(fetched).toMatchObject(settings);
  });

  it("survives a database reopen (values are persisted, not cached)", async () => {
    await createProject({ name: "Full", ...settings });
    await app.close();
    db.close();

    db = openDatabase(join(dir, "paim.db"));
    app = createApp({ db });

    const fetched = (await read("full")).json().data as Project;
    expect(fetched).toMatchObject(settings);
  });

  it("round-trips each settings field written on its own by a partial update", async () => {
    await createProject({ name: "Piecemeal" });

    for (const [key, value] of Object.entries(settings)) {
      // autoPush cannot be enabled on its own (docs/12 "Git").
      const payload = key === "autoPush" ? { autoCommit: true, autoPush: value } : { [key]: value };
      const res = await patch("piecemeal", payload);

      expect(res.statusCode, `${key} -> ${JSON.stringify(res.json())}`).toBe(200);
      expect(res.json().data[key]).toEqual(value);
      expect((await read("piecemeal")).json().data[key]).toEqual(value);
    }
  });
});

describe("statuses validation", () => {
  it("stores the selection in catalogue order, not the caller's", async () => {
    const project = await createProject({
      name: "Ordered",
      statuses: ["done", "executing", "ready", "design", "open_questions", "backlog"],
    });

    expect(project.statuses).toEqual([
      "backlog",
      "open_questions",
      "design",
      "ready",
      "executing",
      "done",
    ]);
  });

  it("accepts the whole catalogue", async () => {
    const project = await createProject({ name: "All", statuses: [...STATUS_CATALOGUE] });

    expect(project.statuses).toEqual([...STATUS_CATALOGUE]);
  });

  it("rejects a set missing a required status", async () => {
    const res = await create({
      name: "Broken",
      statuses: ["open_questions", "design", "ready", "done"],
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("STATUSES_INVALID");
    expect(res.json().error.details.missing).toEqual(["executing"]);
  });

  it("rejects a status outside the catalogue", async () => {
    const res = await create({
      name: "Invented",
      statuses: ["open_questions", "design", "ready", "executing", "done", "blocked"],
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error).toMatchObject({
      code: "STATUSES_INVALID",
      details: { unknown: ["blocked"] },
    });
  });

  it("rejects an invalid set on update, leaving the stored pipeline intact", async () => {
    const before = await createProject({ name: "Keep" });
    const res = await patch("keep", { statuses: ["ready", "done"] });

    expect(res.statusCode).toBe(422);
    expect((await read("keep")).json().data.statuses).toEqual(before.statuses);
  });

  it("deduplicates a repeated status", async () => {
    const project = await createProject({
      name: "Dupes",
      statuses: ["ready", "ready", "open_questions", "design", "executing", "done"],
    });

    expect(project.statuses).toEqual([
      "open_questions",
      "design",
      "ready",
      "executing",
      "done",
    ]);
  });
});

describe("version on project reads", () => {
  it("is null for a project without a workspacePath", async () => {
    const created = await createProject({ name: "No Workspace" });

    expect(created.version).toBeNull();
    expect((await read("no-workspace")).json().data.version).toBeNull();
  });

  it("reflects package.json and updates after the file's mtime changes, without a restart", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "paim-workspace-"));
    writeFileSync(join(workspace, "package.json"), JSON.stringify({ version: "1.0.0" }));

    const created = await createProject({
      name: "Versioned",
      type: "node",
      workspacePath: workspace,
    });
    expect(created.version).toBe("1.0.0");

    // Same mtime: still 1.0.0 from cache.
    expect((await read("versioned")).json().data.version).toBe("1.0.0");

    // Bump the source file's mtime and change its content.
    writeFileSync(join(workspace, "package.json"), JSON.stringify({ version: "2.0.0" }));
    const future = new Date(Date.now() + 5000);
    utimesSync(join(workspace, "package.json"), future, future);

    const updated = (await read("versioned")).json().data as ProjectView;
    expect(updated.version).toBe("2.0.0");

    rmSync(workspace, { recursive: true, force: true });
  });
});

describe("GET /api/projects/:project", () => {
  it("reads a project by slug", async () => {
    const created = await createProject({ name: "PAIM" });
    const res = await read("paim");

    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual(created);
  });

  it("returns 404 PROJECT_NOT_FOUND for an unknown slug", async () => {
    const res = await read("nope");

    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("PROJECT_NOT_FOUND");
  });
});

describe("POST /api/projects/:project (partial update)", () => {
  it("merges only the supplied keys and stamps updatedAt", async () => {
    const created = await createProject({ name: "PAIM", description: "before", type: "node" });
    const res = await patch("paim", { description: "after" });
    const updated = res.json().data as Project;

    expect(res.statusCode).toBe(200);
    expect(updated.description).toBe("after");
    expect(updated.name).toBe("PAIM");
    expect(updated.type).toBe("node");
    expect(updated.id).toBe(created.id);
    expect(updated.createdAt).toBe(created.createdAt);
    expect(Date.parse(updated.updatedAt)).toBeGreaterThanOrEqual(Date.parse(created.updatedAt));
  });

  it("merges one level into an object setting instead of replacing it", async () => {
    await createProject({
      name: "PAIM",
      safety: { denyList: ["rm -rf /*"], mode: "ask_all", askList: ["git push*"] },
    });

    const updated = (await patch("paim", { safety: { mode: "allow_all" } })).json().data as Project;

    expect(updated.safety).toEqual({
      denyList: ["rm -rf /*"],
      mode: "allow_all",
      askList: ["git push*"],
    });
  });

  it("replaces an array setting wholesale", async () => {
    await createProject({ name: "PAIM", allowedModels: ["claude-opus-5", "claude-fable-5"] });

    const updated = (await patch("paim", { allowedModels: ["claude-sonnet-5"] })).json()
      .data as Project;

    expect(updated.allowedModels).toEqual(["claude-sonnet-5"]);
  });

  it("rejects a slug change with 422 SLUG_IMMUTABLE", async () => {
    await createProject({ name: "PAIM" });
    const res = await patch("paim", { slug: "renamed" });

    expect(res.statusCode).toBe(422);
    expect(res.json().error).toMatchObject({
      code: "SLUG_IMMUTABLE",
      details: { slug: "paim", requested: "renamed" },
    });
    expect((await read("paim")).statusCode).toBe(200);
    expect((await read("renamed")).statusCode).toBe(404);
  });

  it("accepts the unchanged slug as a no-op", async () => {
    await createProject({ name: "PAIM" });
    const res = await patch("paim", { slug: "paim", name: "PAIM!" });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.name).toBe("PAIM!");
  });

  it("rejects an unknown enum value", async () => {
    await createProject({ name: "PAIM" });
    const res = await patch("paim", { type: "cobol" });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatchObject({
      code: "VALIDATION_FAILED",
      details: { field: "type" },
    });
  });

  it("rejects a colour outside the eight identity tones", async () => {
    await createProject({ name: "PAIM" });
    const res = await patch("paim", { color: "fuchsia" });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.details.field).toBe("color");
  });

  it("refuses autoPush without autoCommit", async () => {
    await createProject({ name: "PAIM" });
    const res = await patch("paim", { autoPush: true });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("AUTOPUSH_REQUIRES_AUTOCOMMIT");
  });

  it("returns 404 for an unknown project", async () => {
    const res = await patch("nope", { name: "x" });

    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("PROJECT_NOT_FOUND");
  });
});

describe("archive via status update", () => {
  it("sets archivedAt when the status becomes archived", async () => {
    await createProject({ name: "PAIM" });
    const archived = (await patch("paim", { status: "archived" })).json().data as Project;

    expect(archived.status).toBe("archived");
    expect(archived.archivedAt).not.toBeNull();
    expect(Date.parse(archived.archivedAt!)).not.toBeNaN();
  });

  it("keeps an archived project readable", async () => {
    await createProject({ name: "PAIM" });
    await patch("paim", { status: "archived" });

    const res = await read("paim");

    expect(res.statusCode).toBe(200);
    expect(res.json().data.status).toBe("archived");
  });

  it("keeps the original archivedAt across further updates", async () => {
    await createProject({ name: "PAIM" });
    const archived = (await patch("paim", { status: "archived" })).json().data as Project;
    const again = (await patch("paim", { description: "still archived" })).json().data as Project;

    expect(again.archivedAt).toBe(archived.archivedAt);
  });

  it("clears archivedAt when the project is unarchived", async () => {
    await createProject({ name: "PAIM" });
    await patch("paim", { status: "archived" });
    const restored = (await patch("paim", { status: "active" })).json().data as Project;

    expect(restored.status).toBe("active");
    expect(restored.archivedAt).toBeNull();
  });

  it("refuses archivedAt as a direct write", async () => {
    await createProject({ name: "PAIM" });
    const res = await patch("paim", { archivedAt: "2020-01-01T00:00:00.000Z" });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("READ_ONLY_PROPERTY");
  });
});

describe("GET /api/projects", () => {
  beforeEach(async () => {
    await createProject({ name: "Alpha" });
    await createProject({ name: "Beta" });
    await createProject({ name: "Gamma" });
    await patch("gamma", { status: "archived" });
  });

  async function list(query = "") {
    const res = await app.inject({
      method: "GET",
      url: `/api/projects${query}`,
      headers: HEADERS,
    });
    return res;
  }

  it("hides archived projects by default", async () => {
    const res = await list();

    expect(res.statusCode).toBe(200);
    expect(res.json().data.map((p: Project) => p.slug)).toEqual(["alpha", "beta"]);
  });

  it("returns the list envelope with a total", async () => {
    const body = (await list()).json();

    expect(body.meta).toEqual({ total: 2, cursor: null, hasMore: false });
  });

  it("filters to active explicitly", async () => {
    const body = (await list("?status=active")).json();

    expect(body.data.map((p: Project) => p.slug)).toEqual(["alpha", "beta"]);
  });

  it("filters to archived", async () => {
    const body = (await list("?status=archived")).json();

    expect(body.data.map((p: Project) => p.slug)).toEqual(["gamma"]);
    expect(body.meta.total).toBe(1);
  });

  it("returns everything for status=all", async () => {
    const body = (await list("?status=all")).json();

    expect(body.data.map((p: Project) => p.slug)).toEqual(["alpha", "beta", "gamma"]);
  });

  it("rejects an unknown status filter", async () => {
    const res = await list("?status=nonsense");

    expect(res.statusCode).toBe(400);
    expect(res.json().error.details.field).toBe("status");
  });
});

describe("DELETE /api/projects/:project", () => {
  async function del(slug: string, query = "") {
    return app.inject({
      method: "DELETE",
      url: `/api/projects/${slug}${query}`,
      headers: HEADERS,
    });
  }

  it("deletes a project that has no tasks", async () => {
    await createProject({ name: "PAIM" });

    const res = await del("paim");

    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({ slug: "paim", deleted: true });
    expect((await read("paim")).statusCode).toBe(404);
  });

  it("refuses a project with tasks and names the count", async () => {
    const project = await createProject({ name: "PAIM" });
    seedTask(project.id, "t1");
    seedTask(project.id, "t2");

    const res = await del("paim");

    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatchObject({
      code: "PROJECT_HAS_TASKS",
      details: { tasks: 2 },
    });
    expect((await read("paim")).statusCode).toBe(200);
  });

  it("deletes a project with tasks when force=true", async () => {
    const project = await createProject({ name: "PAIM" });
    seedTask(project.id, "t1");

    const res = await del("paim", "?force=true");

    expect(res.statusCode).toBe(200);
    expect((await read("paim")).statusCode).toBe(404);
    const remaining = db.prepare("SELECT COUNT(*) AS n FROM tasks").get() as { n: number };
    expect(remaining.n).toBe(0);
  });

  it("deletes a project that has allocated a task key without a raw FK 500 (T11 task_counters cascade)", async () => {
    const project = await createProject({ name: "PAIM" });
    // Exactly what T12 does on first task create: allocate a key, which
    // creates a `task_counters` row for this project.
    nextTaskKey(db, project.id, "feature");
    const before = db
      .prepare("SELECT COUNT(*) AS n FROM task_counters WHERE projectId = ?")
      .get(project.id) as { n: number };
    expect(before.n).toBe(1);

    const res = await del("paim");

    expect(res.statusCode).toBe(200);
    const after = db
      .prepare("SELECT COUNT(*) AS n FROM task_counters WHERE projectId = ?")
      .get(project.id) as { n: number };
    expect(after.n).toBe(0);
  });

  it("leaves other projects' tasks alone", async () => {
    const keep = await createProject({ name: "Keep" });
    await createProject({ name: "Drop" });
    seedTask(keep.id, "t1");

    await del("drop", "?force=true");

    const remaining = db.prepare("SELECT COUNT(*) AS n FROM tasks").get() as { n: number };
    expect(remaining.n).toBe(1);
  });

  it("frees the slug for reuse", async () => {
    await createProject({ name: "PAIM" });
    await del("paim");

    const recreated = await createProject({ name: "PAIM" });

    expect(recreated.slug).toBe("paim");
  });

  it("invalidates the deleted project's cached validator (docs/03 validation cache)", async () => {
    const project = await createProject({ name: "PAIM" });
    const before = getValidator(project.id, [{ key: "layer", type: "text" }]);

    await del("paim");

    // The cache entry for this id must be gone: asking again with a
    // different schema must not return the stale, pre-delete object.
    const after = getValidator(project.id, [{ key: "estimate", type: "number" }]);
    expect(after).not.toBe(before);
  });

  it("a recreated project with the same slug never inherits the old schema", async () => {
    const original = await createProject({ name: "PAIM" });
    getValidator(original.id, [{ key: "layer", type: "select", options: ["frontend"] }]);
    await del("paim");

    const recreated = await createProject({ name: "PAIM" });
    // A fresh id gets a fresh cache entry, built from its own (empty) schema.
    const validator = getValidator(recreated.id, recreated.fieldSchema ?? []);
    expect(validator.safeParse({ layer: "frontend" }).success).toBe(true); // passthrough, unknown key
    expect(recreated.id).not.toBe(original.id);
  });

  it("returns 404 for an unknown project", async () => {
    const res = await del("nope");

    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("PROJECT_NOT_FOUND");
  });

  it("rejects a force flag that is not a boolean", async () => {
    await createProject({ name: "PAIM" });
    const res = await del("paim", "?force=maybe");

    expect(res.statusCode).toBe(400);
    expect(res.json().error.details.field).toBe("force");
  });
});

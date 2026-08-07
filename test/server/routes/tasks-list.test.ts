/**
 * `GET /api/projects/:project/tasks` — the query surface of docs/06
 * ("Query parameters for the list"): every filter, the sort, and the cursor.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../../src/server/app.js";
import { openDatabase } from "../../../src/server/db/index.js";
import { insertTask } from "../../../src/server/db/tasks.js";
import { clearValidatorCache } from "../../../src/server/fields/validator.js";
import { clearVersionCache } from "../../../src/server/projects/version.js";
import { DEFAULT_STATUSES } from "../../../src/shared/statuses.js";
import type { FieldDef, ProjectView, Task } from "../../../src/shared/types.js";

const HEADERS = { host: "localhost:4400" };

const SCHEMA: FieldDef[] = [
  { key: "type", type: "select", options: ["feature", "bug"] },
  { key: "layer", type: "select", options: ["backend", "frontend"], default: "backend" },
  { key: "points", type: "number" },
];

/** `cancelled` is not in the default pipeline; the list must still filter on it. */
const STATUSES = [...DEFAULT_STATUSES, "cancelled"];

let dir: string;
let db: Database.Database;
let app: FastifyInstance;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "paim-task-list-"));
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
    payload: { name: "PAIM", statuses: STATUSES, fieldSchema: SCHEMA, ...body },
  });
  expect(res.statusCode).toBe(201);
  return res.json().data as ProjectView;
}

async function createTask(slug: string, body: Record<string, unknown>): Promise<Task> {
  const res = await app.inject({
    method: "POST",
    url: `/api/projects/${slug}/tasks`,
    headers: HEADERS,
    payload: body,
  });
  expect(res.statusCode).toBe(201);
  return res.json().data as Task;
}

function patchTask(slug: string, ref: string, body: Record<string, unknown>) {
  return app.inject({
    method: "PATCH",
    url: `/api/projects/${slug}/tasks/${ref}`,
    headers: HEADERS,
    payload: body,
  });
}

function list(query = "", slug = "paim") {
  return app.inject({
    method: "GET",
    url: `/api/projects/${slug}/tasks${query}`,
    headers: HEADERS,
  });
}

interface Page {
  titles: string[];
  total: number;
  cursor: string | null;
  hasMore: boolean;
}

async function page(query = "", slug = "paim"): Promise<Page> {
  const res = await list(query, slug);
  expect(res.statusCode, res.body).toBe(200);
  const body = res.json() as { data: Task[]; meta: Page };
  return {
    titles: body.data.map((task) => task.title),
    total: body.meta.total,
    cursor: body.meta.cursor,
    hasMore: body.meta.hasMore,
  };
}

/**
 * Six tasks that differ in every dimension the query surface filters on.
 * Titles identify them: keys depend on the `type` field and are not the
 * subject of these assertions.
 */
async function seed(): Promise<Record<string, Task>> {
  await createProject();
  const tasks: Record<string, Task> = {};

  tasks["Alpha"] = await createTask("paim", {
    title: "Alpha",
    description: "the first one",
    status: "ready",
    priority: "high",
    size: "M",
    labels: ["backend", "api"],
    assignee: "edu",
    fields: { type: "feature", layer: "backend", points: 3 },
  });
  tasks["Bravo"] = await createTask("paim", {
    title: "Bravo",
    status: "executing",
    priority: "urgent",
    size: "L",
    labels: ["backend"],
    assignee: "ana",
    fields: { type: "bug", layer: "frontend", points: 5 },
  });
  tasks["Charlie"] = await createTask("paim", {
    title: "Charlie",
    description: "holds the needle",
    status: "done",
    priority: "low",
    size: "S",
    labels: ["frontend"],
    assignee: "edu",
    fields: { layer: "frontend" },
  });
  tasks["Delta"] = await createTask("paim", {
    title: "Delta",
    status: "cancelled",
    priority: "none",
    size: "XS",
    // No `layer` value at all: it reads as the field's default, `backend`.
    fields: {},
  });
  tasks["Echo"] = await createTask("paim", {
    title: "Echo",
    status: "backlog",
    priority: "medium",
    size: "Epic",
    fields: { layer: "frontend" },
  });
  tasks["Foxtrot"] = await createTask("paim", {
    title: "Foxtrot",
    status: "ready",
    priority: "high",
    size: "M",
    parentId: tasks["Echo"]!.key,
    fields: { layer: "frontend" },
  });

  return tasks;
}

describe("GET /api/projects/:project/tasks — the whole query surface", () => {
  interface Case {
    name: string;
    query: (tasks: Record<string, Task>) => string;
    expected: string[];
  }

  // Every case sorts on the title, so the expectation is a plain list.
  const cases: Case[] = [
    {
      name: "no filter returns every task",
      query: () => "",
      expected: ["Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot"],
    },
    { name: "status, one value", query: () => "&status=ready", expected: ["Alpha", "Foxtrot"] },
    {
      name: "status, csv",
      query: () => "&status=ready,executing",
      expected: ["Alpha", "Bravo", "Foxtrot"],
    },
    {
      name: "status, repeated parameter",
      query: () => "&status=ready&status=executing",
      expected: ["Alpha", "Bravo", "Foxtrot"],
    },
    {
      name: "open=true is the todo and in_progress categories",
      query: () => "&open=true",
      expected: ["Alpha", "Bravo", "Echo", "Foxtrot"],
    },
    {
      name: "open=false is done and cancelled",
      query: () => "&open=false",
      expected: ["Charlie", "Delta"],
    },
    {
      name: "priority, csv",
      query: () => "&priority=high,urgent",
      expected: ["Alpha", "Bravo", "Foxtrot"],
    },
    { name: "label", query: () => "&label=backend", expected: ["Alpha", "Bravo"] },
    {
      name: "label, csv is a union",
      query: () => "&label=api,frontend",
      expected: ["Alpha", "Charlie"],
    },
    { name: "assignee", query: () => "&assignee=edu", expected: ["Alpha", "Charlie"] },
    {
      name: "parent, by key",
      query: (tasks) => `&parent=${tasks["Echo"]!.key}`,
      expected: ["Foxtrot"],
    },
    {
      name: "parent, by uuid",
      query: (tasks) => `&parent=${tasks["Echo"]!.id}`,
      expected: ["Foxtrot"],
    },
    { name: "size, csv", query: () => "&size=M,L", expected: ["Alpha", "Bravo", "Foxtrot"] },
    { name: "size, Epic", query: () => "&size=Epic", expected: ["Echo"] },
    {
      name: "field.<key> matches a stored value and the field's default",
      query: () => "&field.layer=backend",
      expected: ["Alpha", "Delta"],
    },
    {
      name: "field.<key> on a value nobody defaults to",
      query: () => "&field.layer=frontend",
      expected: ["Bravo", "Charlie", "Echo", "Foxtrot"],
    },
    { name: "field.<key> on a number", query: () => "&field.points=5", expected: ["Bravo"] },
    {
      name: "field.<key>, csv is a union",
      query: () => "&field.points=3,5",
      expected: ["Alpha", "Bravo"],
    },
    { name: "q matches the title, case-insensitively", query: () => "&q=alp", expected: ["Alpha"] },
    { name: "q matches the description", query: () => "&q=needle", expected: ["Charlie"] },
    { name: "q that matches nothing", query: () => "&q=zzz", expected: [] },
    {
      name: "two filters are AND-ed",
      query: () => "&status=ready&field.layer=frontend",
      expected: ["Foxtrot"],
    },
    {
      name: "the acceptance criterion of specs/03",
      query: () => "&field.layer=backend&status=ready",
      expected: ["Alpha"],
    },
  ];

  it.each(cases)("$name", async ({ query, expected }) => {
    const tasks = await seed();
    expect((await page(`?sort=title${query(tasks)}`)).titles).toEqual(expected);
  });

  it("reports the total of the whole match, not of the page", async () => {
    await seed();
    const first = await page("?sort=title&status=ready,executing&limit=1");

    expect(first.titles).toEqual(["Alpha"]);
    expect(first.total).toBe(3);
    expect(first.hasMore).toBe(true);
  });

  it("hides a trashed task", async () => {
    const tasks = await seed();
    const res = await app.inject({
      method: "DELETE",
      url: `/api/projects/paim/tasks/${tasks["Alpha"]!.key}`,
      headers: HEADERS,
    });
    expect(res.statusCode).toBe(200);

    const all = await page("?sort=title");
    expect(all.titles).not.toContain("Alpha");
    expect(all.total).toBe(5);
  });

  it("never returns the tasks of another project", async () => {
    await seed();
    await createProject({ name: "Other", slug: "other" });
    await createTask("other", { title: "Zulu" });

    expect((await page("?sort=title")).titles).not.toContain("Zulu");
    expect((await page("?sort=title", "other")).titles).toEqual(["Zulu"]);
  });

  it("filters on updatedSince", async () => {
    const tasks = await seed();
    await new Promise((resolve) => setTimeout(resolve, 5));
    const res = await patchTask("paim", tasks["Charlie"]!.key, { priority: "urgent" });
    expect(res.statusCode).toBe(200);
    const updatedAt = (res.json().data as Task).updatedAt;

    const since = encodeURIComponent(updatedAt);
    expect((await page(`?sort=title&updatedSince=${since}`)).titles).toEqual(["Charlie"]);
  });

  it("treats % and _ in q as characters, not as wildcards", async () => {
    await createProject();
    await createTask("paim", { title: "100% covered" });
    await createTask("paim", { title: "anything at all" });

    expect((await page("?sort=title&q=100%25")).titles).toEqual(["100% covered"]);
    expect((await page("?sort=title&q=%25")).titles).toEqual(["100% covered"]);
    expect((await page("?sort=title&q=_")).titles).toEqual([]);
  });

  it("answers 404 for a project that does not exist", async () => {
    const res = await list("", "nope");
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("PROJECT_NOT_FOUND");
  });

  it("refuses a parent reference that names no task", async () => {
    await seed();
    const res = await list("?parent=FEAT-999");

    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("PARENT_NOT_FOUND");
  });

  it("refuses an unusable parameter with a stable code", async () => {
    await seed();
    for (const query of ["?status=nope", "?sort=nope", "?limit=0", "?open=maybe"]) {
      const res = await list(query);
      expect(res.statusCode, query).toBe(400);
      expect(res.json().error.code, query).toBe("VALIDATION_FAILED");
    }
  });

  it("completes the fields of every returned task from the schema", async () => {
    await seed();
    const res = await list("?sort=title&q=Delta");
    const [task] = res.json().data as Task[];

    // docs/03 rule 1: a field with no stored value reads as its default.
    expect(task!.fields).toEqual({ type: null, layer: "backend", points: null });
  });
});

describe("GET /api/projects/:project/tasks — sort", () => {
  it("sorts on the title, ascending and descending", async () => {
    await seed();
    expect((await page("?sort=title")).titles).toEqual([
      "Alpha",
      "Bravo",
      "Charlie",
      "Delta",
      "Echo",
      "Foxtrot",
    ]);
    expect((await page("?sort=-title")).titles).toEqual([
      "Foxtrot",
      "Echo",
      "Delta",
      "Charlie",
      "Bravo",
      "Alpha",
    ]);
  });

  it("sorts priority and size on their scale, not alphabetically", async () => {
    await seed();
    // none < low < medium < high < urgent (docs/02 "Task").
    expect((await page("?sort=priority,title")).titles).toEqual([
      "Delta",
      "Charlie",
      "Echo",
      "Alpha",
      "Foxtrot",
      "Bravo",
    ]);
    // XS < S < M < L < XL < Epic (docs/02 "Size").
    expect((await page("?sort=size,title")).titles).toEqual([
      "Delta",
      "Charlie",
      "Alpha",
      "Foxtrot",
      "Bravo",
      "Echo",
    ]);
  });

  it("sorts status in pipeline order", async () => {
    await seed();
    expect((await page("?sort=status,title")).titles).toEqual([
      "Echo",
      "Alpha",
      "Foxtrot",
      "Bravo",
      "Charlie",
      "Delta",
    ]);
  });

  it("sorts a second column inside the first", async () => {
    await seed();
    expect((await page("?sort=-priority,-title")).titles).toEqual([
      "Bravo",
      "Foxtrot",
      "Alpha",
      "Echo",
      "Charlie",
      "Delta",
    ]);
  });

  it("sorts keys naturally: TASK-2 before TASK-10", async () => {
    await createProject();
    for (let i = 0; i < 12; i += 1) await createTask("paim", { title: `t${i}` });

    const res = await list("?sort=key&limit=12");
    const keys = (res.json().data as Task[]).map((task) => task.key);
    expect(keys.slice(0, 3)).toEqual(["TASK-1", "TASK-2", "TASK-3"]);
    expect(keys[11]).toBe("TASK-12");
  });

  it("defaults to the most recently updated task first", async () => {
    const tasks = await seed();
    await new Promise((resolve) => setTimeout(resolve, 5));
    await patchTask("paim", tasks["Alpha"]!.key, { priority: "low" });

    expect((await page()).titles[0]).toBe("Alpha");
  });
});

describe("GET /api/projects/:project/tasks — cursor pagination", () => {
  it("walks two pages without repeating or skipping a task", async () => {
    await seed();

    const first = await page("?sort=title&limit=4");
    expect(first.titles).toEqual(["Alpha", "Bravo", "Charlie", "Delta"]);
    expect(first.total).toBe(6);
    expect(first.hasMore).toBe(true);
    expect(first.cursor).toBeTypeOf("string");

    const second = await page(`?sort=title&limit=4&cursor=${encodeURIComponent(first.cursor!)}`);
    expect(second.titles).toEqual(["Echo", "Foxtrot"]);
    expect(second.total).toBe(6);
    expect(second.hasMore).toBe(false);
    expect(second.cursor).toBeNull();

    expect([...first.titles, ...second.titles]).toEqual([
      "Alpha",
      "Bravo",
      "Charlie",
      "Delta",
      "Echo",
      "Foxtrot",
    ]);
  });

  it("walks the whole list one task at a time", async () => {
    await seed();
    const seen: string[] = [];
    let query = "?sort=-priority,title&limit=1";

    for (let guard = 0; guard < 20; guard += 1) {
      const result = await page(query);
      seen.push(...result.titles);
      if (!result.hasMore) break;
      query = `?sort=-priority,title&limit=1&cursor=${encodeURIComponent(result.cursor!)}`;
    }

    expect(seen).toEqual(["Bravo", "Alpha", "Foxtrot", "Echo", "Charlie", "Delta"]);
  });

  it("keeps the walk stable when a task is added behind the cursor", async () => {
    await seed();
    const first = await page("?sort=title&limit=3");
    expect(first.titles).toEqual(["Alpha", "Bravo", "Charlie"]);

    // Keyset pagination, not an offset: a task that sorts before the cursor
    // must not push a row of page two onto page three.
    await createTask("paim", { title: "Aardvark" });

    const second = await page(`?sort=title&limit=3&cursor=${encodeURIComponent(first.cursor!)}`);
    expect(second.titles).toEqual(["Delta", "Echo", "Foxtrot"]);
    expect(second.total).toBe(7);
  });

  it("carries the filters: a cursor of one query is refused by another", async () => {
    await seed();
    const first = await page("?sort=title&limit=2&status=ready,executing");

    const cursor = encodeURIComponent(first.cursor!);
    const res = await list(`?sort=title&limit=2&status=ready&cursor=${cursor}`);
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("CURSOR_INVALID");
  });

  it("refuses a cursor that is not one it issued", async () => {
    await seed();
    const res = await list("?cursor=zzzz");

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("CURSOR_INVALID");
  });
});

describe("GET /api/projects/:project/tasks — performance", () => {
  /** Inserts straight into the table: the subject here is the read. */
  function seedMany(projectId: string, count: number): void {
    const now = new Date().toISOString();
    const insert = db.transaction(() => {
      for (let i = 0; i < count; i += 1) {
        insertTask(db, {
          id: randomUUID(),
          key: `TASK-${i + 1}`,
          projectId,
          title: `Task number ${i}`,
          description: `description of task ${i}`,
          status: i % 3 === 0 ? "ready" : i % 3 === 1 ? "executing" : "done",
          priority: (["none", "low", "medium", "high", "urgent"] as const)[i % 5]!,
          size: (["XS", "S", "M", "L", "XL"] as const)[i % 5]!,
          kind: "task",
          labels: i % 2 === 0 ? ["backend"] : ["frontend"],
          assignee: i % 4 === 0 ? "edu" : "ana",
          parentId: null,
          order: i,
          fields: { layer: i % 2 === 0 ? "backend" : "frontend", points: i % 8 },
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
          sourcePrompt: "",
          evaluatedAt: null,
          staleReason: null,
          deletedAt: null,
          createdAt: now,
          updatedAt: new Date(Date.now() + i).toISOString(),
          closedAt: null,
        });
      }
    });
    insert();
  }

  it("answers a filtered, sorted page over 1 000 tasks with a p99 under 30 ms", async () => {
    const project = await createProject();
    seedMany(project.id, 1000);

    const query = "?field.layer=backend&status=ready&sort=-updatedAt&limit=50";
    expect((await page(query)).total).toBeGreaterThan(100);

    // Warm the statement cache and the JIT before measuring.
    for (let i = 0; i < 30; i += 1) await list(query);

    const samples: number[] = [];
    for (let i = 0; i < 200; i += 1) {
      const started = performance.now();
      const res = await list(query);
      samples.push(performance.now() - started);
      expect(res.statusCode).toBe(200);
    }

    samples.sort((a, b) => a - b);
    const p99 = samples[Math.min(samples.length - 1, Math.ceil(samples.length * 0.99) - 1)]!;
    expect(p99, `p99 was ${p99.toFixed(2)} ms`).toBeLessThan(30);
  });
});

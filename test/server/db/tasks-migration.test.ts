import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase } from "../../../src/server/db/index.js";
import type { Task } from "../../../src/shared/types.js";

let dir: string;
let db: Database.Database;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "paim-tasks-migration-"));
  db = openDatabase(join(dir, "paim.db"));
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

/** Creates a project row directly, so the tasks FK has something to point at. */
function seedProject(id: string): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO projects (
       id, slug, name, description, icon, color, status, type, workspacePath,
       autoCommit, autoPush, statuses, fieldSchema, testFramework, regressionTests,
       safety, composeModel, modelRouting, allowedModels, usageCaps,
       maxConcurrentRuns, trashRetentionDays, createdAt, updatedAt, archivedAt
     ) VALUES (
       @id, @slug, @name, @description, @icon, @color, @status, @type, @workspacePath,
       @autoCommit, @autoPush, @statuses, @fieldSchema, @testFramework, @regressionTests,
       @safety, @composeModel, @modelRouting, @allowedModels, @usageCaps,
       @maxConcurrentRuns, @trashRetentionDays, @createdAt, @updatedAt, @archivedAt
     )`,
  ).run({
    id,
    slug: `project-${id}`,
    name: "Project",
    description: "",
    icon: null,
    color: null,
    status: "active",
    type: "generic",
    workspacePath: null,
    autoCommit: 0,
    autoPush: 0,
    statuses: JSON.stringify(["backlog", "open_questions", "design", "ready", "executing", "done"]),
    fieldSchema: "[]",
    testFramework: null,
    regressionTests: "[]",
    safety: JSON.stringify({ denyList: [], mode: "ask_all", askList: [] }),
    composeModel: JSON.stringify({ model: "claude-opus-5", effort: "medium" }),
    modelRouting: JSON.stringify({ field: null, map: {}, fallback: { model: "claude-opus-5", effort: "high" } }),
    allowedModels: "[]",
    usageCaps: JSON.stringify({ fiveHour: null, weekly: null, fable: null }),
    maxConcurrentRuns: 1,
    trashRetentionDays: 30,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
  });
}

/** The raw shape of a `tasks` row: JSON columns are still text here. */
interface TaskRow {
  id: string;
  key: string;
  projectId: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  size: string;
  kind: string;
  labels: string;
  assignee: string | null;
  parentId: string | null;
  order: number;
  fields: string;
  model: string | null;
  effort: string | null;
  safety: string | null;
  childManualReview: number | null;
  schedule: string | null;
  dependsOn: string;
  questions: string;
  designOptions: string;
  tests: string;
  reviews: string;
  sourcePrompt: string;
  evaluatedAt: string | null;
  staleReason: string | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
}

const COLUMNS = [
  "id",
  "key",
  "projectId",
  "title",
  "description",
  "status",
  "priority",
  "size",
  "kind",
  "labels",
  "assignee",
  "parentId",
  '"order"',
  "fields",
  "model",
  "effort",
  "safety",
  "childManualReview",
  "schedule",
  "dependsOn",
  "questions",
  "designOptions",
  "tests",
  "reviews",
  "sourcePrompt",
  "evaluatedAt",
  "staleReason",
  "deletedAt",
  "createdAt",
  "updatedAt",
  "closedAt",
];

function taskToRow(task: Task): Record<string, unknown> {
  return {
    id: task.id,
    key: task.key,
    projectId: task.projectId,
    title: task.title,
    description: task.description,
    status: task.status,
    priority: task.priority,
    size: task.size,
    kind: task.kind,
    labels: JSON.stringify(task.labels),
    assignee: task.assignee,
    parentId: task.parentId,
    order: task.order,
    fields: JSON.stringify(task.fields),
    model: task.model,
    effort: task.effort,
    safety: task.safety === null ? null : JSON.stringify(task.safety),
    childManualReview: task.childManualReview === null ? null : task.childManualReview ? 1 : 0,
    schedule: task.schedule === null ? null : JSON.stringify(task.schedule),
    dependsOn: JSON.stringify(task.dependsOn),
    questions: JSON.stringify(task.questions),
    designOptions: JSON.stringify(task.designOptions),
    tests: JSON.stringify(task.tests),
    reviews: JSON.stringify(task.reviews),
    sourcePrompt: task.sourcePrompt,
    evaluatedAt: task.evaluatedAt,
    staleReason: task.staleReason,
    deletedAt: task.deletedAt,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    closedAt: task.closedAt,
  };
}

function rowToTask(row: TaskRow): Task {
  return {
    id: row.id,
    key: row.key,
    projectId: row.projectId,
    title: row.title,
    description: row.description,
    status: row.status as Task["status"],
    priority: row.priority as Task["priority"],
    size: row.size as Task["size"],
    kind: row.kind as Task["kind"],
    labels: JSON.parse(row.labels) as string[],
    assignee: row.assignee,
    parentId: row.parentId,
    order: row.order,
    fields: JSON.parse(row.fields) as Record<string, unknown>,
    model: row.model,
    effort: row.effort as Task["effort"],
    safety: row.safety === null ? null : JSON.parse(row.safety),
    childManualReview: row.childManualReview === null ? null : row.childManualReview === 1,
    schedule: row.schedule === null ? null : JSON.parse(row.schedule),
    dependsOn: JSON.parse(row.dependsOn) as string[],
    questions: JSON.parse(row.questions) as Task["questions"],
    designOptions: JSON.parse(row.designOptions) as Task["designOptions"],
    tests: JSON.parse(row.tests) as Task["tests"],
    reviews: JSON.parse(row.reviews) as Task["reviews"],
    sourcePrompt: row.sourcePrompt,
    evaluatedAt: row.evaluatedAt,
    staleReason: row.staleReason as Task["staleReason"],
    deletedAt: row.deletedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    closedAt: row.closedAt,
  };
}

function insertTask(task: Task): void {
  const row = taskToRow(task);
  const names = COLUMNS.map((c) => (c === '"order"' ? "order" : c));
  const placeholders = names.map((c) => `@${c === "order" ? "order" : c}`).join(", ");
  db.prepare(`INSERT INTO tasks (${COLUMNS.join(", ")}) VALUES (${placeholders})`).run(row);
}

function readTask(id: string): Task | null {
  const row = db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as TaskRow | undefined;
  return row ? rowToTask(row) : null;
}

/** A task with every field populated to a non-default value. */
function fullTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    key: "FEAT-1",
    projectId: "22222222-2222-2222-2222-222222222222",
    title: "Ship the tasks table",
    description: "# Notes\n\nEvery field round-trips.",
    status: "executing",
    priority: "urgent",
    size: "L",
    kind: "task",
    labels: ["backend", "db"],
    assignee: "eduardo",
    parentId: null,
    order: 3.5,
    fields: { layer: "backend", points: 5 },
    model: "claude-opus-5",
    effort: "high",
    safety: { denyList: ["*.env"], mode: "ask_listed", askList: ["git push"] },
    childManualReview: null,
    schedule: null,
    dependsOn: ["33333333-3333-3333-3333-333333333333"],
    questions: [{ id: "q1", text: "Which storage engine?" }],
    designOptions: [{ id: "d1", label: "Option A" }],
    tests: [{ id: "t1", status: "pass" }],
    reviews: [{ id: "r1", verdict: "approved" }],
    sourcePrompt: "Build the tasks table.",
    evaluatedAt: "2026-08-01T12:00:00.000Z",
    staleReason: "dependency",
    deletedAt: null,
    createdAt: "2026-08-01T10:00:00.000Z",
    updatedAt: "2026-08-01T10:00:00.000Z",
    closedAt: null,
    ...overrides,
  };
}

describe("the tasks migration", () => {
  it("creates the tasks table", () => {
    const row = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'tasks'")
      .get();

    expect(row).toEqual({ name: "tasks" });
  });

  it("is recorded as an applied migration", () => {
    const rows = db.prepare("SELECT name FROM migrations").all() as Array<{ name: string }>;
    expect(rows.map((r) => r.name)).toContain("003_create_tasks.sql");
  });

  it("enforces uniqueness of (projectId, key)", () => {
    seedProject("22222222-2222-2222-2222-222222222222");
    insertTask(fullTask());

    expect(() => insertTask(fullTask({ id: "44444444-4444-4444-4444-444444444444" }))).toThrow();
  });

  it("enforces the projectId foreign key", () => {
    expect(() => insertTask(fullTask())).toThrow();
  });
});

describe("insert and read round-trip", () => {
  beforeEach(() => {
    seedProject("22222222-2222-2222-2222-222222222222");
  });

  it("round-trips every field of a fully populated task", () => {
    const task = fullTask();
    insertTask(task);

    const read = readTask(task.id);

    expect(read).toEqual(task);
  });

  it("round-trips a task whose nullable fields are all null", () => {
    const task = fullTask({
      id: "55555555-5555-5555-5555-555555555555",
      key: "TASK-1",
      assignee: null,
      parentId: null,
      model: null,
      effort: null,
      safety: null,
      childManualReview: null,
      schedule: null,
      evaluatedAt: null,
      staleReason: null,
      deletedAt: null,
      closedAt: null,
    });
    insertTask(task);

    const read = readTask(task.id);

    expect(read).toEqual(task);
  });

  it("round-trips a soft-deleted (trashed) task", () => {
    const task = fullTask({
      id: "66666666-6666-6666-6666-666666666666",
      key: "TASK-2",
      deletedAt: "2026-08-02T00:00:00.000Z",
    });
    insertTask(task);

    const read = readTask(task.id);

    expect(read?.deletedAt).toBe("2026-08-02T00:00:00.000Z");
  });

  it("round-trips an epic with a boolean childManualReview", () => {
    const epic = fullTask({
      id: "77777777-7777-7777-7777-777777777777",
      key: "EPIC-1",
      size: "Epic",
      kind: "epic",
      childManualReview: true,
    });
    insertTask(epic);

    const read = readTask(epic.id);

    expect(read?.childManualReview).toBe(true);
  });

  it("allows a child task to reference its parent epic via parentId", () => {
    const epic = fullTask({
      id: "88888888-8888-8888-8888-888888888888",
      key: "EPIC-2",
      size: "Epic",
      kind: "epic",
    });
    insertTask(epic);

    const child = fullTask({
      id: "99999999-9999-9999-9999-999999999999",
      key: "TASK-3",
      parentId: epic.id,
    });
    insertTask(child);

    const read = readTask(child.id);

    expect(read?.parentId).toBe(epic.id);
  });
});

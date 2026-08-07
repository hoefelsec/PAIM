import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase } from "../../../src/server/db/index.js";
import { insertProject } from "../../../src/server/db/projects.js";
import {
  getTaskById,
  insertTask,
  listTrashedTasks,
  nextTimestamp,
  sweepTrash,
} from "../../../src/server/db/tasks.js";
import { defaultSettings } from "../../../src/server/projects/defaults.js";
import type { Project, Task } from "../../../src/shared/types.js";

describe("nextTimestamp", () => {
  it("uses the current time when it is past the previous write", () => {
    const before = new Date().toISOString();

    const stamp = nextTimestamp("2020-01-01T00:00:00.000Z");

    expect(stamp >= before).toBe(true);
  });

  it("never repeats the previous timestamp", () => {
    // Two writes inside the same millisecond would otherwise share a value,
    // and `If-Match: <updatedAt>` would accept a request built before both.
    const previous = new Date(Date.now() + 5_000).toISOString();

    const stamp = nextTimestamp(previous);

    expect(stamp > previous).toBe(true);
    expect(nextTimestamp(stamp) > stamp).toBe(true);
  });

  it("starts from the current time for a first write", () => {
    const before = new Date().toISOString();

    expect(nextTimestamp(null) >= before).toBe(true);
  });
});

describe("sweepTrash", () => {
  let dir: string;
  let db: Database.Database;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "paim-sweep-"));
    db = openDatabase(join(dir, "paim.db"));
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  function makeProject(overrides: Partial<Project> = {}): Project {
    const now = new Date().toISOString();
    const project: Project = {
      ...defaultSettings(),
      id: randomUUID(),
      slug: overrides.slug ?? `project-${randomUUID()}`,
      name: "P",
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
      ...overrides,
    };
    return insertProject(db, project);
  }

  function makeTask(project: Project, overrides: Partial<Task> = {}): Task {
    const now = new Date().toISOString();
    const task: Task = {
      id: randomUUID(),
      key: `TASK-${Math.floor(Math.random() * 1_000_000)}`,
      projectId: project.id,
      title: "T",
      description: "",
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
      sourcePrompt: "",
      evaluatedAt: null,
      staleReason: null,
      deletedAt: null,
      createdAt: now,
      updatedAt: now,
      closedAt: null,
      ...overrides,
    };
    return insertTask(db, task);
  }

  it("purges a trashed task once its project's retention has elapsed", () => {
    const project = makeProject({ trashRetentionDays: 30 });
    const task = makeTask(project, { deletedAt: "2020-01-01T00:00:00.000Z" });

    const purged = sweepTrash(db, "2020-02-01T00:00:00.000Z");

    expect(purged).toBe(1);
    expect(getTaskById(db, task.id, { includeTrashed: true })).toBeNull();
  });

  it("leaves a trashed task alone before its retention elapses", () => {
    const project = makeProject({ trashRetentionDays: 30 });
    const task = makeTask(project, { deletedAt: "2020-01-01T00:00:00.000Z" });

    const purged = sweepTrash(db, "2020-01-15T00:00:00.000Z");

    expect(purged).toBe(0);
    expect(getTaskById(db, task.id, { includeTrashed: true })).not.toBeNull();
  });

  it("never touches a task that is not in the trash", () => {
    const project = makeProject({ trashRetentionDays: 1 });
    const task = makeTask(project, { deletedAt: null });

    const purged = sweepTrash(db, "2999-01-01T00:00:00.000Z");

    expect(purged).toBe(0);
    expect(getTaskById(db, task.id)).not.toBeNull();
  });

  it("honors each project's own retentionDays", () => {
    const short = makeProject({ trashRetentionDays: 1 });
    const long = makeProject({ trashRetentionDays: 90 });
    const shortTask = makeTask(short, { deletedAt: "2020-01-01T00:00:00.000Z" });
    const longTask = makeTask(long, { deletedAt: "2020-01-01T00:00:00.000Z" });

    const purged = sweepTrash(db, "2020-01-10T00:00:00.000Z");

    expect(purged).toBe(1);
    expect(getTaskById(db, shortTask.id, { includeTrashed: true })).toBeNull();
    expect(getTaskById(db, longTask.id, { includeTrashed: true })).not.toBeNull();
  });

  it("detaches children before purging a trashed epic parent", () => {
    const project = makeProject({ trashRetentionDays: 1 });
    const epic = makeTask(project, {
      size: "Epic",
      kind: "epic",
      deletedAt: "2020-01-01T00:00:00.000Z",
    });
    const child = makeTask(project, { parentId: epic.id });

    expect(() => sweepTrash(db, "2020-02-01T00:00:00.000Z")).not.toThrow();

    expect(getTaskById(db, epic.id, { includeTrashed: true })).toBeNull();
    expect(getTaskById(db, child.id)?.parentId).toBeNull();
  });
});

describe("listTrashedTasks", () => {
  let dir: string;
  let db: Database.Database;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "paim-trash-list-"));
    db = openDatabase(join(dir, "paim.db"));
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("lists only the trashed tasks of the given project, newest deletion first", () => {
    const now = new Date().toISOString();
    const project: Project = insertProject(db, {
      ...defaultSettings(),
      id: randomUUID(),
      slug: "p",
      name: "P",
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
    });
    const other: Project = insertProject(db, {
      ...defaultSettings(),
      id: randomUUID(),
      slug: "q",
      name: "Q",
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
    });

    const base: Omit<Task, "id" | "projectId" | "key" | "deletedAt"> = {
      title: "T",
      description: "",
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
      sourcePrompt: "",
      evaluatedAt: null,
      staleReason: null,
      createdAt: now,
      updatedAt: now,
      closedAt: null,
    };

    const active = insertTask(db, {
      ...base,
      id: randomUUID(),
      key: "TASK-1",
      projectId: project.id,
      deletedAt: null,
    });
    const trashedOld = insertTask(db, {
      ...base,
      id: randomUUID(),
      key: "TASK-2",
      projectId: project.id,
      deletedAt: "2020-01-01T00:00:00.000Z",
    });
    const trashedNew = insertTask(db, {
      ...base,
      id: randomUUID(),
      key: "TASK-3",
      projectId: project.id,
      deletedAt: "2020-06-01T00:00:00.000Z",
    });
    insertTask(db, {
      ...base,
      id: randomUUID(),
      key: "TASK-1",
      projectId: other.id,
      deletedAt: "2020-01-01T00:00:00.000Z",
    });

    const trashed = listTrashedTasks(db, project.id);

    expect(trashed.map((t) => t.id)).toEqual([trashedNew.id, trashedOld.id]);
    expect(trashed.every((t) => t.id !== active.id)).toBe(true);
  });
});

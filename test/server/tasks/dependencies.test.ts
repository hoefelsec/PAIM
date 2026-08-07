/**
 * T30 — `dependsOn` validation (specs/05-dependencies-and-reevaluation.md,
 * docs/05-dependencies.md).
 *
 * Low-level accuracy tests for `validateDependsOn` and `unmetDependencies`
 * against a real database. The HTTP-facing rejection (422 on a write that
 * closes a cycle) is covered in test/server/routes/tasks.test.ts.
 */
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase } from "../../../src/server/db/index.js";
import { insertProject } from "../../../src/server/db/projects.js";
import { insertTask, updateTask } from "../../../src/server/db/tasks.js";
import { defaultSettings } from "../../../src/server/projects/defaults.js";
import { ApiError } from "../../../src/server/errors.js";
import { unmetDependencies, validateDependsOn } from "../../../src/server/tasks/dependencies.js";
import type { Project, Task } from "../../../src/shared/types.js";

let dir: string;
let db: Database.Database;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "paim-deps-"));
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
    failureReason: null,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
    closedAt: null,
    ...overrides,
  };
  return insertTask(db, task);
}

describe("validateDependsOn", () => {
  it("accepts dependencies inside the same project", () => {
    const project = makeProject();
    const other = makeTask(project);

    expect(() =>
      validateDependsOn(
        db,
        { taskId: randomUUID(), projectId: project.id },
        [other.id],
      ),
    ).not.toThrow();
  });

  it("rejects a dependency from another project (422 DEPENDENCY_CROSS_PROJECT)", () => {
    const project = makeProject();
    const otherProject = makeProject();
    const foreign = makeTask(otherProject);

    try {
      validateDependsOn(db, { taskId: randomUUID(), projectId: project.id }, [foreign.id]);
      throw new Error("expected validateDependsOn to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).code).toBe("DEPENDENCY_CROSS_PROJECT");
      expect((err as ApiError).status).toBe(422);
    }
  });

  it("rejects a dependency that names no task at all (422 DEPENDENCY_NOT_FOUND)", () => {
    const project = makeProject();

    try {
      validateDependsOn(db, { taskId: randomUUID(), projectId: project.id }, [randomUUID()]);
      throw new Error("expected validateDependsOn to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).code).toBe("DEPENDENCY_NOT_FOUND");
    }
  });

  it("does not re-check an id the task already carried (unresolvable but unchanged)", () => {
    const project = makeProject();
    const staleId = randomUUID();

    expect(() =>
      validateDependsOn(
        db,
        { taskId: randomUUID(), projectId: project.id },
        [staleId],
        [staleId],
      ),
    ).not.toThrow();
  });

  it("rejects a self-reference (422 DEPENDENCY_CYCLE)", () => {
    const project = makeProject();
    const task = makeTask(project);

    try {
      validateDependsOn(db, { taskId: task.id, projectId: project.id }, [task.id]);
      throw new Error("expected validateDependsOn to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).code).toBe("DEPENDENCY_CYCLE");
      expect((err as ApiError).status).toBe(422);
    }
  });

  it("rejects a write that closes a cycle across several tasks (422 DEPENDENCY_CYCLE)", () => {
    const project = makeProject();
    // A -> B -> C, all stored already.
    const a = makeTask(project);
    const b = makeTask(project, { dependsOn: [a.id] });
    const c = makeTask(project, { dependsOn: [b.id] });

    // Closing write: C -> A would make A -> B -> C -> A a cycle.
    try {
      validateDependsOn(db, { taskId: a.id, projectId: project.id }, [c.id]);
      throw new Error("expected validateDependsOn to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).code).toBe("DEPENDENCY_CYCLE");
    }
  });

  it("accepts a longer acyclic chain", () => {
    const project = makeProject();
    const a = makeTask(project);
    const b = makeTask(project, { dependsOn: [a.id] });
    const c = makeTask(project);

    expect(() =>
      validateDependsOn(db, { taskId: c.id, projectId: project.id }, [b.id]),
    ).not.toThrow();
  });
});

describe("unmetDependencies", () => {
  it("returns dependencies that have not reached done", () => {
    const project = makeProject();
    const blocker = makeTask(project, { status: project.statuses[0]! });
    const done = makeTask(project, { status: "done" });
    const task = makeTask(project, { dependsOn: [blocker.id, done.id] });

    const unmet = unmetDependencies(db, task);

    expect(unmet.map((t) => t.id)).toEqual([blocker.id]);
  });

  it("returns an empty list once every dependency is done", () => {
    const project = makeProject();
    const done = makeTask(project, { status: "done" });
    const task = makeTask(project, { dependsOn: [done.id] });

    expect(unmetDependencies(db, task)).toEqual([]);
  });

  it("returns an empty list for a task with no dependencies", () => {
    const project = makeProject();
    const task = makeTask(project);

    expect(unmetDependencies(db, task)).toEqual([]);
  });

  it("ignores a dependsOn entry that no longer resolves to a task", () => {
    const project = makeProject();
    const task = makeTask(project, { dependsOn: [randomUUID()] });

    expect(unmetDependencies(db, task)).toEqual([]);
  });

  it("counts a dependency reached done after this task's own write", () => {
    const project = makeProject();
    const blocker = makeTask(project, { status: project.statuses[0]! });
    const task = makeTask(project, { dependsOn: [blocker.id] });

    expect(unmetDependencies(db, task).map((t) => t.id)).toEqual([blocker.id]);

    updateTask(db, { ...blocker, status: "done" });

    expect(unmetDependencies(db, task)).toEqual([]);
  });
});

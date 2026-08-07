import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase } from "../../../src/server/db/index.js";
import {
  deleteProject,
  deleteProjectTasks,
  insertProject,
} from "../../../src/server/db/projects.js";
import { hardDeleteTask, insertTask } from "../../../src/server/db/tasks.js";
import {
  getOperationById,
  getRunById,
  insertOperation,
  insertRun,
  listChildRuns,
  listOperations,
  listRunsForProject,
  listRunsForTask,
  updateOperation,
  updateRun,
} from "../../../src/server/db/runs.js";
import { defaultSettings } from "../../../src/server/projects/defaults.js";
import type { Operation, OperationDraft, Run } from "../../../src/shared/runs.js";
import type { Project, Task } from "../../../src/shared/types.js";

let dir: string;
let db: Database.Database;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "paim-runs-db-"));
  db = openDatabase(join(dir, "paim.db"));
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

function makeProject(overrides: Partial<Project> = {}): Project {
  const now = new Date().toISOString();
  return insertProject(db, {
    ...defaultSettings(),
    id: randomUUID(),
    slug: `project-${randomUUID()}`,
    name: "P",
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    ...overrides,
  });
}

function makeTask(project: Project, overrides: Partial<Task> = {}): Task {
  const now = new Date().toISOString();
  return insertTask(db, {
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
  });
}

function makeRun(task: Task, overrides: Partial<Run> = {}): Run {
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

function draftOperation(run: Run, overrides: Partial<OperationDraft> = {}): OperationDraft {
  const now = new Date().toISOString();
  return {
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
  };
}

describe("runs round-trip", () => {
  it("reads back every field of a run", () => {
    const project = makeProject();
    const task = makeTask(project);
    const run = makeRun(task, {
      kind: "orchestrated",
      trigger: "schedule",
      status: "awaiting_approval",
      usage: { inputTokens: 12_345, outputTokens: 678, costUsd: 0.4231 },
      failureReason: null,
      createdAt: "2026-01-01T10:00:00.000Z",
      startedAt: "2026-01-01T10:00:01.000Z",
      endedAt: null,
    });

    expect(getRunById(db, run.id)).toEqual(run);
  });

  it("round-trips a git restore point", () => {
    const task = makeTask(makeProject());
    const run = makeRun(task, {
      restorePoint: {
        method: "git",
        available: true,
        reason: null,
        head: "9f1c0a3",
        stash: "b21ee40",
        snapshotDir: null,
        createdPaths: [],
        capturedAt: "2026-01-01T10:00:02.000Z",
      },
    });

    expect(getRunById(db, run.id)?.restorePoint).toEqual(run.restorePoint);
  });

  it("round-trips a snapshot restore point with created paths", () => {
    const task = makeTask(makeProject());
    const run = makeRun(task, {
      restorePoint: {
        method: "snapshot",
        available: true,
        reason: null,
        head: null,
        stash: null,
        snapshotDir: "data/restore/abc",
        createdPaths: ["src/new.ts", "docs/new.md"],
        capturedAt: "2026-01-01T10:00:02.000Z",
      },
    });

    expect(getRunById(db, run.id)?.restorePoint).toEqual(run.restorePoint);
  });

  it("round-trips a failed capture: unavailable with its reason (docs/09)", () => {
    const task = makeTask(makeProject());
    const run = makeRun(task, {
      restorePoint: {
        method: "snapshot",
        available: false,
        reason: "A file in the workspace is too large to snapshot",
        head: null,
        stash: null,
        snapshotDir: null,
        createdPaths: [],
        capturedAt: null,
      },
    });

    const stored = getRunById(db, run.id);
    expect(stored?.restorePoint?.available).toBe(false);
    expect(stored?.restorePoint?.reason).toMatch(/too large/);
  });

  it("has no restore point before a run captures one", () => {
    const run = makeRun(makeTask(makeProject()));
    expect(getRunById(db, run.id)?.restorePoint).toBeNull();
  });

  it("updates status, usage, failure reason and timestamps", () => {
    const run = makeRun(makeTask(makeProject()));

    const next: Run = {
      ...run,
      status: "failed",
      failureReason: "service_stopped",
      usage: { inputTokens: 10, outputTokens: 20, costUsd: 0.05 },
      startedAt: "2026-01-01T10:00:00.000Z",
      endedAt: "2026-01-01T10:05:00.000Z",
    };
    updateRun(db, next);

    expect(getRunById(db, run.id)).toEqual(next);
  });

  it("returns null for a run that does not exist", () => {
    expect(getRunById(db, randomUUID())).toBeNull();
  });

  it("lists the runs of one task newest first, and only that task's", () => {
    const project = makeProject();
    const task = makeTask(project);
    const other = makeTask(project);
    const first = makeRun(task, { createdAt: "2026-01-01T10:00:00.000Z" });
    const second = makeRun(task, { createdAt: "2026-01-02T10:00:00.000Z" });
    makeRun(other, { createdAt: "2026-01-03T10:00:00.000Z" });

    expect(listRunsForTask(db, task.id).map((run) => run.id)).toEqual([second.id, first.id]);
  });

  it("lists the runs of a project across its tasks", () => {
    const project = makeProject();
    const otherProject = makeProject();
    const a = makeRun(makeTask(project), { createdAt: "2026-01-01T10:00:00.000Z" });
    const b = makeRun(makeTask(project), { createdAt: "2026-01-02T10:00:00.000Z" });
    makeRun(makeTask(otherProject));

    expect(listRunsForProject(db, project.id).map((run) => run.id)).toEqual([b.id, a.id]);
  });

  it("links the children of an orchestrated run to their parent", () => {
    const project = makeProject();
    const epicTask = makeTask(project, { size: "Epic", kind: "epic" });
    const parent = makeRun(epicTask, { kind: "orchestrated" });
    const child = makeRun(makeTask(project, { parentId: epicTask.id }), {
      parentRunId: parent.id,
      trigger: "orchestrator",
      createdAt: "2026-01-01T10:00:00.000Z",
    });

    expect(listChildRuns(db, parent.id).map((run) => run.id)).toEqual([child.id]);
    expect(getRunById(db, child.id)?.parentRunId).toBe(parent.id);
  });

  it("goes away with the task it belongs to", () => {
    const project = makeProject();
    const task = makeTask(project);
    const run = makeRun(task);
    insertOperation(db, draftOperation(run));

    hardDeleteTask(db, task.id);

    expect(getRunById(db, run.id)).toBeNull();
    expect(listOperations(db, run.id)).toEqual([]);
  });

  it("goes away with the project it belongs to", () => {
    const project = makeProject();
    const run = makeRun(makeTask(project));

    // `DELETE /api/projects/:project?force=true` purges the tasks and then
    // the project; a run row must hold neither statement back.
    deleteProjectTasks(db, project.id);
    deleteProject(db, project.id);

    expect(getRunById(db, run.id)).toBeNull();
  });
});

describe("operations round-trip", () => {
  it("reads back every field of an operation", () => {
    const run = makeRun(makeTask(makeProject()));
    const written = insertOperation(
      db,
      draftOperation(run, {
        kind: "edit",
        summary: "Edit src/api/tasks.ts",
        status: "done",
        diff: "@@ -1 +1 @@\n-a\n+b\n",
      }),
    );

    expect(getOperationById(db, written.id)).toEqual(written);
    expect(written.risk).toBe("write");
  });

  it("stores bash output and exit code", () => {
    const run = makeRun(makeTask(makeProject()));
    const written = insertOperation(
      db,
      draftOperation(run, {
        kind: "bash",
        summary: "npm test",
        status: "failed",
        stdout: "1 test failed\n",
        exitCode: 1,
      }),
    );

    const stored = getOperationById(db, written.id);
    expect(stored?.stdout).toBe("1 test failed\n");
    expect(stored?.exitCode).toBe(1);
    expect(stored?.risk).toBe("exec");
  });

  it("assigns the log position, so the order survives equal timestamps", () => {
    const run = makeRun(makeTask(makeProject()));
    const at = "2026-01-01T10:00:00.000Z";
    const first = insertOperation(db, draftOperation(run, { createdAt: at, updatedAt: at }));
    const second = insertOperation(
      db,
      draftOperation(run, { kind: "grep", createdAt: at, updatedAt: at }),
    );
    const third = insertOperation(
      db,
      draftOperation(run, { kind: "bash", createdAt: at, updatedAt: at }),
    );

    expect([first.seq, second.seq, third.seq]).toEqual([1, 2, 3]);
    expect(listOperations(db, run.id).map((op) => op.id)).toEqual([
      first.id,
      second.id,
      third.id,
    ]);
  });

  it("numbers each run's log from one", () => {
    const task = makeTask(makeProject());
    const runA = makeRun(task);
    const runB = makeRun(task);

    insertOperation(db, draftOperation(runA));
    const onB = insertOperation(db, draftOperation(runB));

    expect(onB.seq).toBe(1);
    expect(listOperations(db, runB.id)).toHaveLength(1);
  });

  it("moves an operation through its lifecycle without changing its position", () => {
    const run = makeRun(makeTask(makeProject()));
    const proposed = insertOperation(
      db,
      draftOperation(run, { kind: "bash", summary: "rm -rf build", status: "proposed" }),
    );

    const denied: Operation = {
      ...proposed,
      status: "denied",
      updatedAt: "2026-01-01T10:00:05.000Z",
    };
    updateOperation(db, denied);

    const stored = getOperationById(db, proposed.id);
    expect(stored?.status).toBe("denied");
    expect(stored?.seq).toBe(proposed.seq);
    expect(stored?.runId).toBe(run.id);
  });

  it("derives the risk from the kind rather than storing it", () => {
    const run = makeRun(makeTask(makeProject()));
    const written = insertOperation(db, draftOperation(run, { kind: "read" }));
    expect(written.risk).toBe("safe");

    // The column does not exist: a row cannot carry a risk that disagrees
    // with its kind, and changing the kind changes the risk with it.
    const columns = db.prepare("PRAGMA table_info(operations)").all() as { name: string }[];
    expect(columns.map((c) => c.name)).not.toContain("risk");

    updateOperation(db, { ...written, kind: "bash", risk: "safe" });
    expect(getOperationById(db, written.id)?.risk).toBe("exec");
  });

  it("returns null for an operation that does not exist", () => {
    expect(getOperationById(db, randomUUID())).toBeNull();
  });
});

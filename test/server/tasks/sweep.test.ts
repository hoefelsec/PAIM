import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openDatabase } from "../../../src/server/db/index.js";
import { insertProject } from "../../../src/server/db/projects.js";
import { getTaskById, insertTask } from "../../../src/server/db/tasks.js";
import { defaultSettings } from "../../../src/server/projects/defaults.js";
import { startTrashSweep, TRASH_SWEEP_INTERVAL_MS } from "../../../src/server/tasks/sweep.js";
import type { Project, Task } from "../../../src/shared/types.js";

let dir: string;
let db: Database.Database;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "paim-sweep-schedule-"));
  db = openDatabase(join(dir, "paim.db"));
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

function makeProject(trashRetentionDays: number): Project {
  const now = new Date().toISOString();
  return insertProject(db, {
    ...defaultSettings(),
    id: randomUUID(),
    slug: `project-${randomUUID()}`,
    name: "P",
    trashRetentionDays,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
  });
}

function makeTrashedTask(project: Project, deletedAt: string): Task {
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
    deletedAt,
    createdAt: now,
    updatedAt: now,
    closedAt: null,
  });
}

describe("startTrashSweep", () => {
  it("sweeps once immediately on startup", () => {
    const project = makeProject(1);
    // The clock's `now` at startup is far enough past the deletion for the
    // 1-day retention to have elapsed.
    vi.setSystemTime(new Date("2020-02-01T00:00:00.000Z"));
    const task = makeTrashedTask(project, "2020-01-01T00:00:00.000Z");

    const handle = startTrashSweep(db);

    expect(getTaskById(db, task.id, { includeTrashed: true })).toBeNull();
    handle.stop();
  });

  it("sweeps again every 24 hours without a restart", () => {
    vi.setSystemTime(new Date("2020-01-01T00:00:00.000Z"));
    const project = makeProject(1);
    const handle = startTrashSweep(db);

    // Deleted after startup, retention (1 day) not yet elapsed.
    const task = makeTrashedTask(project, "2020-01-01T00:00:00.000Z");
    expect(getTaskById(db, task.id, { includeTrashed: true })).not.toBeNull();

    // Advance the clock and the timer together past the retention window and
    // past the next scheduled sweep.
    vi.setSystemTime(new Date(Date.now() + 2 * 24 * 60 * 60 * 1000));
    vi.advanceTimersByTime(TRASH_SWEEP_INTERVAL_MS);

    expect(getTaskById(db, task.id, { includeTrashed: true })).toBeNull();
    handle.stop();
  });

  it("stop() cancels the recurring sweep", () => {
    vi.setSystemTime(new Date("2020-01-01T00:00:00.000Z"));
    const project = makeProject(1);
    const handle = startTrashSweep(db);
    handle.stop();

    const task = makeTrashedTask(project, "2020-01-01T00:00:00.000Z");
    vi.setSystemTime(new Date(Date.now() + 2 * 24 * 60 * 60 * 1000));
    vi.advanceTimersByTime(TRASH_SWEEP_INTERVAL_MS * 2);

    // No sweep ran after stop(), so the task is still there.
    expect(getTaskById(db, task.id, { includeTrashed: true })).not.toBeNull();
  });
});

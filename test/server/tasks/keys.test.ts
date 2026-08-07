import { execFile } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase } from "../../../src/server/db/index.js";
import { nextTaskKey, prefixForType } from "../../../src/server/tasks/keys.js";
import type { Task } from "../../../src/shared/types.js";

const execFileAsync = promisify(execFile);
const TSX_BIN = fileURLToPath(new URL("../../../node_modules/.bin/tsx", import.meta.url));
const CHILD_SCRIPT = fileURLToPath(
  new URL("./fixtures/allocate-keys-child.mts", import.meta.url),
);

let dir: string;
let dbPath: string;
let db: Database.Database;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "paim-task-keys-"));
  dbPath = join(dir, "paim.db");
  db = openDatabase(dbPath);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

/** Creates a project row directly, so the tasks/task_counters FKs have something to point at. */
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
    modelRouting: JSON.stringify({
      field: null,
      map: {},
      fallback: { model: "claude-opus-5", effort: "high" },
    }),
    allowedModels: "[]",
    usageCaps: JSON.stringify({ fiveHour: null, weekly: null, fable: null }),
    maxConcurrentRuns: 1,
    trashRetentionDays: 30,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
  });
}

/** Minimal task row insert — only the columns these tests care about. */
function insertMinimalTask(overrides: Partial<Task> & Pick<Task, "id" | "key" | "projectId">): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO tasks (
       id, key, projectId, title, description, status, priority, size, kind,
       labels, fields, dependsOn, questions, designOptions, tests, reviews,
       sourcePrompt, createdAt, updatedAt
     ) VALUES (
       @id, @key, @projectId, @title, @description, @status, @priority, @size, @kind,
       @labels, @fields, @dependsOn, @questions, @designOptions, @tests, @reviews,
       @sourcePrompt, @createdAt, @updatedAt
     )`,
  ).run({
    id: overrides.id,
    key: overrides.key,
    projectId: overrides.projectId,
    title: overrides.title ?? "A task",
    description: overrides.description ?? "",
    status: overrides.status ?? "backlog",
    priority: overrides.priority ?? "none",
    size: overrides.size ?? "M",
    kind: overrides.kind ?? "task",
    labels: JSON.stringify(overrides.labels ?? []),
    fields: JSON.stringify(overrides.fields ?? {}),
    dependsOn: JSON.stringify(overrides.dependsOn ?? []),
    questions: JSON.stringify(overrides.questions ?? []),
    designOptions: JSON.stringify(overrides.designOptions ?? []),
    tests: JSON.stringify(overrides.tests ?? []),
    reviews: JSON.stringify(overrides.reviews ?? []),
    sourcePrompt: overrides.sourcePrompt ?? "",
    createdAt: now,
    updatedAt: now,
  });
}

describe("prefixForType", () => {
  it("maps every T09 pool option to its prefix", () => {
    expect(prefixForType("feature")).toBe("FEAT");
    expect(prefixForType("bug")).toBe("BUG");
    expect(prefixForType("chore")).toBe("CHORE");
    expect(prefixForType("spike")).toBe("SPIKE");
    expect(prefixForType("debt")).toBe("DEBT");
  });

  it("falls back to TASK when there is no type value", () => {
    expect(prefixForType(undefined)).toBe("TASK");
    expect(prefixForType(null)).toBe("TASK");
  });

  it("falls back to TASK for a value outside the pool", () => {
    expect(prefixForType("not_a_real_type")).toBe("TASK");
  });
});

describe("nextTaskKey", () => {
  const projectId = randomUUID();

  beforeEach(() => {
    seedProject(projectId);
  });

  it("produces FEAT-n for a feature", () => {
    expect(nextTaskKey(db, projectId, "feature")).toBe("FEAT-1");
  });

  it("produces BUG-n for a bug", () => {
    expect(nextTaskKey(db, projectId, "bug")).toBe("BUG-1");
  });

  it("produces CHORE-n for a chore", () => {
    expect(nextTaskKey(db, projectId, "chore")).toBe("CHORE-1");
  });

  it("produces SPIKE-n for a spike", () => {
    expect(nextTaskKey(db, projectId, "spike")).toBe("SPIKE-1");
  });

  it("produces DEBT-n for debt", () => {
    expect(nextTaskKey(db, projectId, "debt")).toBe("DEBT-1");
  });

  it("falls back to TASK-n when there is no type", () => {
    expect(nextTaskKey(db, projectId, undefined)).toBe("TASK-1");
  });

  it("uses one counter for the whole project — keys never collide across prefixes", () => {
    expect(nextTaskKey(db, projectId, "feature")).toBe("FEAT-1");
    expect(nextTaskKey(db, projectId, "bug")).toBe("BUG-2");
    expect(nextTaskKey(db, projectId, undefined)).toBe("TASK-3");
    expect(nextTaskKey(db, projectId, "feature")).toBe("FEAT-4");
  });

  it("keeps independent counters per project", () => {
    const otherProjectId = randomUUID();
    seedProject(otherProjectId);

    expect(nextTaskKey(db, projectId, "feature")).toBe("FEAT-1");
    expect(nextTaskKey(db, otherProjectId, "feature")).toBe("FEAT-1");
    expect(nextTaskKey(db, projectId, "bug")).toBe("BUG-2");
    expect(nextTaskKey(db, otherProjectId, "bug")).toBe("BUG-2");
  });

  it("rolls back the counter increment when the task insert in the same transaction fails", () => {
    expect(nextTaskKey(db, projectId, "feature")).toBe("FEAT-1");

    const id = randomUUID();
    const attempt = db.transaction(() => {
      const key = nextTaskKey(db, projectId, "bug");
      insertMinimalTask({ id, key, projectId: "not-a-real-project-id" });
    });

    expect(() => attempt()).toThrow();
    // The counter increment from the failed attempt did not stick.
    expect(nextTaskKey(db, projectId, "bug")).toBe("BUG-2");
  });

  it("is permanent: `nextTaskKey` is never invoked again once a task exists", () => {
    // The permanence guarantee (docs/02 "Task keys") is that key generation
    // only ever runs once, at creation — nothing in the update path calls
    // `nextTaskKey` again, and there is no trigger or generated column on
    // `tasks.key` that could recompute it from `type`/`fields` on write.
    // Asserting the `key` column happens to equal what we wrote earlier
    // (without also touching it) is self-fulfilling and would pass against
    // any implementation, so instead assert the mechanism that would make a
    // rename possible does not exist:
    const triggers = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'tasks'")
      .all() as Array<{ name: string }>;
    expect(triggers).toEqual([]);

    const tableSql = db
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'tasks'")
      .get() as { sql: string };
    // A generated column would read `... AS (...) ...` on the `key`
    // definition; plain columns don't.
    expect(tableSql.sql).not.toMatch(/\bkey\b[^,]*\bGENERATED\b/i);
    expect(tableSql.sql).not.toMatch(/\bkey\b[^,]*\bAS\s*\(/i);

    // The real permanence assertion — that an update endpoint which changes
    // `type` leaves an existing task's `key` untouched — needs an actual
    // update path, which doesn't exist until T12; that test belongs there.
  });

  it(
    "hands out no duplicate keys under real cross-connection concurrency",
    async () => {
      // `Promise.all` over synchronous better-sqlite3 work on one connection
      // is strictly sequential and can never exercise cross-connection
      // interleaving at all — it only proves a loop yields distinct keys.
      // This drives half the calls from a second, real OS process with its
      // own connection to the same file, running concurrently with this
      // process's own calls, both calling `nextTaskKey` unwrapped (no
      // `db.transaction()` around it) — the exact shape of the reviewer's
      // repro of the old UPSERT-then-SELECT race.
      //
      // Note on what this test actually proves: `nextTaskKey` now performs
      // the increment and the read as one statement
      // (`INSERT ... ON CONFLICT ... RETURNING`), so correctness no longer
      // depends on winning a timing window — a single statement is atomic
      // with respect to another connection's writes regardless of
      // scheduling. This test exercises that real concurrent access does
      // not corrupt the count in practice; it is not a timing-sensitive
      // race reproduction, and passing it does not by itself prove
      // atomicity — the atomicity guarantee comes from the single
      // `RETURNING` statement in the implementation, which this test relies
      // on rather than re-demonstrates.
      const perSide = 25;
      const childPromise = execFileAsync(
        TSX_BIN,
        [CHILD_SCRIPT, dbPath, projectId, String(perSide)],
        { maxBuffer: 10 * 1024 * 1024 },
      );

      const types = ["feature", "bug", "chore", "spike", "debt", undefined];
      const ownKeys: string[] = [];
      for (let i = 0; i < perSide; i++) {
        const type = types[i % types.length];
        // Deliberately unwrapped — no `db.transaction()` around this call —
        // to exercise `nextTaskKey`'s own atomicity, not the caller's.
        ownKeys.push(nextTaskKey(db, projectId, type));
      }

      const { stdout } = await childPromise;
      const childKeys = JSON.parse(stdout) as string[];

      expect(childKeys).toHaveLength(perSide);
      const allKeys = [...ownKeys, ...childKeys];
      expect(allKeys).toHaveLength(perSide * 2);
      expect(new Set(allKeys).size).toBe(perSide * 2);
    },
    20_000,
  );
});

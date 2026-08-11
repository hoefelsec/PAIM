/**
 * Restore points and Restore (T57; docs/09-ai-run.md "Restore").
 *
 * The Done line of T57 is "byte-identical restore in both modes (temp git
 * repo and plain dir); capture-failure path; post-done unavailability" — the
 * first two live here, over the capture recorder and the revert itself; the
 * third is an endpoint rule and lives in
 * test/server/routes/runs-restore.test.ts.
 *
 * Nothing here reaches the Agent SDK: the runner section drives a scripted
 * agent whose steps perform the writes the model would have performed, so a
 * real file really changes and the revert really has to put it back.
 */

import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase } from "../../../src/server/db/index.js";
import { insertProject } from "../../../src/server/db/projects.js";
import { insertRun, listOperations } from "../../../src/server/db/runs.js";
import { insertTask } from "../../../src/server/db/tasks.js";
import { ApiError } from "../../../src/server/errors.js";
import { defaultSettings } from "../../../src/server/projects/defaults.js";
import { createApprovalRegistry } from "../../../src/server/runs/approvals.js";
import { createFakeAgent, type FakeToolStep } from "../../../src/server/runs/fakeAgent.js";
import {
  createRestoreRecorder,
  gitWorkspaceRoot,
  restoreWorkspace,
} from "../../../src/server/runs/restore.js";
import { executeRun } from "../../../src/server/runs/runner.js";
import type { Run } from "../../../src/shared/runs.js";
import type { Project, SafetyPolicy, Task } from "../../../src/shared/types.js";

let dir: string;
let workspace: string;
/** `data/restore` for the test: never the repository's own `data/`. */
let restoreRoot: string;
let db: Database.Database;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "paim-restore-"));
  workspace = mkdtempSync(join(tmpdir(), "paim-workspace-"));
  restoreRoot = join(dir, "restore");
  db = openDatabase(join(dir, "paim.db"));
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
  rmSync(workspace, { recursive: true, force: true });
});

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

/**
 * A repository with one commit. The identity and the two switches are set
 * locally so the suite does not depend on — or trip over — whatever the
 * machine's global git configuration says.
 */
function initRepo(root: string): void {
  git(root, "init", "-q");
  git(root, "config", "user.email", "test@example.com");
  git(root, "config", "user.name", "Test");
  git(root, "config", "commit.gpgsign", "false");
  git(root, "config", "core.hooksPath", join(root, ".git", "no-hooks"));
}

function write(relativePath: string, content: string | Buffer): string {
  const absolute = join(workspace, relativePath);
  mkdirSync(join(absolute, ".."), { recursive: true });
  writeFileSync(absolute, content);
  return absolute;
}

function read(relativePath: string): Buffer {
  return readFileSync(join(workspace, relativePath));
}

function recorder(options: { runId?: string; maxFileBytes?: number } = {}) {
  return createRestoreRecorder({
    runId: options.runId ?? randomUUID(),
    workspacePath: workspace,
    restoreRoot,
    ...(options.maxFileBytes === undefined ? {} : { maxFileBytes: options.maxFileBytes }),
  });
}

/** Bytes no text encoding round-trips, so "byte-identical" means it. */
const BINARY = Buffer.from([0x00, 0xff, 0x10, 0x80, 0x0a, 0xfe, 0x7f]);

// ---------------------------------------------------------------------------
// Snapshot mode — a plain directory
// ---------------------------------------------------------------------------

describe("restore point: file snapshots (a plain directory)", () => {
  it("returns changed files byte-identical and deletes the files the run created", () => {
    const original = "line one\nline two\n";
    write("src/keep.ts", original);
    write("assets/logo.bin", BINARY);

    const capture = recorder();

    // Each write is announced the moment before it happens, which is the
    // last moment the file still holds what the run found.
    capture.beforeWrite(join(workspace, "src/keep.ts"));
    write("src/keep.ts", "rewritten by the agent\n");
    capture.beforeWrite(join(workspace, "assets/logo.bin"));
    write("assets/logo.bin", Buffer.from([0x01, 0x02]));
    capture.beforeWrite(join(workspace, "src/new/module.ts"));
    write("src/new/module.ts", "export const added = true;\n");

    const point = capture.point()!;
    expect(point.method).toBe("snapshot");
    expect(point.available).toBe(true);
    expect(point.reason).toBeNull();
    expect(point.createdPaths).toEqual([join("src", "new", "module.ts")]);
    expect(point.snapshotDir?.startsWith(restoreRoot)).toBe(true);

    const result = restoreWorkspace(point, workspace);

    expect(result.method).toBe("snapshot");
    expect(read("src/keep.ts").toString()).toBe(original);
    expect(read("assets/logo.bin").equals(BINARY)).toBe(true);
    expect(existsSync(join(workspace, "src/new/module.ts"))).toBe(false);
    expect(result.deleted).toEqual([join("src", "new", "module.ts")]);
    expect(result.restored.sort()).toEqual(
      [join("assets", "logo.bin"), join("src", "keep.ts")].sort(),
    );
  });

  it("keeps the first bytes it saw, however often the run rewrites a file", () => {
    write("notes.md", "first\n");
    const capture = recorder();

    capture.beforeWrite(join(workspace, "notes.md"));
    write("notes.md", "second\n");
    capture.beforeWrite(join(workspace, "notes.md"));
    write("notes.md", "third\n");

    restoreWorkspace(capture.point()!, workspace);

    expect(read("notes.md").toString()).toBe("first\n");
  });

  it("restores twice to the same state", () => {
    write("a.txt", "original\n");
    const capture = recorder();
    capture.beforeWrite(join(workspace, "a.txt"));
    write("a.txt", "changed\n");

    const point = capture.point()!;
    restoreWorkspace(point, workspace);
    write("a.txt", "changed again\n");
    restoreWorkspace(point, workspace);

    expect(read("a.txt").toString()).toBe("original\n");
  });

  it("captures nothing for a run that writes nothing", () => {
    expect(recorder().point()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Git mode — a repository
// ---------------------------------------------------------------------------

describe("restore point: git (a repository)", () => {
  it("returns HEAD, the stash and the created files, byte-identical", () => {
    initRepo(workspace);
    write("src/tracked.ts", "committed\n");
    write("assets/logo.bin", BINARY);
    git(workspace, "add", "-A");
    git(workspace, "commit", "-q", "-m", "first");
    const head = git(workspace, "rev-parse", "HEAD");

    // Uncommitted work the user had in flight when the run started. Only
    // the stash brings this back.
    write("src/tracked.ts", "committed\nplus my own edit\n");

    const capture = recorder();
    capture.beforeWrite(join(workspace, "src/tracked.ts"));
    write("src/tracked.ts", "rewritten by the agent\n");
    capture.beforeWrite(join(workspace, "assets/logo.bin"));
    write("assets/logo.bin", Buffer.from([0x09]));
    capture.beforeWrite(join(workspace, "src/created.ts"));
    write("src/created.ts", "export const added = true;\n");

    const point = capture.point()!;
    expect(point.method).toBe("git");
    expect(point.head).toBe(head);
    expect(point.stash).not.toBeNull();
    expect(point.createdPaths).toEqual([join("src", "created.ts")]);
    // The capture left the working tree alone: the agent's own edit is
    // still the file on disk.
    expect(read("src/tracked.ts").toString()).toBe("rewritten by the agent\n");

    restoreWorkspace(point, workspace);

    expect(read("src/tracked.ts").toString()).toBe("committed\nplus my own edit\n");
    expect(read("assets/logo.bin").equals(BINARY)).toBe(true);
    expect(existsSync(join(workspace, "src/created.ts"))).toBe(false);
    expect(git(workspace, "rev-parse", "HEAD")).toBe(head);
  });

  it("undoes the automatic commits the run made", () => {
    // docs/09 "What Restore reverts": staged changes and automatic commits
    // from this run. The commit here stands in for T58's autoCommit.
    initRepo(workspace);
    write("app.ts", "v1\n");
    git(workspace, "add", "-A");
    git(workspace, "commit", "-q", "-m", "first");
    const head = git(workspace, "rev-parse", "HEAD");

    const capture = recorder();
    capture.beforeWrite(join(workspace, "app.ts"));
    write("app.ts", "v2\n");
    capture.beforeWrite(join(workspace, "extra.ts"));
    write("extra.ts", "v1\n");
    git(workspace, "add", "-A");
    git(workspace, "commit", "-q", "-m", "task(PAIM-1): done");
    expect(git(workspace, "rev-parse", "HEAD")).not.toBe(head);

    restoreWorkspace(capture.point()!, workspace);

    expect(git(workspace, "rev-parse", "HEAD")).toBe(head);
    expect(read("app.ts").toString()).toBe("v1\n");
    expect(existsSync(join(workspace, "extra.ts"))).toBe(false);
  });

  it("snapshots the files git does not track, which no stash holds", () => {
    initRepo(workspace);
    write(".gitignore", "ignored/\n");
    git(workspace, "add", "-A");
    git(workspace, "commit", "-q", "-m", "first");
    write("ignored/local.env", "SECRET=original\n");

    const capture = recorder();
    capture.beforeWrite(join(workspace, "ignored/local.env"));
    write("ignored/local.env", "SECRET=clobbered\n");

    const point = capture.point()!;
    expect(point.method).toBe("git");
    expect(point.snapshotDir).not.toBeNull();

    restoreWorkspace(point, workspace);

    expect(read("ignored/local.env").toString()).toBe("SECRET=original\n");
  });

  it("uses snapshots for a repository with no commit to return to", () => {
    initRepo(workspace);
    write("first.ts", "original\n");

    const capture = recorder();
    capture.beforeWrite(join(workspace, "first.ts"));
    write("first.ts", "changed\n");

    const point = capture.point()!;
    expect(point.method).toBe("snapshot");
    expect(point.head).toBeNull();

    restoreWorkspace(point, workspace);
    expect(read("first.ts").toString()).toBe("original\n");
  });

  it("refuses to treat a directory inside somebody else's checkout as a repository", () => {
    // `git reset --hard` at the toplevel would revert a repository the run
    // never touched, so a workspace that is not itself the toplevel takes
    // the snapshot path.
    initRepo(workspace);
    write("root.ts", "committed\n");
    git(workspace, "add", "-A");
    git(workspace, "commit", "-q", "-m", "first");

    const inner = join(workspace, "packages", "inner");
    mkdirSync(inner, { recursive: true });
    expect(gitWorkspaceRoot(inner)).toBeNull();

    const capture = createRestoreRecorder({
      runId: randomUUID(),
      workspacePath: inner,
      restoreRoot,
    });
    writeFileSync(join(inner, "file.ts"), "original\n");
    capture.beforeWrite(join(inner, "file.ts"));
    writeFileSync(join(inner, "file.ts"), "changed\n");

    expect(capture.point()!.method).toBe("snapshot");
    restoreWorkspace(capture.point()!, inner);
    expect(readFileSync(join(inner, "file.ts"), "utf-8")).toBe("original\n");
  });
});

// ---------------------------------------------------------------------------
// Capture failure (docs/09 "When the service cannot capture a restore point")
// ---------------------------------------------------------------------------

describe("capture failure", () => {
  it("disables Restore with a reason when a file is too large to snapshot", () => {
    write("huge.bin", Buffer.alloc(64, 7));
    const capture = recorder({ maxFileBytes: 8 });

    const point = capture.beforeWrite(join(workspace, "huge.bin"));

    expect(point.available).toBe(false);
    expect(point.reason).toMatch(/larger than the 8-byte snapshot limit/);
    expect(point.reason).toContain("huge.bin");
  });

  it("stays disabled for every later write, and captures nothing more", () => {
    write("huge.bin", Buffer.alloc(64, 7));
    write("small.txt", "original\n");
    const capture = recorder({ maxFileBytes: 8 });

    capture.beforeWrite(join(workspace, "huge.bin"));
    const point = capture.beforeWrite(join(workspace, "small.txt"));

    expect(point.available).toBe(false);
    expect(point.createdPaths).toEqual([]);
  });

  it("refuses to revert a point that never captured anything", () => {
    write("huge.bin", Buffer.alloc(64, 7));
    const capture = recorder({ maxFileBytes: 8 });
    const point = capture.beforeWrite(join(workspace, "huge.bin"));

    expect(() => restoreWorkspace(point, workspace)).toThrow(ApiError);
    try {
      restoreWorkspace(point, workspace);
    } catch (error) {
      expect((error as ApiError).code).toBe("NO_RESTORE_POINT");
      expect((error as ApiError).status).toBe(422);
    }
  });

  it("loses Restore rather than ignoring a write outside the workspace", () => {
    const outside = mkdtempSync(join(tmpdir(), "paim-outside-"));
    try {
      const point = recorder().beforeWrite(join(outside, "escape.txt"));
      expect(point.available).toBe(false);
      expect(point.reason).toMatch(/outside the workspace/);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// The runner captures before the first write
// ---------------------------------------------------------------------------

const ALLOW_ALL: SafetyPolicy = { denyList: [], mode: "allow_all", askList: [] };
const ASK_ALL: SafetyPolicy = { denyList: [], mode: "ask_all", askList: [] };

function makeProject(overrides: Partial<Project> = {}): Project {
  const now = new Date().toISOString();
  return insertProject(db, {
    ...defaultSettings(),
    id: randomUUID(),
    slug: `project-${randomUUID()}`,
    name: "PAIM",
    workspacePath: workspace,
    safety: ALLOW_ALL,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    ...overrides,
  });
}

function makeTask(project: Project): Task {
  const now = new Date().toISOString();
  return insertTask(db, {
    id: randomUUID(),
    key: `PAIM-${Math.floor(Math.random() * 1_000_000)}`,
    projectId: project.id,
    title: "Capture a restore point",
    description: "Write a file.",
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
    sourcePrompt: "write a file",
    evaluatedAt: null,
    staleReason: null,
    failureReason: null,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
    closedAt: null,
  });
}

function makeRun(task: Task): Run {
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
  });
}

/** A Write the scripted agent really performs, once the runner allows it. */
function writeStep(relativePath: string, content: string): FakeToolStep {
  return {
    name: "Write",
    input: { file_path: relativePath, content },
    onDecision: (decision) => {
      if (decision.behavior === "allow") write(relativePath, content);
    },
  };
}

describe("the runner captures the restore point", () => {
  it("captures before the first write and reverts the run byte for byte", async () => {
    const original = "before the run\n";
    write("src/app.ts", original);

    const project = makeProject();
    const task = makeTask(project);
    const run = makeRun(task);

    const outcome = await executeRun({
      db,
      run,
      task,
      project,
      approvals: createApprovalRegistry(),
      restoreRoot,
      agent: createFakeAgent({
        steps: [
          { name: "Read", input: { file_path: "src/app.ts" } },
          writeStep("src/app.ts", "after the run\n"),
          writeStep("src/created.ts", "new\n"),
        ],
      }),
    });

    expect(outcome.run.status).toBe("succeeded");
    expect(read("src/app.ts").toString()).toBe("after the run\n");

    const point = outcome.run.restorePoint!;
    expect(point.available).toBe(true);
    expect(point.createdPaths).toEqual([join("src", "created.ts")]);

    restoreWorkspace(point, workspace);
    expect(read("src/app.ts").toString()).toBe(original);
    expect(existsSync(join(workspace, "src/created.ts"))).toBe(false);
  });

  it("captures nothing for a run that only reads", async () => {
    const project = makeProject();
    const task = makeTask(project);
    const outcome = await executeRun({
      db,
      run: makeRun(task),
      task,
      project,
      approvals: createApprovalRegistry(),
      restoreRoot,
      agent: createFakeAgent({
        steps: [
          { name: "Read", input: { file_path: "src/app.ts" } },
          { name: "Grep", input: { pattern: "todo" } },
        ],
      }),
    });

    expect(outcome.run.restorePoint).toBeNull();
  });

  it("captures a write the user approved, before the file changes", async () => {
    // docs/10 §4: the operation parks. The bytes have to be kept at the
    // moment the answer arrives, not when the tool was first proposed.
    const original = "before the run\n";
    write("src/app.ts", original);

    const project = makeProject({ safety: ASK_ALL });
    const task = makeTask(project);
    const approvals = createApprovalRegistry();
    const run = makeRun(task);

    const running = executeRun({
      db,
      run,
      task,
      project,
      approvals,
      restoreRoot,
      agent: createFakeAgent({ steps: [writeStep("src/app.ts", "after the run\n")] }),
    });

    for (let attempt = 0; attempt < 400; attempt += 1) {
      const parked = listOperations(db, run.id).find((o) => o.status === "proposed");
      if (parked) {
        // Still untouched while the answer is outstanding.
        expect(read("src/app.ts").toString()).toBe(original);
        approvals.approve(parked.id);
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
    }

    const outcome = await running;
    expect(read("src/app.ts").toString()).toBe("after the run\n");

    restoreWorkspace(outcome.run.restorePoint!, workspace);
    expect(read("src/app.ts").toString()).toBe(original);
  });

  it("runs on with Restore disabled when the capture fails", async () => {
    // docs/09: "The service does not refuse the run. A refusal stops work
    // for a reason that the user may accept." The unreadable target here is
    // a path that is a directory: the bytes of the thing the model named
    // cannot be kept, which is the second of docs/09's two conditions.
    mkdirSync(join(workspace, "src"), { recursive: true });

    const project = makeProject();
    const task = makeTask(project);
    const outcome = await executeRun({
      db,
      run: makeRun(task),
      task,
      project,
      approvals: createApprovalRegistry(),
      restoreRoot,
      agent: createFakeAgent({
        steps: [
          {
            name: "Write",
            input: { file_path: "src", content: "clobbered" },
            outcome: { isError: true, text: "EISDIR: illegal operation on a directory" },
          },
          writeStep("other.ts", "written anyway\n"),
        ],
        result: { usage: { inputTokens: 5, outputTokens: 1, costUsd: 0.001 } },
      }),
    });

    // The run did its work.
    expect(outcome.run.status).toBe("succeeded");
    expect(read("other.ts").toString()).toBe("written anyway\n");
    // …and said, once, why Restore is gone.
    expect(outcome.run.restorePoint?.available).toBe(false);
    expect(outcome.run.restorePoint?.reason).toMatch(/could not be read/);
  });

  it("flags the operations Restore cannot revert", async () => {
    // docs/09: "An operation that Restore cannot revert says so on its own
    // row." A shell command's side effects are not in any restore point.
    const project = makeProject();
    const task = makeTask(project);
    const run = makeRun(task);

    await executeRun({
      db,
      run,
      task,
      project,
      approvals: createApprovalRegistry(),
      restoreRoot,
      agent: createFakeAgent({
        steps: [
          writeStep("src/app.ts", "written\n"),
          { name: "Bash", input: { command: "npm install left-pad" } },
          { name: "Read", input: { file_path: "src/app.ts" } },
        ],
      }),
    });

    const byKind = new Map(listOperations(db, run.id).map((o) => [o.kind, o.reversible]));
    expect(byKind.get("write")).toBe(true);
    expect(byKind.get("read")).toBe(true);
    expect(byKind.get("bash")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The maximum-size default is not what a test set
// ---------------------------------------------------------------------------

describe("defaults", () => {
  it("keeps its snapshots under the restore root it was given", () => {
    write("a.txt", "original\n");
    const runId = randomUUID();
    const capture = recorder({ runId });
    capture.beforeWrite(join(workspace, "a.txt"));

    expect(capture.point()!.snapshotDir).toBe(join(restoreRoot, runId));
    expect(existsSync(join(restoreRoot, runId, "files", "a.txt"))).toBe(true);
  });
});

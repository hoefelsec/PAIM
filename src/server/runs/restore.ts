/**
 * Restore points and Restore (T57; docs/09-ai-run.md "Restore",
 * specs/09-ai-run.md "Restore points").
 *
 * A run captures a restore point **before its first write**, by one of two
 * methods (docs/09):
 *
 * | Git, when the workspace is a repository | `HEAD`, and a stash of the uncommitted changes. |
 * | File snapshots, in all other cases      | The original bytes of each file the run changes. |
 *
 * Both methods also record the paths the run *creates*, because neither a
 * commit nor a snapshot of the old bytes says anything about a file that did
 * not exist. Naming them one by one is deliberate: `git clean` would also
 * sweep up the files a user made while the run was working, and Restore is
 * defined as returning the workspace to the state before *this run*.
 *
 * The capture is lazy and incremental — {@link createRestoreRecorder}
 * returns a recorder the runner touches immediately before each write or
 * edit. Nothing is captured for a run that only reads.
 *
 * **Capture failure** (docs/09 "When the service cannot capture a restore
 * point"): a file too large to snapshot, or a tree the process cannot read.
 * The run is not refused — "a refusal stops work for a reason that the user
 * may accept". The restore point is kept with `available: false` and the
 * reason the interface shows in the position of the Restore control.
 *
 * **What Restore does not revert** is not this module's problem to solve but
 * its duty to admit: a bash command's side effects stay, which is why
 * `Operation.reversible` is derived from the kind (src/shared/runs.ts).
 */

import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { RestoreMethod, RestorePoint } from "../../shared/runs.js";
import { ApiError } from "../errors.js";
import { confinePath } from "../safety/confine.js";

/** `data/restore/` at the repo root — specs/README "Layout". */
export const DEFAULT_RESTORE_ROOT = fileURLToPath(
  new URL("../../../data/restore", import.meta.url),
);

/**
 * The largest file the snapshot method copies. Above it the capture fails
 * rather than filling `data/` with a copy of something enormous — docs/09's
 * "a file that is too large to snapshot".
 */
export const MAX_SNAPSHOT_BYTES = 16 * 1024 * 1024;

/** Where a snapshot directory keeps the original bytes, mirroring the tree. */
const FILES_SUBDIR = "files";

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// ---------------------------------------------------------------------------
// git
// ---------------------------------------------------------------------------

/**
 * One git command in `cwd`, trimmed. Throws when git is missing, when the
 * directory is not a repository, or when the command itself fails — every
 * caller here treats a throw as "this is not a git workspace" or as a
 * capture failure.
 *
 * The identity is supplied on the command line because `git stash create`
 * writes a commit object, and a machine whose git has no `user.email` must
 * still be able to capture a restore point. The object is internal to PAIM
 * and never becomes part of the project's history.
 */
function git(cwd: string, args: string[]): string {
  return execFileSync(
    "git",
    ["-c", "user.name=PAIM", "-c", "user.email=paim@localhost", ...args],
    { cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] },
  ).trim();
}

/** Canonical form, for comparing two directories that may go through symlinks. */
function canonical(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

/**
 * The workspace as a git repository, or null.
 *
 * The repository's toplevel must *be* the workspace. A plain directory that
 * happens to sit inside somebody else's checkout is not a git workspace: a
 * `git reset --hard` there would revert a repository the run never touched,
 * which is the opposite of what Restore promises.
 */
export function gitWorkspaceRoot(workspacePath: string): string | null {
  try {
    const top = git(workspacePath, ["rev-parse", "--show-toplevel"]);
    if (top === "") return null;
    return canonical(top) === canonical(workspacePath) ? top : null;
  } catch {
    return null;
  }
}

/** The commit Restore returns to, or null for a repository with no commits. */
function gitHead(root: string): string | null {
  try {
    const head = git(root, ["rev-parse", "HEAD"]);
    return head === "" ? null : head;
  } catch {
    return null;
  }
}

/** Whether git tracks this path; an untracked file is not in the stash. */
function isTracked(root: string, relativePath: string): boolean {
  try {
    git(root, ["ls-files", "--error-unmatch", "--", relativePath]);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Capture
// ---------------------------------------------------------------------------

export interface RestoreRecorderOptions {
  runId: string;
  /** The project's `workspacePath`; every captured path is confined to it. */
  workspacePath: string;
  /** Where `data/restore/<runId>` is rooted. Tests point this at a temp dir. */
  restoreRoot?: string;
  /** Above this, the snapshot method gives up — see {@link MAX_SNAPSHOT_BYTES}. */
  maxFileBytes?: number;
  now?: () => string;
}

export interface RestoreRecorder {
  /** The point as it stands. Null until the run's first write. */
  point(): RestorePoint | null;
  /**
   * Called immediately before the run changes `absolutePath`. The first call
   * establishes the restore point; every call keeps the *original* state of
   * one more path — its bytes, or its absence. Never throws: a capture that
   * fails disables Restore for the run and the run carries on.
   */
  beforeWrite(absolutePath: string): RestorePoint;
}

function emptyPoint(method: RestoreMethod, capturedAt: string): RestorePoint {
  return {
    method,
    available: true,
    reason: null,
    head: null,
    stash: null,
    snapshotDir: null,
    createdPaths: [],
    capturedAt,
  };
}

export function createRestoreRecorder(options: RestoreRecorderOptions): RestoreRecorder {
  const {
    runId,
    workspacePath,
    restoreRoot = DEFAULT_RESTORE_ROOT,
    maxFileBytes = MAX_SNAPSHOT_BYTES,
    now = () => new Date().toISOString(),
  } = options;

  let point: RestorePoint | null = null;
  /** Paths already accounted for. The first capture of a file is the original. */
  const seen = new Set<string>();
  /** The git toplevel, once `establish` has looked for one. */
  let repository: string | null = null;

  /** docs/09: the run proceeds; Restore is disabled, with the reason stored. */
  function fail(reason: string): RestorePoint {
    point = { ...(point ?? emptyPoint("snapshot", now())), available: false, reason };
    return point;
  }

  function establish(): RestorePoint {
    const capturedAt = now();
    try {
      repository = gitWorkspaceRoot(workspacePath);
      const head = repository === null ? null : gitHead(repository);
      if (repository !== null && head !== null) {
        // `git stash create` writes the stash commit and prints its id
        // *without touching the working tree* — the run keeps working on the
        // files it found. An empty answer means the tree was clean.
        const stash = git(repository, ["stash", "create"]);
        point = { ...emptyPoint("git", capturedAt), head, stash: stash === "" ? null : stash };
        return point;
      }
      // No repository, or one with no commit to return to.
      repository = null;
      point = emptyPoint("snapshot", capturedAt);
      return point;
    } catch (error) {
      repository = null;
      return fail(`the workspace could not be read: ${describeError(error)}`);
    }
  }

  /** The snapshot directory, created on the first file that needs one. */
  function snapshotDir(current: RestorePoint): { point: RestorePoint; dir: string } {
    if (current.snapshotDir !== null) return { point: current, dir: current.snapshotDir };
    const dir = join(restoreRoot, runId);
    mkdirSync(join(dir, FILES_SUBDIR), { recursive: true });
    return { point: { ...current, snapshotDir: dir }, dir };
  }

  function beforeWrite(absolutePath: string): RestorePoint {
    const current = point ?? establish();
    if (!current.available) return current;

    const confined = confinePath(workspacePath, absolutePath);
    if (!confined.ok) {
      // docs/09 "What Restore reverts" lists writes outside the workspace as
      // something Restore does not undo. The runner refuses those before
      // they happen (docs/10 §2); one arriving here is a bug, not a file to
      // quietly ignore, so the run keeps its honesty and loses Restore.
      return fail(`"${absolutePath}" is outside the workspace`);
    }

    const relativePath = relative(canonical(workspacePath), confined.path);
    if (seen.has(relativePath)) return current;
    seen.add(relativePath);

    try {
      if (!existsSync(confined.path)) {
        // The run is creating this file. Restore deletes it again.
        point = { ...current, createdPaths: [...current.createdPaths, relativePath] };
        return point;
      }

      // In git mode the commit and the stash already hold every tracked
      // file's original bytes. What they do *not* hold is an untracked file
      // the run is about to overwrite — `git stash create` ignores untracked
      // work — so those get the snapshot treatment too.
      if (current.method === "git" && repository !== null && isTracked(repository, relativePath)) {
        return current;
      }

      const size = statSync(confined.path).size;
      if (size > maxFileBytes) {
        return fail(
          `"${relativePath}" is ${size} bytes, larger than the ${maxFileBytes}-byte snapshot limit`,
        );
      }

      const opened = snapshotDir(current);
      const target = join(opened.dir, FILES_SUBDIR, relativePath);
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(confined.path, target);
      point = opened.point;
      return point;
    } catch (error) {
      return fail(`the workspace could not be read: ${describeError(error)}`);
    }
  }

  return { point: () => point, beforeWrite };
}

// ---------------------------------------------------------------------------
// Restore
// ---------------------------------------------------------------------------

/** What one Restore put back. */
export interface RestoreResult {
  method: RestoreMethod;
  /** Workspace-relative paths whose original bytes are back. */
  restored: string[];
  /** Workspace-relative paths the run created, now deleted. */
  deleted: string[];
}

/** Every file under `dir`, as paths relative to it. */
function walkFiles(dir: string, prefix = ""): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const child = join(dir, entry.name);
    const rel = prefix === "" ? entry.name : join(prefix, entry.name);
    if (entry.isDirectory()) {
      found.push(...walkFiles(child, rel));
    } else if (entry.isFile()) {
      found.push(rel);
    }
  }
  return found;
}

/**
 * Reverts the workspace to the state the restore point describes (docs/09
 * "Restore"): writes and edits come back, the files the run created are
 * deleted, and in a repository this run's automatic commits are undone with
 * them.
 *
 * Directories the run created are left in place. An empty directory carries
 * no bytes, and removing one risks removing a directory that was empty
 * before the run started.
 */
export function restoreWorkspace(point: RestorePoint, workspacePath: string): RestoreResult {
  if (!point.available) {
    throw new ApiError(
      "NO_RESTORE_POINT",
      422,
      { reason: point.reason },
      `Restore is not available: ${point.reason ?? "the restore point could not be captured"}`,
    );
  }

  const restored: string[] = [];
  const deleted: string[] = [];

  try {
    if (point.method === "git") {
      const root = gitWorkspaceRoot(workspacePath);
      if (root === null || point.head === null) {
        throw new Error("the workspace is no longer the git repository the run captured");
      }
      // Undoes this run's automatic commits, its staged changes and every
      // tracked file it wrote, in one move.
      git(root, ["reset", "--hard", point.head]);
      if (point.stash !== null) {
        // Puts back the uncommitted work the run found when it started.
        git(root, ["stash", "apply", point.stash]);
      }
    }

    // Both modes: the bytes held under `data/restore/<runId>/files`. In git
    // mode that is only what git does not track.
    if (point.snapshotDir !== null) {
      const filesDir = join(point.snapshotDir, FILES_SUBDIR);
      if (existsSync(filesDir)) {
        for (const relativePath of walkFiles(filesDir)) {
          const confined = confinePath(workspacePath, relativePath);
          if (!confined.ok) continue;
          mkdirSync(dirname(confined.path), { recursive: true });
          copyFileSync(join(filesDir, relativePath), confined.path);
          restored.push(relativePath);
        }
      }
    }

    for (const relativePath of point.createdPaths) {
      const confined = confinePath(workspacePath, relativePath);
      if (!confined.ok) continue;
      // A `git reset --hard` may already have removed a created file that
      // the run committed; and only a file is removed, never a directory.
      if (!existsSync(confined.path)) {
        deleted.push(relativePath);
        continue;
      }
      if (!lstatSync(confined.path).isFile()) continue;
      rmSync(confined.path, { force: true });
      deleted.push(relativePath);
    }
  } catch (error) {
    throw new ApiError(
      "RESTORE_FAILED",
      500,
      { method: point.method },
      `Restore could not revert the workspace: ${describeError(error)}`,
    );
  }

  return { method: point.method, restored, deleted };
}

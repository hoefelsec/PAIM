/**
 * docs/02-data-model.md "version" / specs/01-projects.md "Version reader".
 *
 * Reads a project's version from its workspace and caches it keyed by the
 * source file's mtime, so a fresh read only happens when the file actually
 * changed. `version` is never stored on the project record.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Project } from "../../shared/types.js";

/**
 * Injectable I/O so tests can count reads and stub `git describe` without
 * touching the real filesystem or spawning a process.
 */
export interface VersionDeps {
  statMs(path: string): number;
  readFile(path: string): string;
  gitDescribe(cwd: string): string;
}

export const defaultVersionDeps: VersionDeps = {
  statMs: (path) => statSync(path).mtimeMs,
  readFile: (path) => readFileSync(path, "utf8"),
  gitDescribe: (cwd) =>
    execFileSync("git", ["describe", "--tags", "--always"], { cwd, encoding: "utf8" }).trim(),
};

interface CacheEntry {
  mtimeMs: number;
  value: string | null;
}

/** Cache key -> last known mtime + the value read at that mtime. */
const cache = new Map<string, CacheEntry>();

/** Test-only: forget every cached value. */
export function clearVersionCache(): void {
  cache.clear();
}

/** The file whose mtime gates a re-read, per docs/02's source table. */
function sourceFile(workspacePath: string, type: Project["type"]): string | null {
  switch (type) {
    case "node":
      return join(workspacePath, "package.json");
    case "python":
      return join(workspacePath, "pyproject.toml");
    case "go":
      return join(workspacePath, "go.mod");
    case "rust":
      return join(workspacePath, "Cargo.toml");
    case "generic":
      // git describe has no single source file; the repo's HEAD ref is the
      // closest proxy for "the thing whose change should trigger a re-read".
      return join(workspacePath, ".git", "HEAD");
    default:
      return null;
  }
}

function extractVersion(
  type: Project["type"],
  workspacePath: string,
  filePath: string,
  deps: VersionDeps,
): string | null {
  if (type === "generic") {
    try {
      const out = deps.gitDescribe(workspacePath);
      return out.length > 0 ? out : null;
    } catch {
      return null;
    }
  }

  let content: string;
  try {
    content = deps.readFile(filePath);
  } catch {
    return null;
  }

  if (type === "node") {
    try {
      const parsed = JSON.parse(content) as Record<string, unknown>;
      return typeof parsed["version"] === "string" ? parsed["version"] : null;
    } catch {
      return null;
    }
  }

  if (type === "python" || type === "rust") {
    // pyproject.toml / Cargo.toml: a plain `version = "x.y.z"` line.
    const match = content.match(/^\s*version\s*=\s*"([^"]+)"/m);
    return match?.[1] ?? null;
  }

  // go.mod carries no application version field (docs/02); nothing to read.
  return null;
}

/**
 * Reads (or returns the cached) version for a project. Returns `null` when
 * there is no workspace, no recognised source, or nothing to read.
 */
export function readProjectVersion(
  project: Pick<Project, "type" | "workspacePath">,
  deps: VersionDeps = defaultVersionDeps,
): string | null {
  if (!project.workspacePath) return null;

  const filePath = sourceFile(project.workspacePath, project.type);
  if (!filePath) return null;

  let mtimeMs: number;
  try {
    mtimeMs = deps.statMs(filePath);
  } catch {
    cache.delete(filePath);
    return null;
  }

  const cached = cache.get(filePath);
  if (cached && cached.mtimeMs === mtimeMs) {
    return cached.value;
  }

  const value = extractVersion(project.type, project.workspacePath, filePath, deps);
  cache.set(filePath, { mtimeMs, value });
  return value;
}

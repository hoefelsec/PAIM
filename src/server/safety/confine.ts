/**
 * Path confinement — the safety kernel's one pure function (specs/08
 * "Path confinement", docs/10-execution-safety.md §2 "The workspace path").
 *
 * A run writes files and executes shell commands inside a project's
 * `workspacePath`. Before any of that happens, every candidate path is
 * canonicalized (symlinks and `..` resolved) and checked for containment in
 * the root. The service refuses `..` escapes, symlinks that leave the root,
 * and absolute paths outside the root. This is not configurable — there is
 * no mode or override that widens it.
 *
 * Used later by runs, docs rendering, mockups, and restore (specs/08 scope).
 * This module has no knowledge of any of those callers.
 */

import { realpathSync } from "node:fs";
import { dirname, basename, isAbsolute, join, relative, resolve, sep } from "node:path";

export type ConfineResult =
  | { ok: true; path: string }
  | { ok: false; reason: "escape" };

/**
 * Resolves `p` to its canonical, symlink-free form. `p` need not exist: this
 * walks up to the longest existing ancestor, resolves *that* with
 * `realpathSync` (which itself follows a chain of symlinks of any length),
 * then rejoins the non-existent tail literally.
 */
function canonicalize(p: string): string {
  const tail: string[] = [];
  let current = p;

  for (;;) {
    try {
      const real = realpathSync(current);
      return tail.length > 0 ? join(real, ...tail) : real;
    } catch {
      const parent = dirname(current);
      if (parent === current) {
        // Reached the filesystem root without finding an existing segment.
        return tail.length > 0 ? join(current, ...tail) : current;
      }
      tail.unshift(basename(current));
      current = parent;
    }
  }
}

/**
 * Canonicalizes `candidate` (resolved against `root` first, so relative
 * candidates, `..` segments, and absolute candidates are all handled) and
 * verifies the result is inside the canonical form of `root`.
 *
 * `root` itself is returned as `ok: true` (a path is contained in itself).
 * Sibling roots that share a string prefix — `/a/b` vs `/a/bb` — are not
 * confused: containment is decided by `path.relative`, not string prefix.
 */
export function confinePath(root: string, candidate: string): ConfineResult {
  const canonicalRoot = canonicalize(resolve(root));
  const resolvedCandidate = resolve(root, candidate);
  const canonicalCandidate = canonicalize(resolvedCandidate);

  const rel = relative(canonicalRoot, canonicalCandidate);
  const isInside = rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));

  if (!isInside) {
    return { ok: false, reason: "escape" };
  }

  return { ok: true, path: canonicalCandidate };
}

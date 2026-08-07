/**
 * Pattern matcher and policy decision — the safety kernel's second pure
 * module (specs/08 "Pattern matcher" / "Policy resolution",
 * docs/10-execution-safety.md §3 "The deny list" and §4 "The three modes").
 *
 * Two independent pieces:
 *
 * - `matchesEntry` / `matchesAny`: a glob entry (picomatch) checked against
 *   the normalized command of a bash operation, or the target path of a
 *   file operation. Either kind of operation uses the same matcher; only
 *   the string it is matched against differs.
 * - `decide`: the deny list first (never overridable, in every mode), then
 *   the mode — `allow_all` / `ask_all` / `ask_listed` + the ask list. A
 *   per-task override replaces only the mode; the deny list and ask list
 *   always come from the project policy (docs/10 §5 "Per-task override").
 *
 * This module has no knowledge of the Agent SDK, runs, or approvals — that
 * wiring is specs/09's job (out of scope here, specs/08 "Out of scope").
 */

import picomatch from "picomatch";
import type { SafetyMode, SafetyPolicy } from "../../shared/types.js";

/** A candidate operation the policy decides on. */
export type Operation =
  | { kind: "bash"; command: string }
  | { kind: "file"; path: string };

export type Decision = "deny" | "ask" | "allow";

/**
 * docs/10 §4 "The service normalizes the command before the match. It
 * trims the ends and collapses repeated spaces." Applied only to bash
 * commands — a file path is matched as-is.
 */
export function normalizeCommand(command: string): string {
  return command.trim().replace(/\s+/g, " ");
}

/** The single string a pattern is matched against, per operation kind. */
function targetString(op: Operation): string {
  return op.kind === "bash" ? normalizeCommand(op.command) : op.path;
}

/**
 * A small cache: compiling the same glob repeatedly is wasted work. Bounded
 * and evicted least-recently-used, because patterns come from editable
 * project policy (deny/ask lists) rather than a fixed set baked into the
 * code, so an unbounded map would grow for the life of the process.
 */
const MATCHER_CACHE_LIMIT = 500;
const matcherCache = new Map<string, (input: string) => boolean>();

function compile(pattern: string): (input: string) => boolean {
  let matcher = matcherCache.get(pattern);
  if (matcher) {
    // Refresh recency: delete + re-set moves this entry to the end of the
    // Map's iteration order, which is what makes the eviction below LRU.
    matcherCache.delete(pattern);
    matcherCache.set(pattern, matcher);
  }
  if (!matcher) {
    // Case-sensitive (specs/08): picomatch defaults to case-sensitive.
    // `bash: true` makes `*` match any character, including `/` — entries
    // are matched against shell commands and arbitrary file paths, not
    // path segments, so a plain glob must not stop at a slash the way it
    // would for a filename pattern (`curl *`, `rm *`, `*.env` in a
    // subdirectory all rely on this). `dot: true` is required alongside it:
    // picomatch's default `dot: false` stops `*` from matching a leading
    // `.` (at the start of the string or right after a `/`), which would
    // let dotfile targets like `.env`, `.ssh`, `.config`, and `.git` slip
    // past both the deny list and the ask list.
    matcher = picomatch(pattern, { bash: true, dot: true });
    matcherCache.set(pattern, matcher);
    if (matcherCache.size > MATCHER_CACHE_LIMIT) {
      // Map iteration order is insertion order, so the first key is the
      // least recently used one (see the recency refresh above).
      const oldest = matcherCache.keys().next().value;
      if (oldest !== undefined) matcherCache.delete(oldest);
    }
  }
  return matcher;
}

/** Whether one glob entry matches the operation's applicable string. */
export function matchesEntry(pattern: string, op: Operation): boolean {
  return compile(pattern)(targetString(op));
}

/** Whether any entry in `patterns` matches the operation. */
export function matchesAny(patterns: readonly string[], op: Operation): boolean {
  return patterns.some((pattern) => matchesEntry(pattern, op));
}

/**
 * `decide(op, policy) → deny | ask | allow` (specs/08 "Policy resolution").
 *
 * - The deny list is checked first and applies in every mode, including
 *   `allow_all` (docs/10 §3: "The deny list applies in every mode").
 * - `overrideMode` is a task's `safety.mode` (docs/10 §5): it replaces the
 *   project's mode only. The project's `denyList` and `askList` are always
 *   used — a task cannot supply its own deny list, and a task's own ask
 *   list (if any) is ignored, matching "the deny list is not part of the
 *   override" and "the user overrides the mode for one task".
 */
export function decide(op: Operation, policy: SafetyPolicy, overrideMode?: SafetyMode | null): Decision {
  if (matchesAny(policy.denyList, op)) {
    return "deny";
  }

  const mode = overrideMode ?? policy.mode;

  switch (mode) {
    case "allow_all":
      return "allow";
    case "ask_all":
      return "ask";
    case "ask_listed":
      return matchesAny(policy.askList, op) ? "ask" : "allow";
    default: {
      const exhaustive: never = mode;
      throw new Error(`unreachable safety mode: ${String(exhaustive)}`);
    }
  }
}

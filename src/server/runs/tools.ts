/**
 * The six built-in Agent SDK tools, described as PAIM operations
 * (docs/09-ai-run.md "The library" and "Records").
 *
 * The SDK offers Read, Write, Edit, Bash, Glob, and Grep. Each maps onto
 * exactly one `Operation.kind`, and each carries exactly one thing the
 * safety policy can match against: a filesystem path, or a shell command
 * (docs/10 §4 "The pattern language").
 *
 * Nothing here decides anything. It reads a tool call and says what kind of
 * operation it is and what it targets; the policy (src/server/safety) and
 * the runner do the rest.
 */

import type { OperationKind } from "../../shared/runs.js";

/**
 * The tool names a run exposes. Handed to the SDK as its tool list so the
 * model is offered these and nothing else, and used here to reject a tool
 * call that arrives under any other name.
 */
export const RUN_TOOL_NAMES = ["Read", "Write", "Edit", "Bash", "Glob", "Grep"] as const;
export type RunToolName = (typeof RUN_TOOL_NAMES)[number];

const KIND_BY_TOOL: Record<RunToolName, OperationKind> = {
  Read: "read",
  Write: "write",
  Edit: "edit",
  Bash: "bash",
  Glob: "glob",
  Grep: "grep",
};

/** A tool call, read as an operation. Exactly one of `path`/`command` is set. */
export interface ToolDescription {
  kind: OperationKind;
  /**
   * The path the tool targets, as the model wrote it — relative paths and
   * `..` included. The runner canonicalizes and confines it (docs/10 §2).
   * `null` for bash. For Glob and Grep, whose `path` is optional, `null`
   * means "the workspace root".
   */
  path: string | null;
  /** The command bash will execute; null for every other tool. */
  command: string | null;
}

function stringField(input: Record<string, unknown>, name: string): string | null {
  const value = input[name];
  return typeof value === "string" ? value : null;
}

/**
 * Reads one tool call. Returns `null` for a tool that is not one of the six
 * — the runner refuses those rather than guessing what they would do.
 */
export function describeTool(
  toolName: string,
  input: Record<string, unknown>,
): ToolDescription | null {
  if (!(RUN_TOOL_NAMES as readonly string[]).includes(toolName)) {
    return null;
  }
  const tool = toolName as RunToolName;
  const kind = KIND_BY_TOOL[tool];

  if (tool === "Bash") {
    // A Bash call without a command is malformed; treat it as unrecognized
    // rather than letting an empty string past the deny list.
    const command = stringField(input, "command");
    return command === null ? null : { kind, path: null, command };
  }

  if (tool === "Glob" || tool === "Grep") {
    // `path` is optional on both; absent means the search starts at the
    // workspace root, which is what the runner substitutes.
    return { kind, path: stringField(input, "path"), command: null };
  }

  const path = stringField(input, "file_path");
  return path === null ? null : { kind, path, command: null };
}

/**
 * One line for the run log — docs/09 "Records" shows `Edit src/api/tasks.ts`.
 * `target` is the display form the runner computed: a workspace-relative
 * path, or the normalized command.
 */
export function summarizeOperation(kind: OperationKind, target: string): string {
  const label = kind.charAt(0).toUpperCase() + kind.slice(1);
  return target === "" ? label : `${label} ${target}`;
}

/** Cap a synthesized diff so one enormous write cannot bloat the run record. */
const DIFF_LINE_LIMIT = 400;

function diffLines(prefix: string, text: string): string[] {
  const lines = text.split("\n");
  const shown = lines.slice(0, DIFF_LINE_LIMIT).map((line) => `${prefix}${line}`);
  if (lines.length > DIFF_LINE_LIMIT) {
    shown.push(`… ${lines.length - DIFF_LINE_LIMIT} more line(s)`);
  }
  return shown;
}

/**
 * The `diff` a write or edit records (docs/09 "Records": diff is for write
 * and edit, and null for everything else).
 *
 * It is built from the tool's own input, not from the filesystem: the record
 * is written when the operation is proposed, which is before the file
 * changes, and a diff of what the model asked for is what the approval
 * prompt and the run log need to show.
 */
export function buildDiff(
  kind: OperationKind,
  input: Record<string, unknown>,
  display: string,
): string | null {
  if (kind === "write") {
    const content = stringField(input, "content");
    if (content === null) return null;
    return [`--- /dev/null`, `+++ ${display}`, ...diffLines("+", content)].join("\n");
  }

  if (kind === "edit") {
    const oldString = stringField(input, "old_string");
    const newString = stringField(input, "new_string");
    if (oldString === null || newString === null) return null;
    return [
      `--- ${display}`,
      `+++ ${display}`,
      ...diffLines("-", oldString),
      ...diffLines("+", newString),
    ].join("\n");
  }

  return null;
}

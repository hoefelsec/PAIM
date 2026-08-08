/**
 * Reading the six built-in tool calls as operations (docs/09-ai-run.md "The
 * library" and "Records").
 */

import { describe, expect, it } from "vitest";
import {
  buildDiff,
  describeTool,
  RUN_TOOL_NAMES,
  summarizeOperation,
} from "../../../src/server/runs/tools.js";

describe("describeTool", () => {
  it("maps every built-in tool onto its operation kind", () => {
    expect(describeTool("Read", { file_path: "a.ts" })).toEqual({
      kind: "read",
      path: "a.ts",
      command: null,
    });
    expect(describeTool("Write", { file_path: "a.ts", content: "x" })).toEqual({
      kind: "write",
      path: "a.ts",
      command: null,
    });
    expect(describeTool("Edit", { file_path: "a.ts", old_string: "x", new_string: "y" })).toEqual({
      kind: "edit",
      path: "a.ts",
      command: null,
    });
    expect(describeTool("Bash", { command: "npm test" })).toEqual({
      kind: "bash",
      path: null,
      command: "npm test",
    });
    expect(describeTool("Glob", { pattern: "**/*.ts", path: "src" })).toEqual({
      kind: "glob",
      path: "src",
      command: null,
    });
    expect(describeTool("Grep", { pattern: "TODO" })).toEqual({
      kind: "grep",
      path: null,
      command: null,
    });
  });

  it("covers the six tools the runner offers and nothing else", () => {
    expect([...RUN_TOOL_NAMES]).toEqual(["Read", "Write", "Edit", "Bash", "Glob", "Grep"]);
    for (const name of RUN_TOOL_NAMES) {
      const input = name === "Bash" ? { command: "ls" } : { file_path: "a.ts", pattern: "x" };
      expect(describeTool(name, input)).not.toBeNull();
    }
  });

  it("refuses a tool outside the six", () => {
    expect(describeTool("WebFetch", { url: "https://example.com" })).toBeNull();
    expect(describeTool("read", { file_path: "a.ts" })).toBeNull();
  });

  it("refuses a malformed call rather than guessing its target", () => {
    expect(describeTool("Bash", {})).toBeNull();
    expect(describeTool("Bash", { command: 7 })).toBeNull();
    expect(describeTool("Read", {})).toBeNull();
    expect(describeTool("Edit", { file_path: null })).toBeNull();
  });
});

describe("summarizeOperation", () => {
  it("reads like the run log of docs/09", () => {
    expect(summarizeOperation("edit", "src/api/tasks.ts")).toBe("Edit src/api/tasks.ts");
    expect(summarizeOperation("bash", "npm test")).toBe("Bash npm test");
    expect(summarizeOperation("read", "")).toBe("Read");
  });
});

describe("buildDiff", () => {
  it("shows a write as new content", () => {
    expect(buildDiff("write", { content: "a\nb" }, "docs/x.md")).toBe(
      "--- /dev/null\n+++ docs/x.md\n+a\n+b",
    );
  });

  it("shows an edit as the replaced text", () => {
    expect(buildDiff("edit", { old_string: "a", new_string: "b" }, "x.ts")).toBe(
      "--- x.ts\n+++ x.ts\n-a\n+b",
    );
  });

  it("has no diff for the operations docs/09 says carry none", () => {
    expect(buildDiff("read", { file_path: "x" }, "x")).toBeNull();
    expect(buildDiff("bash", { command: "ls" }, "ls")).toBeNull();
    expect(buildDiff("glob", {}, ".")).toBeNull();
    expect(buildDiff("grep", {}, ".")).toBeNull();
  });

  it("has no diff when the tool call is missing the text it would show", () => {
    expect(buildDiff("write", {}, "x")).toBeNull();
    expect(buildDiff("edit", { old_string: "a" }, "x")).toBeNull();
  });

  it("truncates an enormous write instead of storing all of it", () => {
    const content = Array.from({ length: 500 }, (_, index) => `line ${index}`).join("\n");
    const diff = buildDiff("write", { content }, "big.txt");
    expect(diff).not.toBeNull();
    const lines = diff!.split("\n");
    // 2 header lines + 400 shown + 1 elision note.
    expect(lines).toHaveLength(403);
    expect(lines.at(-1)).toBe("… 100 more line(s)");
  });
});

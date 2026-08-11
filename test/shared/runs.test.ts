import { describe, expect, it } from "vitest";
import {
  ACTIVE_RUN_STATUSES,
  OPERATION_KINDS,
  RUN_STATUSES,
  TERMINAL_RUN_STATUSES,
  isTerminalRunStatus,
  reversibleByRestore,
  riskForKind,
  type OperationKind,
  type OperationRisk,
} from "../../src/shared/runs.js";

describe("riskForKind", () => {
  // docs/09 "Records": risk is derived from kind; docs/13 "Operation risk
  // colours" gives the three classes their meaning.
  const table: [OperationKind, OperationRisk][] = [
    ["read", "safe"],
    ["glob", "safe"],
    ["grep", "safe"],
    ["write", "write"],
    ["edit", "write"],
    ["bash", "exec"],
  ];

  for (const [kind, risk] of table) {
    it(`derives ${risk} from ${kind}`, () => {
      expect(riskForKind(kind)).toBe(risk);
    });
  }

  it("covers every operation kind", () => {
    // A new tool added to OPERATION_KINDS must state its risk here, not
    // fall through to a default.
    expect(table.map(([kind]) => kind)).toEqual([...OPERATION_KINDS]);
    for (const kind of OPERATION_KINDS) {
      expect(() => riskForKind(kind)).not.toThrow();
    }
  });

  it("refuses a kind that is not a tool", () => {
    expect(() => riskForKind("sudo" as OperationKind)).toThrow(/unreachable operation kind/);
  });
});

describe("reversibleByRestore", () => {
  // docs/09 "What Restore reverts": file writes and edits come back, and the
  // files a run created are deleted. A shell command's side effects —
  // packages, services, migrations, pushes — are in no restore point.
  it("says a file operation comes back", () => {
    expect(reversibleByRestore("write")).toBe(true);
    expect(reversibleByRestore("edit")).toBe(true);
  });

  it("says a read changed nothing to revert", () => {
    expect(reversibleByRestore("read")).toBe(true);
    expect(reversibleByRestore("glob")).toBe(true);
    expect(reversibleByRestore("grep")).toBe(true);
  });

  it("says a shell command does not", () => {
    expect(reversibleByRestore("bash")).toBe(false);
  });

  it("covers every operation kind", () => {
    for (const kind of OPERATION_KINDS) {
      expect(() => reversibleByRestore(kind)).not.toThrow();
    }
    expect(() => reversibleByRestore("sudo" as OperationKind)).toThrow(
      /unreachable operation kind/,
    );
  });
});

describe("run statuses", () => {
  it("is the nine of docs/09", () => {
    expect(RUN_STATUSES).toEqual([
      "queued",
      "planning",
      "awaiting_approval",
      "executing",
      "paused",
      "held_budget",
      "succeeded",
      "failed",
      "cancelled",
    ]);
  });

  it("splits into terminal and active with nothing left over", () => {
    expect([...ACTIVE_RUN_STATUSES, ...TERMINAL_RUN_STATUSES].sort()).toEqual(
      [...RUN_STATUSES].sort(),
    );
    // docs/09 "Service restart" acts on exactly the active ones.
    expect([...ACTIVE_RUN_STATUSES]).toEqual([
      "queued",
      "planning",
      "awaiting_approval",
      "executing",
      "paused",
      "held_budget",
    ]);
  });

  it("names a finished run terminal", () => {
    expect(isTerminalRunStatus("succeeded")).toBe(true);
    expect(isTerminalRunStatus("failed")).toBe(true);
    expect(isTerminalRunStatus("cancelled")).toBe(true);
    expect(isTerminalRunStatus("awaiting_approval")).toBe(false);
    expect(isTerminalRunStatus("queued")).toBe(false);
  });
});

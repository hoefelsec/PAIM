import { describe, expect, it } from "vitest";
import {
  ACTIVE_RUN_STATUSES,
  OPERATION_KINDS,
  RUN_STATUSES,
  TERMINAL_RUN_STATUSES,
  isTerminalRunStatus,
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

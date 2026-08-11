/* The Run tab's readings of a run record (T69, src/app/run.ts).
 *
 * Everything the tab prints is derived from docs/09 "Records" rather than
 * stored: the counts on the bar, the four numbers of the runfoot, the model a
 * run used (docs/11 "Model routing"), the split of a stored diff, whether
 * Restore is offered, and how a stream frame folds into the cached log.
 */

import { describe, expect, it } from "vitest";
import {
  adaptationAfter,
  applyRunFrame,
  denialReason,
  describeRestore,
  describeTally,
  flagsIrreversible,
  formatCost,
  formatDuration,
  formatModel,
  formatTokens,
  isRunActive,
  operationTarget,
  parseDiff,
  resolveTaskModel,
  restoreOffer,
  runDurationMs,
  tallyOperations,
} from "../../src/app/run";
import { makeOperation, makeProject, makeRun, makeTask } from "./harness";
import type { RestorePoint } from "../../src/shared/runs.js";

const POINT: RestorePoint = {
  method: "snapshot",
  available: true,
  reason: null,
  head: null,
  stash: null,
  snapshotDir: "/tmp/restore/run-1",
  createdPaths: [],
  capturedAt: "2026-01-01T10:00:00.000Z",
};

describe("the operation line", () => {
  it("drops the kind the badge already prints", () => {
    expect(operationTarget(makeOperation({ kind: "edit", summary: "Edit src/api/tasks.ts" }))).toBe(
      "src/api/tasks.ts",
    );
    expect(
      operationTarget(makeOperation({ kind: "bash", summary: "Bash npm test -- pagination" })),
    ).toBe("npm test -- pagination");
  });

  it("keeps a summary that does not start with its kind", () => {
    expect(operationTarget(makeOperation({ kind: "read", summary: "something else" }))).toBe(
      "something else",
    );
  });

  it("derives risk from the kind, never from the fixture", () => {
    expect(makeOperation({ kind: "grep" }).risk).toBe("safe");
    expect(makeOperation({ kind: "write" }).risk).toBe("write");
    expect(makeOperation({ kind: "bash" }).risk).toBe("exec");
  });
});

describe("the irreversible flag", () => {
  it("marks a shell command that ran", () => {
    // docs/09 "What Restore reverts": the row states its own limit.
    expect(flagsIrreversible(makeOperation({ kind: "bash", status: "done" }))).toBe(true);
    expect(flagsIrreversible(makeOperation({ kind: "bash", status: "running" }))).toBe(true);
    expect(flagsIrreversible(makeOperation({ kind: "bash", status: "failed" }))).toBe(true);
  });

  it("does not mark one that never ran", () => {
    // A refused `npm install` installed nothing; a warning would be a lie.
    expect(flagsIrreversible(makeOperation({ kind: "bash", status: "denied" }))).toBe(false);
    expect(flagsIrreversible(makeOperation({ kind: "bash", status: "proposed" }))).toBe(false);
  });

  it("never marks an operation Restore does revert", () => {
    expect(flagsIrreversible(makeOperation({ kind: "write", status: "done" }))).toBe(false);
    expect(flagsIrreversible(makeOperation({ kind: "read", status: "done" }))).toBe(false);
  });
});

describe("a refusal", () => {
  it("quotes the reason this tab sent", () => {
    const denials = new Map([["op-x", "we do not force-push"]]);
    expect(denialReason(makeOperation({ kind: "bash", id: "op-x" }), denials)).toBe(
      "we do not force-push",
    );
  });

  it("states the source when the reason was the project's own rules", () => {
    expect(denialReason(makeOperation({ kind: "bash", id: "op-y" }), new Map())).toMatch(
      /safety rules/,
    );
  });

  it("reads the model's adaptation off the next line of the log", () => {
    // docs/10 §3: the refusal reaches the model and the run continues.
    const operations = [
      makeOperation({ kind: "bash", status: "denied", summary: "Bash git push --force" }),
      makeOperation({ kind: "bash", summary: "Bash git push origin fix/cursor" }),
    ];
    expect(adaptationAfter(operations, 0)).toBe("Bash git push origin fix/cursor");
    expect(adaptationAfter(operations, 1)).toBeNull();
  });
});

describe("diffs", () => {
  it("splits a unified diff into coloured lines", () => {
    const diff = [
      "--- src/api/tasks.ts",
      "+++ src/api/tasks.ts",
      "@@ -142,7 +142,9 @@",
      " const rows = stmt.all()",
      "-const next = encodeCursor(rows[0])",
      "+const next = encodeCursor(last)",
    ].join("\n");

    expect(parseDiff(diff).map((line) => line.kind)).toEqual([
      "meta",
      "meta",
      "hunk",
      "ctx",
      "del",
      "add",
    ]);
  });

  it("does not read a file header as an addition", () => {
    expect(parseDiff("+++ b/x")[0]?.kind).toBe("meta");
    expect(parseDiff("--- a/x")[0]?.kind).toBe("meta");
  });
});

describe("the counts on the bar", () => {
  it("counts each terminal state and what is waiting on the user", () => {
    const operations = [
      makeOperation({ kind: "grep" }),
      makeOperation({ kind: "read" }),
      makeOperation({ kind: "bash", status: "failed" }),
      makeOperation({ kind: "bash", status: "denied" }),
      makeOperation({ kind: "bash", status: "proposed" }),
      makeOperation({ kind: "edit", status: "running" }),
    ];

    expect(tallyOperations(operations)).toEqual({
      total: 6,
      done: 2,
      failed: 1,
      refused: 1,
      awaiting: 1,
    });
    expect(describeTally(tallyOperations(operations))).toBe(
      "6 operations · 2 done · 1 failed · 1 refused · 1 awaiting you",
    );
  });

  it("says nothing about a count that is zero", () => {
    expect(describeTally(tallyOperations([makeOperation({ kind: "read" })]))).toBe(
      "1 operation · 1 done",
    );
  });
});

describe("the runfoot", () => {
  it("measures a finished run from its own timestamps", () => {
    const run = makeRun({
      startedAt: "2026-01-01T10:00:00.000Z",
      endedAt: "2026-01-01T10:01:12.000Z",
    });
    expect(runDurationMs(run, Date.now())).toBe(72_000);
    expect(formatDuration(72_000)).toBe("1m 12s");
  });

  it("measures a run still going against the clock", () => {
    const run = makeRun({ startedAt: "2026-01-01T10:00:00.000Z", endedAt: null });
    expect(runDurationMs(run, Date.parse("2026-01-01T10:00:09.000Z"))).toBe(9_000);
  });

  it("has no duration for a run that never started", () => {
    expect(runDurationMs(makeRun({ startedAt: null }), Date.now())).toBeNull();
  });

  it("prints tokens and cost the way the footer reads them", () => {
    expect(formatTokens(912)).toBe("912");
    expect(formatTokens(38_400)).toBe("38.4k");
    expect(formatTokens(3_000)).toBe("3k");
    expect(formatCost(0.27)).toBe("$0.27");
    expect(formatCost(0)).toBe("$0.00");
    // A cost too small to round to a cent says so rather than "$0.00".
    expect(formatCost(0.0004)).toBe("<$0.01");
  });

  it("never prints an effort without the model that spends it", () => {
    expect(formatModel({ model: "claude-opus-5", effort: "medium" })).toBe(
      "claude-opus-5 · medium",
    );
    expect(formatModel({ model: "claude-opus-5", effort: null })).toBe("claude-opus-5");
  });
});

describe("the model a run used", () => {
  const routed = makeProject({
    slug: "paim",
    fieldSchema: [{ key: "layer", type: "select", options: ["api", "ui"], default: "api" }],
    modelRouting: {
      field: "size",
      map: { XS: { model: "claude-haiku-4-5", effort: "low" } },
      fallback: { model: "claude-opus-5", effort: "medium" },
    },
  });

  it("takes the task's own override first (docs/11)", () => {
    const task = makeTask({ size: "XS", model: "claude-fable-5", effort: "max" });
    expect(resolveTaskModel(routed, task)).toEqual({ model: "claude-fable-5", effort: "max" });
  });

  it("routes on the project's field when the task pins nothing", () => {
    expect(resolveTaskModel(routed, makeTask({ size: "XS" }))).toEqual({
      model: "claude-haiku-4-5",
      effort: "low",
    });
  });

  it("falls back for a value the map does not mention", () => {
    expect(resolveTaskModel(routed, makeTask({ size: "L" }))).toEqual({
      model: "claude-opus-5",
      effort: "medium",
    });
  });

  it("routes on a custom field, default included (docs/03 rule 1)", () => {
    const byLayer = makeProject({
      slug: "paim",
      fieldSchema: [{ key: "layer", type: "select", options: ["api", "ui"], default: "api" }],
      modelRouting: {
        field: "layer",
        map: { api: { model: "claude-sonnet-5", effort: "high" } },
        fallback: { model: "claude-opus-5", effort: "medium" },
      },
    });

    expect(resolveTaskModel(byLayer, makeTask({ fields: { layer: "api" } }))).toEqual({
      model: "claude-sonnet-5",
      effort: "high",
    });
    // Nothing stored: the field's default still routes the task.
    expect(resolveTaskModel(byLayer, makeTask({ fields: {} }))).toEqual({
      model: "claude-sonnet-5",
      effort: "high",
    });
  });

  it("mixes an override with a routed value: model pinned, effort routed", () => {
    const task = makeTask({ size: "XS", model: "claude-fable-5" });
    expect(resolveTaskModel(routed, task)).toEqual({ model: "claude-fable-5", effort: "low" });
  });
});

describe("whether Restore is offered", () => {
  it("offers it while the task is unfinished and the capture worked", () => {
    expect(restoreOffer(makeRun({ restorePoint: POINT }), "manual_review")).toEqual({
      state: "offered",
    });
  });

  it("disappears once the task is done — the changes are the product", () => {
    expect(restoreOffer(makeRun({ restorePoint: POINT }), "done")).toEqual({ state: "none" });
  });

  it("states the reason in the control's position when the capture failed", () => {
    const failed = makeRun({
      restorePoint: { ...POINT, available: false, reason: "src could not be read" },
    });
    expect(restoreOffer(failed, "executing")).toEqual({
      state: "unavailable",
      reason: "src could not be read",
    });
  });

  it("offers nothing for a run that wrote nothing", () => {
    expect(restoreOffer(makeRun({ restorePoint: null }), "executing")).toEqual({ state: "none" });
  });

  it("reports what a revert moved", () => {
    expect(
      describeRestore({ performed: true, restored: ["src/app.ts"], deleted: ["src/added.ts"] }),
    ).toBe("1 file restored · 1 removed");
    expect(describeRestore({ performed: true, restored: [], deleted: [] })).toBe(
      "0 files restored",
    );
  });
});

describe("a stream frame", () => {
  const base = makeRun({
    id: "run-stream",
    status: "executing",
    operations: [makeOperation({ kind: "read", id: "op-a", seq: 1 })],
  });

  it("replaces an operation already in the log, in place", () => {
    const changed = { ...base.operations[0]!, status: "failed" as const };
    const next = applyRunFrame(base, { run: { ...base, status: "failed" }, operation: changed });

    expect(next?.status).toBe("failed");
    expect(next?.operations).toHaveLength(1);
    expect(next?.operations[0]?.status).toBe("failed");
  });

  it("inserts a new operation at the position the service assigned", () => {
    const later = makeOperation({ kind: "bash", id: "op-c", seq: 3 });
    const middle = makeOperation({ kind: "edit", id: "op-b", seq: 2 });

    const withLater = applyRunFrame(base, { run: base, operation: later });
    const withBoth = applyRunFrame(withLater, { run: base, operation: middle });

    expect(withBoth?.operations.map((operation) => operation.id)).toEqual([
      "op-a",
      "op-b",
      "op-c",
    ]);
  });

  it("carries a run frame with no operation", () => {
    const next = applyRunFrame(base, { run: { ...base, status: "succeeded" }, operation: null });
    expect(next?.status).toBe("succeeded");
    expect(next?.operations).toHaveLength(1);
  });

  it("ignores a frame for another run, and one with nothing cached", () => {
    expect(applyRunFrame(base, { run: makeRun({ id: "other" }), operation: null })).toBe(base);
    expect(applyRunFrame(undefined, { run: base, operation: null })).toBeUndefined();
  });
});

describe("the run state", () => {
  it("knows which statuses are still moving (docs/09 'Service restart')", () => {
    for (const status of ["queued", "planning", "awaiting_approval", "executing"] as const) {
      expect(isRunActive(status)).toBe(true);
    }
    for (const status of ["succeeded", "failed", "cancelled", "paused", "held_budget"] as const) {
      expect(isRunActive(status)).toBe(false);
    }
  });
});

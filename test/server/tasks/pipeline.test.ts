/**
 * T26 — the pipeline engine: the catalogue as a state machine, the legal /
 * illegal transition matrix, and the failure loop
 * (specs/04-status-pipeline.md, docs/04-status-pipeline.md).
 *
 * Everything here is pure: a task record in, a task record out. The HTTP half
 * — `422 GATE_REQUIRED` on a status written by hand — is in
 * test/server/routes/pipeline.test.ts.
 */

import { describe, expect, it } from "vitest";
import { ApiError } from "../../../src/server/errors.js";
import { advance, checkManualStatusMove, fail } from "../../../src/server/tasks/pipeline.js";
import {
  FAILURE_STATUS,
  STATUS_GATE,
  closedAtFor,
  forwardPath,
  gateOf,
  isLegalManualMove,
  manualMoveTargets,
  nextEnabledStatus,
  nextStatusFor,
} from "../../../src/shared/pipeline.js";
import {
  REQUIRED_STATUSES,
  STATUS_CATALOGUE,
  STATUS_CATEGORY,
  type Status,
} from "../../../src/shared/statuses.js";
import type { Task } from "../../../src/shared/types.js";

/** Every status the catalogue holds — the widest pipeline a project can pick. */
const FULL: Status[] = [...STATUS_CATALOGUE];

/** The five a project must enable, plus `cancelled` (docs/04). */
const MINIMAL: Status[] = ["open_questions", "design", "ready", "executing", "done", "cancelled"];

function task(overrides: Partial<Task> = {}): Task {
  const now = "2026-08-01T10:00:00.000Z";
  return {
    id: "11111111-1111-1111-1111-111111111111",
    key: "FEAT-1",
    projectId: "22222222-2222-2222-2222-222222222222",
    title: "Ship the pipeline",
    description: "",
    status: "ready",
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
    sourcePrompt: "",
    evaluatedAt: null,
    staleReason: null,
    failureReason: null,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
    closedAt: null,
    ...overrides,
  };
}

describe("the catalogue (docs/04 'The catalogue')", () => {
  it("holds the ten statuses in their fixed order", () => {
    expect(STATUS_CATALOGUE).toEqual([
      "backlog",
      "open_questions",
      "design",
      "ready",
      "executing",
      "testing",
      "ai_review",
      "manual_review",
      "done",
      "cancelled",
    ]);
  });

  it("gives every status one of the four categories", () => {
    expect(STATUS_CATEGORY).toEqual({
      backlog: "todo",
      open_questions: "todo",
      design: "todo",
      ready: "todo",
      executing: "in_progress",
      testing: "in_progress",
      ai_review: "in_progress",
      manual_review: "in_progress",
      done: "done",
      cancelled: "cancelled",
    });
  });

  it("requires the five statuses docs/04 names", () => {
    expect([...REQUIRED_STATUSES]).toEqual([
      "open_questions",
      "design",
      "ready",
      "executing",
      "done",
    ]);
  });

  it("names the actor of every gate", () => {
    expect(STATUS_GATE).toEqual({
      backlog: "none",
      open_questions: "user",
      design: "claude",
      ready: "none",
      executing: "run",
      testing: "tests",
      ai_review: "claude",
      manual_review: "user",
      done: "none",
      cancelled: "none",
    });
    // Every status of the catalogue has a gate — no gap the engine could
    // read as `undefined` and treat as "no actor".
    for (const status of STATUS_CATALOGUE) expect(gateOf(status)).toBeTruthy();
  });

  it("sends every failure back to executing", () => {
    expect(FAILURE_STATUS).toBe("executing");
  });
});

describe("the order of the pipeline", () => {
  it("walks the enabled statuses in catalogue order, whatever the caller stored", () => {
    expect(nextEnabledStatus(FULL, "ready")).toBe("executing");
    expect(nextEnabledStatus(FULL, "executing")).toBe("testing");
    expect(nextEnabledStatus(MINIMAL, "executing")).toBe("done");
    expect(nextEnabledStatus(["done", "ready", "executing"], "ready")).toBe("executing");
  });

  it("never proposes cancelled as the next status, so done ends the line", () => {
    expect(nextEnabledStatus(FULL, "done")).toBeNull();
    expect(nextEnabledStatus(FULL, "cancelled")).toBeNull();
  });

  it("skips the statuses this task does not use (docs/04 'available, not mandatory')", () => {
    // No questions and no design options: both gates are behind the task.
    expect(nextStatusFor(task({ status: "backlog" }), FULL)).toBe("ready");
    expect(forwardPath(task({ status: "backlog" }), FULL)).toEqual([
      "open_questions",
      "design",
      "ready",
    ]);
  });

  it("stops at a status the task does use", () => {
    const asked = task({ status: "backlog", questions: [{ id: "q1", text: "Which store?" }] });
    expect(nextStatusFor(asked, FULL)).toBe("open_questions");

    const designed = task({ status: "open_questions", designOptions: [{ id: "d1" }] });
    expect(nextStatusFor(designed, FULL)).toBe("design");
  });
});

describe("advance", () => {
  it("moves a task to the next enabled status", () => {
    expect(advance(task({ status: "ready" }), FULL).status).toBe("executing");
    expect(advance(task({ status: "executing" }), FULL).status).toBe("testing");
  });

  it("moves to the next status the *project* enables, not the next of the catalogue", () => {
    expect(advance(task({ status: "executing" }), MINIMAL).status).toBe("done");
  });

  it("takes a task with no design options from open_questions straight to ready", () => {
    expect(advance(task({ status: "open_questions" }), FULL).status).toBe("ready");
  });

  it("clears the failure reason: it belonged to the run that has now succeeded", () => {
    const failed = task({ status: "executing", failureReason: "2 of 41 tests failed" });
    expect(advance(failed, FULL).failureReason).toBeNull();
  });

  it("stamps closedAt when the task lands in a closed category", () => {
    const at = "2026-08-06T09:00:00.000Z";
    const closed = advance(task({ status: "executing" }), MINIMAL, at);

    expect(closed.status).toBe("done");
    expect(closed.closedAt).toBe(at);
  });

  it("refuses to invent a status past the end of the pipeline", () => {
    const call = () => advance(task({ status: "done" }), FULL);

    expect(call).toThrow(ApiError);
    expect(call).toThrowError(expect.objectContaining({ code: "PIPELINE_TERMINAL", status: 422 }));
  });
});

describe("fail — the one failure path of every gate", () => {
  it("returns the task to executing from wherever the gate was", () => {
    for (const from of ["testing", "ai_review", "manual_review", "design"] as Status[]) {
      expect(fail(task({ status: from }), "did not pass").status).toBe("executing");
    }
  });

  it("stores the reason on the task, for the next run's brief", () => {
    const failed = fail(task({ status: "testing" }), "regression: 2 of 41 tests failed");

    expect(failed.failureReason).toBe("regression: 2 of 41 tests failed");
  });

  it("replaces the reason of an earlier failure", () => {
    const once = fail(task({ status: "testing" }), "first reason");
    const twice = fail({ ...once, status: "manual_review" }, "the button is still misaligned");

    expect(twice.failureReason).toBe("the button is still misaligned");
  });

  it("re-opens a task that had closed", () => {
    const closed = task({ status: "done", closedAt: "2026-08-01T12:00:00.000Z" });

    expect(fail(closed, "shipped the wrong thing").closedAt).toBeNull();
  });

  it("refuses an empty reason — the next run needs one", () => {
    const call = () => fail(task({ status: "testing" }), "   ");

    expect(call).toThrowError(
      expect.objectContaining({ code: "FAILURE_REASON_REQUIRED", status: 422 }),
    );
  });
});

describe("the legal / illegal move matrix (manual status writes)", () => {
  /**
   * The whole matrix for a task that uses neither `open_questions` nor
   * `design`, in a project that enables every status of the catalogue. Every
   * pair (from, to) not listed here is illegal.
   */
  const LEGAL: Record<Status, Status[]> = {
    // No gate: forward, through the two statuses this task does not use.
    backlog: ["open_questions", "design", "ready", "cancelled"],
    // The task carries no question, so the gate has nothing to satisfy.
    open_questions: ["design", "ready", "cancelled"],
    design: ["ready", "cancelled"],
    ready: ["executing", "cancelled"],
    // "The run ends" — an actor's gate: no status write may stand in for it.
    executing: ["cancelled"],
    testing: ["cancelled"],
    ai_review: ["cancelled"],
    manual_review: ["cancelled"],
    // Re-open, to any status of the pipeline that is still open.
    done: [
      "backlog",
      "open_questions",
      "design",
      "ready",
      "executing",
      "testing",
      "ai_review",
      "manual_review",
      "cancelled",
    ],
    cancelled: [],
  };

  it("agrees with the matrix for every pair of the catalogue", () => {
    for (const from of STATUS_CATALOGUE) {
      const subject = task({ status: from });
      expect(manualMoveTargets(subject, FULL), `targets from ${from}`).toEqual(LEGAL[from]);

      for (const to of STATUS_CATALOGUE) {
        const legal = to === from || LEGAL[from].includes(to);
        expect(isLegalManualMove(subject, to, FULL), `${from} -> ${to}`).toBe(legal);
      }
    }
  });

  it("refuses a gate skip with 422 GATE_REQUIRED", () => {
    // The acceptance criterion of specs/04: `ready` to `done` while the
    // project runs its tests.
    const call = () => checkManualStatusMove(task({ status: "ready" }), "done", FULL);

    expect(call).toThrow(ApiError);
    expect(call).toThrowError(
      expect.objectContaining({
        code: "GATE_REQUIRED",
        status: 422,
        details: { from: "ready", to: "done", gate: "none", allowed: ["executing", "cancelled"] },
      }),
    );
  });

  it("refuses the same skip when the project runs no tests at all", () => {
    expect(() => checkManualStatusMove(task({ status: "ready" }), "done", MINIMAL)).toThrowError(
      expect.objectContaining({ code: "GATE_REQUIRED" }),
    );
  });

  it("refuses to stand in for the actor of a gate", () => {
    expect(() =>
      checkManualStatusMove(task({ status: "executing" }), "testing", FULL),
    ).toThrowError(expect.objectContaining({
        code: "GATE_REQUIRED",
        details: expect.objectContaining({ gate: "run" }),
      }));
    expect(() =>
      checkManualStatusMove(task({ status: "manual_review" }), "done", FULL),
    ).toThrowError(expect.objectContaining({
        code: "GATE_REQUIRED",
        details: expect.objectContaining({ gate: "user" }),
      }));
  });

  it("keeps a task with open questions in open_questions", () => {
    const asked = task({ status: "open_questions", questions: [{ id: "q1" }] });

    expect(manualMoveTargets(asked, FULL)).toEqual(["cancelled"]);
    expect(() => checkManualStatusMove(asked, "ready", FULL)).toThrowError(
      expect.objectContaining({
        code: "GATE_REQUIRED",
        details: expect.objectContaining({ gate: "user" }),
      }),
    );
  });

  it("keeps a task that was offered design options in design", () => {
    const offered = task({ status: "design", designOptions: [{ id: "d1", title: "A" }] });

    expect(manualMoveTargets(offered, FULL)).toEqual(["cancelled"]);
  });

  it("allows cancelling from anywhere, and only when the project enables it", () => {
    for (const from of STATUS_CATALOGUE) {
      if (from === "cancelled") continue;
      expect(isLegalManualMove(task({ status: from }), "cancelled", FULL)).toBe(true);
    }

    const noCancel: Status[] = ["backlog", ...REQUIRED_STATUSES];
    expect(manualMoveTargets(task({ status: "executing" }), noCancel)).toEqual([]);
  });

  it("allows a move that repeats the current status", () => {
    expect(() => checkManualStatusMove(task({ status: "executing" }), "executing", FULL)).not.toThrow();
  });
});

describe("closedAt follows the category", () => {
  const now = "2026-08-06T09:00:00.000Z";

  it("stamps a task that closes and keeps the first stamp", () => {
    expect(closedAtFor("done", null, now)).toBe(now);
    expect(closedAtFor("cancelled", "2026-01-01T00:00:00.000Z", now)).toBe(
      "2026-01-01T00:00:00.000Z",
    );
  });

  it("clears the stamp of a task that re-opens", () => {
    expect(closedAtFor("ready", "2026-01-01T00:00:00.000Z", now)).toBeNull();
  });
});

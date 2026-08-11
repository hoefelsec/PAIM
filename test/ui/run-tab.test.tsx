/* The Run tab at `/p/:project/t/:key/run` (T69).
 *
 * Done: "scripted stream renders every operation state; approve from the tab
 * resumes; restore confirmation reverts". The revert against a real temp
 * workspace is test/ui/run-restore.test.tsx — this suite is the tab itself:
 * the log, the colours docs/13 assigns to risk, the limits docs/09 says are
 * stated at the point of use, and the two controls the tab owns.
 *
 * The stream is scripted through `MockEventSource.emitNamed`, because the run
 * stream names its frames (`event: run`, `event: operation`) and a named
 * frame never reaches `onmessage`.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  installApi,
  makeOperation,
  makeProject,
  makeRun,
  makeTask,
  MockEventSource,
  renderApp,
  type FakeApi,
  type FakeError,
  type FakeRestore,
} from "./harness";
import { RUN_STATUS_LABEL } from "../../src/app/run";
import type { TaskView } from "../../src/app/table";
import type { Operation, RestorePoint, RunStatus, RunView } from "../../src/shared/runs.js";

const WORKSPACE = "/Users/edu/Projects/paim";

const PAIM = makeProject({
  slug: "paim",
  name: "PAIM",
  workspacePath: WORKSPACE,
  statuses: ["backlog", "open_questions", "design", "ready", "executing", "done"],
  modelRouting: {
    field: null,
    map: {},
    fallback: { model: "claude-opus-5", effort: "medium" },
  },
});

const POINT: RestorePoint = {
  method: "snapshot",
  available: true,
  reason: null,
  head: null,
  stash: null,
  snapshotDir: "/tmp/restore/run-1",
  createdPaths: ["src/added.ts"],
  capturedAt: "2026-01-01T10:00:00.000Z",
};

const DIFF = [
  "--- src/api/tasks.ts",
  "+++ src/api/tasks.ts",
  "-const next = rows.length ? encodeCursor(rows[0]) : null",
  "+const next = rows.length === limit ? encodeCursor(last) : null",
].join("\n");

const STDOUT = "2 passing";

/** The transcript of the mockup's run: every operation state, all three risks. */
function operations(): Operation[] {
  return [
    makeOperation({ id: "op-grep", seq: 1, kind: "grep", summary: "Grep encodeCursor" }),
    makeOperation({ id: "op-read", seq: 2, kind: "read", summary: "Read src/api/tasks.ts" }),
    makeOperation({
      id: "op-edit",
      seq: 3,
      kind: "edit",
      summary: "Edit src/api/tasks.ts",
      diff: DIFF,
    }),
    makeOperation({
      id: "op-write",
      seq: 4,
      kind: "write",
      summary: "Write src/added.ts",
      status: "failed",
    }),
    makeOperation({
      id: "op-approved",
      seq: 5,
      kind: "edit",
      summary: "Edit src/other.ts",
      status: "approved",
    }),
    makeOperation({
      id: "op-install",
      seq: 6,
      kind: "bash",
      summary: "Bash npm install --save-dev supertest",
    }),
    makeOperation({
      id: "op-test",
      seq: 7,
      kind: "bash",
      summary: "Bash npm test -- tasks/pagination",
      status: "running",
      stdout: STDOUT,
      exitCode: 0,
    }),
    makeOperation({
      id: "op-force",
      seq: 8,
      kind: "bash",
      summary: "Bash git push --force origin fix/cursor",
      status: "denied",
    }),
    makeOperation({
      id: "op-push",
      seq: 9,
      kind: "bash",
      summary: "Bash git push origin fix/cursor",
      status: "proposed",
    }),
  ];
}

function makeTranscript(overrides: Partial<RunView> = {}): RunView {
  return makeRun({
    id: "run-1",
    taskId: "t-3",
    status: "awaiting_approval",
    restorePoint: POINT,
    usage: { inputTokens: 38_400, outputTokens: 3_100, costUsd: 0.27 },
    startedAt: "2026-01-01T10:00:00.000Z",
    endedAt: "2026-01-01T10:01:12.000Z",
    operations: operations(),
    ...overrides,
  });
}

interface Mounted {
  api: FakeApi;
  runs: Record<string, RunView[]>;
  tasks: TaskView[];
  user: ReturnType<typeof userEvent.setup>;
}

function mount(
  options: {
    path?: string;
    run?: Partial<RunView>;
    /** More than one run: the picker appears. */
    extraRuns?: RunView[];
    task?: Partial<TaskView>;
    restore?: FakeRestore;
    rejectControls?: FakeError;
    noRuns?: boolean;
  } = {},
): Mounted {
  const tasks = [
    makeTask({
      id: "t-3",
      key: "FEAT-3",
      title: "Cursor resets after the first page",
      status: "executing",
      ...options.task,
    }),
  ];
  const list = options.noRuns
    ? []
    : [makeTranscript(options.run ?? {}), ...(options.extraRuns ?? [])];
  const runs: Record<string, RunView[]> = { "FEAT-3": list };

  const api = installApi({
    projects: [PAIM],
    tasks: { paim: tasks },
    runs,
    ...(options.restore ? { restore: options.restore } : {}),
    ...(options.rejectControls ? { rejectControls: options.rejectControls } : {}),
  });
  const user = userEvent.setup();
  renderApp(options.path ?? "/p/paim/t/FEAT-3/run");
  return { api, runs, tasks, user };
}

/** Waits for the tab to have settled on a run — or on having none — and
 *  hands the body back. */
async function tab(): Promise<HTMLElement> {
  await waitFor(() => {
    const body = document.querySelector<HTMLElement>("[data-tab='run']");
    expect(body).toBeTruthy();
    const settled =
      body!.querySelector("[data-slot='run-bar']") !== null ||
      (body!.textContent ?? "").includes("has not run yet");
    expect(settled).toBe(true);
  });
  return document.querySelector<HTMLElement>("[data-tab='run']")!;
}

function row(id: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(`[data-operation='${id}']`);
  if (!found) throw new Error(`no operation row ${id}`);
  return found;
}

function slot(parent: HTMLElement, name: string): HTMLElement | null {
  return parent.querySelector<HTMLElement>(`[data-slot='${name}']`);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

/* ── the log ────────────────────────────────────────────────────────────── */

describe("the operation log", () => {
  it("renders every operation state the record can hold", async () => {
    mount();
    await tab();

    await waitFor(() => expect(document.querySelector("[data-slot='operations']")).toBeTruthy());
    const states = [...document.querySelectorAll<HTMLElement>("[data-operation]")].map(
      (node) => node.dataset["status"],
    );
    expect(states).toEqual([
      "done",
      "done",
      "done",
      "failed",
      "approved",
      "done",
      "running",
      "denied",
      "proposed",
    ]);

    // The order is the order the service assigned, not the order of arrival.
    expect(
      [...document.querySelectorAll<HTMLElement>("[data-operation]")].map(
        (node) => node.dataset["operation"],
      ),
    ).toEqual([
      "op-grep",
      "op-read",
      "op-edit",
      "op-write",
      "op-approved",
      "op-install",
      "op-test",
      "op-force",
      "op-push",
    ]);
  });

  it("colours each row by risk, and by nothing else (docs/13)", async () => {
    mount();
    await tab();
    await waitFor(() => expect(document.querySelector("[data-operation]")).toBeTruthy());

    expect(row("op-grep").dataset["risk"]).toBe("safe");
    expect(row("op-edit").dataset["risk"]).toBe("write");
    expect(row("op-install").dataset["risk"]).toBe("exec");

    expect(slot(row("op-grep"), "op-kind")!.style.color).toContain("--color-op-safe");
    expect(slot(row("op-edit"), "op-kind")!.style.color).toContain("--color-op-write");
    expect(slot(row("op-install"), "op-kind")!.style.color).toContain("--color-op-exec");
  });

  it("prints the target once — the badge already says the kind", async () => {
    mount();
    await tab();
    await waitFor(() => expect(document.querySelector("[data-operation]")).toBeTruthy());

    expect(slot(row("op-edit"), "op-summary")!.textContent).toBe("src/api/tasks.ts");
    expect(slot(row("op-edit"), "op-kind")!.textContent).toBe("edit");
  });

  it("shows a write's diff inline, coloured by line", async () => {
    mount();
    await tab();
    await waitFor(() => expect(document.querySelector("[data-slot='op-diff']")).toBeTruthy());

    const diff = slot(row("op-edit"), "op-diff")!;
    expect([...diff.querySelectorAll("[data-diff]")].map((n) => n.getAttribute("data-diff"))).toEqual(
      ["meta", "meta", "del", "add"],
    );
    expect(diff.textContent).toContain("+const next = rows.length === limit");
    // A safe operation carries no diff (docs/09: write and edit only).
    expect(slot(row("op-grep"), "op-diff")).toBeNull();
  });

  it("shows a bash operation's output and its exit code", async () => {
    mount();
    await tab();
    await waitFor(() => expect(document.querySelector("[data-slot='op-stdout']")).toBeTruthy());

    const out = slot(row("op-test"), "op-stdout")!;
    expect(out.textContent).toContain(STDOUT);
    expect(slot(row("op-test"), "op-exit")!.textContent).toBe("exit 0");
  });

  it("strikes a refused row and says what the model did next", async () => {
    mount();
    await tab();
    await waitFor(() => expect(document.querySelector("[data-operation='op-force']")).toBeTruthy());

    const refused = row("op-force");
    expect(slot(refused, "op-summary")!.className).toContain("line-through");
    expect(slot(refused, "op-reason")!.textContent).toMatch(/safety rules/);
    // docs/10 §3: the refusal reaches the model and the run continues.
    expect(slot(refused, "op-adaptation")!.textContent).toContain(
      "It continued with Bash git push origin fix/cursor",
    );
  });

  it("says on the row itself what Restore cannot undo (docs/09)", async () => {
    mount();
    await tab();
    await waitFor(() => expect(document.querySelector("[data-operation='op-install']")).toBeTruthy());

    expect(slot(row("op-install"), "op-irreversible")!.textContent).toContain(
      "Restore can’t undo this",
    );
    // A refused command installed nothing, so its row claims nothing.
    expect(slot(row("op-force"), "op-irreversible")).toBeNull();
    // A file write is exactly what Restore reverts.
    expect(slot(row("op-edit"), "op-irreversible")).toBeNull();
  });
});

/* ── the bar and the foot ───────────────────────────────────────────────── */

describe("the run state bar", () => {
  it("shows the status, the counts, and the workspace the run acted on", async () => {
    mount();
    const body = await tab();

    const bar = slot(body, "run-bar")!;
    expect(slot(bar, "run-state")!.textContent).toContain(RUN_STATUS_LABEL.awaiting_approval);
    expect(slot(bar, "run-meta")!.textContent).toBe(
      "9 operations · 4 done · 1 failed · 1 refused · 1 awaiting you",
    );
    expect(slot(bar, "workspace-path")!.textContent).toBe(WORKSPACE);
  });

  it("prints model · duration · tokens · cost in the runfoot", async () => {
    mount();
    const body = await tab();

    expect(slot(body, "runfoot")!.textContent).toBe(
      "claude-opus-5 · medium · 1m 12s · 38.4k in / 3.1k out · $0.27",
    );
  });

  it("says a task has not run rather than showing an empty log", async () => {
    mount({ noRuns: true });
    const body = await tab();

    expect(body.textContent).toContain("This task has not run yet.");
    expect(slot(body, "operations")).toBeNull();
  });

  it("switches between the runs of one task", async () => {
    const older = makeRun({
      id: "run-0",
      status: "failed",
      createdAt: "2025-12-01T10:00:00.000Z",
      operations: [makeOperation({ id: "op-old", kind: "read", summary: "Read old.ts" })],
    });
    const { user } = mount({ extraRuns: [older] });
    await tab();
    await waitFor(() => expect(document.querySelector("[data-slot='run-picker']")).toBeTruthy());

    await user.click(document.querySelector<HTMLElement>("[data-run='run-0']")!);

    await waitFor(() => expect(document.querySelector("[data-operation='op-old']")).toBeTruthy());
    expect(document.querySelector("[data-operation='op-grep']")).toBeNull();
  });
});

/* ── approve and deny ───────────────────────────────────────────────────── */

describe("answering a parked operation", () => {
  it("approves from the tab, and the run resumes", async () => {
    const { api, user } = mount();
    await tab();
    await waitFor(() => expect(document.querySelector("[data-operation='op-push']")).toBeTruthy());

    // Only the parked row carries controls.
    expect(screen.getAllByRole("button", { name: "Approve" })).toHaveLength(1);
    expect(within(row("op-grep")).queryByRole("button", { name: "Approve" })).toBeNull();

    await user.click(within(row("op-push")).getByRole("button", { name: "Approve" }));

    await waitFor(() => expect(api.controls).toHaveLength(1));
    expect(api.controls[0]).toEqual({
      path: "/api/runs/run-1/approve",
      body: { operationIds: ["op-push"] },
    });

    // The answer settles the operation and the run carries on (docs/10 §4).
    await waitFor(() => expect(row("op-push").dataset["status"]).toBe("running"));
    await waitFor(() =>
      expect(slot(document.querySelector<HTMLElement>("[data-tab='run']")!, "run-state")!.textContent)
        .toContain(RUN_STATUS_LABEL.executing),
    );
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
  });

  it("denies with a reason, and the row keeps the reason it sent", async () => {
    const { api, user } = mount();
    await tab();
    await waitFor(() => expect(document.querySelector("[data-operation='op-push']")).toBeTruthy());

    await user.click(within(row("op-push")).getByRole("button", { name: "Deny" }));
    await user.type(
      screen.getByRole("textbox", { name: "Why Bash git push origin fix/cursor is refused" }),
      "we do not push from a run",
    );
    await user.click(screen.getByRole("button", { name: "Refuse" }));

    await waitFor(() => expect(api.controls).toHaveLength(1));
    expect(api.controls[0]).toEqual({
      path: "/api/runs/run-1/deny",
      body: { operationId: "op-push", reason: "we do not push from a run" },
    });

    await waitFor(() => expect(row("op-push").dataset["status"]).toBe("denied"));
    expect(slot(row("op-push"), "op-reason")!.textContent).toBe("we do not push from a run");
    expect(slot(row("op-push"), "op-summary")!.className).toContain("line-through");
  });

  it("keeps the row untouched when the deny box is cancelled", async () => {
    const { api, user } = mount();
    await tab();
    await waitFor(() => expect(document.querySelector("[data-operation='op-push']")).toBeTruthy());

    await user.click(within(row("op-push")).getByRole("button", { name: "Deny" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(api.controls).toHaveLength(0);
    expect(row("op-push").dataset["status"]).toBe("proposed");
  });

  it("says so when the service refuses the answer", async () => {
    const { user } = mount({
      rejectControls: {
        status: 409,
        code: "OPERATION_NOT_AWAITING_APPROVAL",
        message: "Operation \"op-push\" is \"denied\" and is not waiting for an answer",
      },
    });
    await tab();
    await waitFor(() => expect(document.querySelector("[data-operation='op-push']")).toBeTruthy());

    await user.click(within(row("op-push")).getByRole("button", { name: "Approve" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("is not waiting for an answer");
  });
});

/* ── Restore ────────────────────────────────────────────────────────────── */

describe("Restore", () => {
  it("confirms before it reverts, and names what it cannot undo", async () => {
    const { api, user } = mount({
      restore: { method: "snapshot", restored: ["src/api/tasks.ts"], deleted: ["src/added.ts"] },
    });
    const body = await tab();

    await user.click(within(body).getByRole("button", { name: /Restore/ }));

    const dialog = screen.getByRole("dialog", { name: "Restore the workspace" });
    // docs/09: "The cancel dialog names the side effect that neither action
    // can revert." The same rule applies where Restore is offered.
    expect(slot(dialog, "restore-limit")!.textContent).toContain(
      "Bash npm install --save-dev supertest",
    );
    expect(api.controls).toHaveLength(0);

    await user.click(within(dialog).getByRole("button", { name: "Restore the workspace" }));

    await waitFor(() => expect(api.controls).toHaveLength(1));
    expect(api.controls[0]!.path).toBe("/api/runs/run-1/restore");
    await waitFor(() =>
      expect(
        slot(document.querySelector<HTMLElement>("[data-tab='run']")!, "restore-done")!.textContent,
      ).toContain("1 file restored · 1 removed"),
    );
  });

  it("reverts nothing when the confirmation is declined", async () => {
    const { api, user } = mount();
    const body = await tab();

    await user.click(within(body).getByRole("button", { name: /Restore/ }));
    await user.click(screen.getByRole("button", { name: "Keep the changes" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(api.controls).toHaveLength(0);
  });

  it("states the reason in the control's position when the capture failed", async () => {
    mount({
      run: {
        restorePoint: { ...POINT, available: false, reason: "src could not be read" },
      },
    });
    const body = await tab();

    expect(within(body).queryByRole("button", { name: /Restore/ })).toBeNull();
    expect(slot(body, "restore-unavailable")!.textContent).toContain("src could not be read");
  });

  it("disappears once the task is done", async () => {
    mount({ task: { status: "done" } });
    const body = await tab();

    expect(within(body).queryByRole("button", { name: /Restore/ })).toBeNull();
    expect(slot(body, "restore-unavailable")).toBeNull();
  });
});

/* ── the stream ─────────────────────────────────────────────────────────── */

describe("the run stream", () => {
  function stream(): MockEventSource {
    const source = MockEventSource.find("/api/runs/run-1/stream");
    if (!source) throw new Error("the tab opened no run stream");
    return source;
  }

  it("opens one stream for the run it is showing", async () => {
    mount();
    await tab();
    await waitFor(() => expect(MockEventSource.find("/api/runs/run-1/stream")).toBeTruthy());
  });

  it("folds an operation frame into the log without re-reading it", async () => {
    const { api } = mount();
    await tab();
    await waitFor(() => expect(document.querySelector("[data-operation='op-test']")).toBeTruthy());
    const reads = api.calls.filter((path) => path === "/api/runs/run-1").length;

    const run = makeTranscript();
    act(() => {
      stream().emitNamed("operation", {
        run: { ...run, status: "executing" },
        operation: { ...run.operations[6]!, status: "done", exitCode: 0 },
      });
    });

    await waitFor(() => expect(row("op-test").dataset["status"]).toBe("done"));
    // The frame carried the change; nothing re-read the whole log.
    expect(api.calls.filter((path) => path === "/api/runs/run-1")).toHaveLength(reads);
  });

  it("appends an operation the log had never seen", async () => {
    mount();
    await tab();
    await waitFor(() => expect(document.querySelector("[data-operation='op-push']")).toBeTruthy());

    const run = makeTranscript();
    act(() => {
      stream().emitNamed("operation", {
        run,
        operation: makeOperation({
          id: "op-new",
          seq: 10,
          kind: "read",
          summary: "Read src/index.ts",
          status: "running",
        }),
      });
    });

    await waitFor(() => expect(document.querySelector("[data-operation='op-new']")).toBeTruthy());
    expect(row("op-new").dataset["status"]).toBe("running");
  });

  it("moves the state bar on a run frame", async () => {
    mount();
    const body = await tab();

    act(() => {
      stream().emitNamed("run", {
        run: { ...makeTranscript(), status: "succeeded" },
        operation: null,
      });
    });

    await waitFor(() =>
      expect(slot(body, "run-state")!.textContent).toContain(RUN_STATUS_LABEL.succeeded),
    );
  });

  it("drops a malformed frame instead of failing", async () => {
    mount();
    const body = await tab();

    act(() => {
      // `undefined` does not survive JSON, so the listener gets a frame it
      // cannot parse — exactly what a truncated write off the wire looks like.
      stream().emitNamed("run", undefined);
    });

    expect(slot(body, "run-state")!.textContent).toContain(RUN_STATUS_LABEL.awaiting_approval);
  });

  /**
   * The Done line of T69: "scripted stream renders every operation state". So
   * this starts from a run that has proposed nothing and drives the whole log
   * over the wire — no refetch, no fixture already in the state under test.
   */
  it("renders every state an operation passes through, frame by frame", async () => {
    mount({ run: { status: "planning", operations: [], startedAt: null, endedAt: null } });
    const body = await tab();
    expect(body.textContent).toContain("The agent has proposed nothing yet.");

    const record = makeTranscript({ operations: [], startedAt: null, endedAt: null });
    const frame = (operation: Operation, status: RunStatus): void => {
      act(() => {
        stream().emitNamed("operation", { run: { ...record, status }, operation });
      });
    };
    const push = makeOperation({
      id: "op-push",
      seq: 1,
      kind: "bash",
      summary: "Bash git push origin fix/cursor",
      status: "proposed",
    });

    // proposed — the one state with controls, and the only one that parks the
    // run on an answer.
    frame(push, "awaiting_approval");
    await waitFor(() => expect(row("op-push").dataset["status"]).toBe("proposed"));
    expect(within(row("op-push")).getByRole("button", { name: "Approve" })).toBeTruthy();
    expect(slot(row("op-push"), "op-note")!.textContent).toBe("waiting for you");
    expect(slot(body, "run-meta")!.textContent).toBe("1 operation · 1 awaiting you");

    // approved — settled, not yet started: no controls, and no ✓ either.
    frame({ ...push, status: "approved" }, "executing");
    await waitFor(() => expect(row("op-push").dataset["status"]).toBe("approved"));
    expect(slot(row("op-push"), "op-status-label")!.textContent).toBe("approved");
    expect(within(row("op-push")).queryByRole("button", { name: "Approve" })).toBeNull();

    // running — the shell command is in flight, and the row already states
    // what Restore will not be able to undo (docs/09).
    frame({ ...push, status: "running" }, "executing");
    await waitFor(() => expect(row("op-push").dataset["status"]).toBe("running"));
    expect(slot(row("op-push"), "op-status-label")!.textContent).toBe("running");
    expect(slot(row("op-push"), "op-irreversible")).toBeTruthy();

    // done — with the output the frame carried.
    frame({ ...push, status: "done", stdout: "Everything up-to-date", exitCode: 0 }, "executing");
    await waitFor(() => expect(row("op-push").dataset["status"]).toBe("done"));
    expect(slot(row("op-push"), "op-status-label")!.textContent).toContain("done");
    expect(slot(row("op-push"), "op-stdout")!.textContent).toContain("Everything up-to-date");

    // denied — struck through, with the reason and, once the next operation
    // arrives, what the model did instead (docs/10 §3).
    const force = makeOperation({
      id: "op-force",
      seq: 2,
      kind: "bash",
      summary: "Bash git push --force origin fix/cursor",
      status: "denied",
    });
    frame(force, "executing");
    await waitFor(() => expect(row("op-force").dataset["status"]).toBe("denied"));
    expect(slot(row("op-force"), "op-summary")!.className).toContain("line-through");
    expect(slot(row("op-force"), "op-adaptation")!.textContent).toContain(
      "The run has proposed nothing since",
    );

    // failed — and the refusal above it now names it as the adaptation.
    const write = makeOperation({
      id: "op-write",
      seq: 3,
      kind: "write",
      summary: "Write src/added.ts",
      status: "failed",
    });
    frame(write, "executing");
    await waitFor(() => expect(row("op-write").dataset["status"]).toBe("failed"));
    expect(slot(row("op-write"), "op-status-label")!.textContent).toBe("failed");
    expect(slot(row("op-force"), "op-adaptation")!.textContent).toContain(
      "It continued with Write src/added.ts",
    );

    // Every state of docs/09 "Records", in the order the run reached them.
    expect(
      [...document.querySelectorAll<HTMLElement>("[data-operation]")].map(
        (node) => node.dataset["status"],
      ),
    ).toEqual(["done", "denied", "failed"]);
    expect(slot(body, "run-meta")!.textContent).toBe(
      "3 operations · 1 done · 1 failed · 1 refused",
    );

    act(() => {
      stream().emitNamed("run", { run: { ...record, status: "succeeded" }, operation: null });
    });
    await waitFor(() =>
      expect(slot(body, "run-state")!.textContent).toContain(RUN_STATUS_LABEL.succeeded),
    );
  });
});

/* ── the tab in the task view ───────────────────────────────────────────── */

describe("the tab row", () => {
  it("is reached from its own address, and from the tab", async () => {
    const { user } = mount({ path: "/p/paim/t/FEAT-3" });
    await waitFor(() => expect(document.querySelector("[data-tab='overview']")).toBeTruthy());

    await user.click(screen.getByRole("button", { name: "Run" }));

    await waitFor(() => expect(window.location.pathname).toBe("/p/paim/t/FEAT-3/run"));
    await tab();

    await user.click(screen.getByRole("button", { name: "Overview" }));
    await waitFor(() => expect(window.location.pathname).toBe("/p/paim/t/FEAT-3"));
    expect(document.querySelector("[data-tab='run']")).toBeNull();
  });

  it("keeps the properties column beside the log", async () => {
    mount();
    await tab();

    expect(document.querySelector("[data-property='status']")).toBeTruthy();
  });
});

describe("the R shortcut", () => {
  it("queues a run and opens the tab (docs/07 'Keyboard')", async () => {
    const { api, user } = mount({ path: "/p/paim/t/FEAT-3", noRuns: true });
    await waitFor(() => expect(document.querySelector("[data-tab='overview']")).toBeTruthy());

    await user.keyboard("r");

    await waitFor(() => expect(api.controls).toHaveLength(1));
    expect(api.controls[0]!.path).toBe("/api/projects/paim/tasks/FEAT-3/runs");
    await waitFor(() => expect(window.location.pathname).toBe("/p/paim/t/FEAT-3/run"));
  });

  it("does not fire while a value is being edited", async () => {
    const { api, user } = mount({ path: "/p/paim/t/FEAT-3", noRuns: true });
    await waitFor(() => expect(document.querySelector("[data-tab='overview']")).toBeTruthy());

    await user.click(document.querySelector<HTMLElement>("[data-edit='assignee']")!);
    await user.type(screen.getByRole("textbox", { name: "Assignee of FEAT-3" }), "rr");

    expect(api.controls).toHaveLength(0);
  });

  it("shows the reason when the service refuses to start one", async () => {
    const { user } = mount({
      path: "/p/paim/t/FEAT-3",
      noRuns: true,
      rejectControls: {
        status: 422,
        code: "NO_WORKSPACE",
        message: 'Project "paim" has no workspace path',
      },
    });
    await waitFor(() => expect(document.querySelector("[data-tab='overview']")).toBeTruthy());

    await user.keyboard("r");

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("has no workspace path");
  });
});

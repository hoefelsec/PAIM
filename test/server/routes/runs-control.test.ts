/**
 * The run control endpoints (T56; docs/06 "Runs", docs/09-ai-run.md,
 * docs/10-execution-safety.md §3–§4):
 *
 *   POST /api/runs/:run/approve   { operationIds }
 *   POST /api/runs/:run/deny      { operationId, reason }
 *   POST /api/runs/:run/pause
 *   POST /api/runs/:run/resume
 *   POST /api/runs/:run/cancel    { restore }
 *
 * Every run here is driven by a scripted agent (`createFakeAgent`), so no
 * test reaches the Agent SDK, the network or a credential. The transcript is
 * what makes the timing deterministic: a step's `onDecision` hook lets a test
 * hold a run in the middle of one operation, control it, and then watch where
 * it stops.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type Database from "better-sqlite3";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../../src/server/app.js";
import { openDatabase } from "../../../src/server/db/index.js";
import { getRunById, updateRun } from "../../../src/server/db/runs.js";
import { clearValidatorCache } from "../../../src/server/fields/validator.js";
import { clearVersionCache } from "../../../src/server/projects/version.js";
import type { Agent } from "../../../src/server/runs/agent.js";
import {
  createFakeAgent,
  type FakeAgent,
  type FakeAgentScript,
} from "../../../src/server/runs/fakeAgent.js";
import type { Operation, Run, RunView } from "../../../src/shared/runs.js";
import type { ProjectView, Task } from "../../../src/shared/types.js";

const HEADERS = { host: "localhost:4400" };

const ALLOW_ALL = { denyList: [], mode: "allow_all", askList: [] };
const ASK_ALL = { denyList: [], mode: "ask_all", askList: [] };

let dir: string;
let workspace: string;
let db: Database.Database;
let app: FastifyInstance;
/**
 * What each run is driven by, in the order the runs start: a transcript for
 * the scripted agent, or a whole agent for the one case the script cannot
 * express (two tools proposed at once).
 */
let scripts: (FakeAgentScript | Agent)[];
let agents: FakeAgent[];

function build(options: { autoStart?: boolean } = {}): FastifyInstance {
  return createApp({
    db,
    runs: {
      autoStart: options.autoStart ?? true,
      createAgent: () => {
        const next = scripts.shift();
        if (next !== undefined && "run" in next) return next;
        const agent = createFakeAgent(next ?? {});
        agents.push(agent);
        return agent;
      },
    },
  });
}

/**
 * An agent that asks for several tools at once, the way the SDK does when the
 * model emits parallel tool calls. The scripted agent is sequential by
 * design, so this is what puts two operations in the parking lot together.
 */
function parallelAgent(
  calls: { toolUseId: string; name: string; input: Record<string, unknown> }[],
): Agent {
  return {
    async *run(request) {
      const decisions = await Promise.all(
        calls.map((call) =>
          request.canUseTool(call.name, call.input, {
            toolUseId: call.toolUseId,
            ...(request.signal ? { signal: request.signal } : {}),
          }),
        ),
      );

      for (const [index, call] of calls.entries()) {
        const decision = decisions[index]!;
        yield {
          type: "tool_result",
          toolUseId: call.toolUseId,
          text: decision.behavior === "deny" ? decision.message : "ok",
          isError: decision.behavior === "deny",
          stdout: null,
          exitCode: null,
        };
      }

      yield {
        type: "result",
        ok: true,
        usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
        errorMessage: null,
      };
    },
  };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "paim-run-control-"));
  workspace = mkdtempSync(join(tmpdir(), "paim-workspace-"));
  db = openDatabase(join(dir, "paim.db"));
  scripts = [];
  agents = [];
  app = build();
  clearVersionCache();
  clearValidatorCache();
});

afterEach(async () => {
  await app.close();
  db.close();
  rmSync(dir, { recursive: true, force: true });
  rmSync(workspace, { recursive: true, force: true });
});

async function createProject(body: Record<string, unknown> = {}): Promise<ProjectView> {
  const res = await app.inject({
    method: "POST",
    url: "/api/projects",
    headers: HEADERS,
    payload: {
      name: `PAIM ${Math.random().toString(36).slice(2, 8)}`,
      workspacePath: workspace,
      ...body,
    },
  });
  expect(res.statusCode).toBe(201);
  return res.json().data as ProjectView;
}

async function createTask(slug: string, body: Record<string, unknown> = {}): Promise<Task> {
  const res = await app.inject({
    method: "POST",
    url: `/api/projects/${slug}/tasks`,
    headers: HEADERS,
    payload: { title: "Add the control endpoints", ...body },
  });
  expect(res.statusCode).toBe(201);
  return res.json().data as Task;
}

async function startRun(slug: string, key: string): Promise<Run> {
  const res = await app.inject({
    method: "POST",
    url: `/api/projects/${slug}/tasks/${key}/runs`,
    headers: HEADERS,
    payload: {},
  });
  expect(res.statusCode).toBe(201);
  return res.json().data as Run;
}

function post(url: string, payload: Record<string, unknown> = {}) {
  return app.inject({ method: "POST", url, headers: HEADERS, payload });
}

async function readRun(runId: string): Promise<RunView> {
  const res = await app.inject({ method: "GET", url: `/api/runs/${runId}`, headers: HEADERS });
  expect(res.statusCode).toBe(200);
  return res.json().data as RunView;
}

/** Spins the event loop until `predicate` holds of the stored run. */
async function waitForRun(
  runId: string,
  predicate: (run: RunView) => boolean,
  label: string,
): Promise<RunView> {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const run = await readRun(runId);
    if (predicate(run)) return run;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`timed out waiting for ${label}`);
}

/** The operation the run is parked on, once it has parked. */
async function waitForProposed(runId: string): Promise<Operation> {
  const run = await waitForRun(
    runId,
    (view) => view.operations.some((operation) => operation.status === "proposed"),
    "an operation to park",
  );
  return run.operations.find((operation) => operation.status === "proposed")!;
}

interface Deferred {
  promise: Promise<void>;
  resolve(): void;
}

function deferred(): Deferred {
  let resolve = (): void => {};
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

// ---------------------------------------------------------------------------
// Approve
// ---------------------------------------------------------------------------

describe("POST /api/runs/:run/approve", () => {
  it("resumes a parked operation and lets the run finish", async () => {
    // docs/10 §4: ask_all stops every operation, including a read, and the
    // approval has no time limit — the run holds `awaiting_approval` until
    // this endpoint answers.
    const project = await createProject({ safety: ASK_ALL });
    const task = await createTask(project.slug);
    scripts.push({
      steps: [{ name: "Read", input: { file_path: "src/app.ts" }, outcome: { text: "body" } }],
      result: { usage: { inputTokens: 12, outputTokens: 4, costUsd: 0.002 } },
    });

    const run = await startRun(project.slug, task.key);
    const parked = await waitForProposed(run.id);
    expect((await readRun(run.id)).status).toBe("awaiting_approval");

    const res = await post(`/api/runs/${run.id}/approve`, { operationIds: [parked.id] });

    expect(res.statusCode).toBe(200);
    expect(res.json().approved).toEqual([parked.id]);

    await app.runQueue.idle();
    const finished = await readRun(run.id);
    expect(finished.status).toBe("succeeded");
    expect(finished.usage).toEqual({ inputTokens: 12, outputTokens: 4, costUsd: 0.002 });
    expect(finished.operations).toHaveLength(1);
    expect(finished.operations[0]).toMatchObject({
      id: parked.id,
      summary: "Read src/app.ts",
      status: "done",
      stdout: "body",
    });
  });

  it("answers two operations parked at the same time in one request", async () => {
    // `{ operationIds: [ … ] }` is a list because an agent can ask for two
    // tools at once. This one does, so both park together and one request
    // answers both.
    const project = await createProject({
      safety: { denyList: [], mode: "ask_listed", askList: ["*.env"] },
    });
    const task = await createTask(project.slug);
    scripts.push(
      parallelAgent([
        { toolUseId: "tool_use_1", name: "Write", input: { file_path: "a.env", content: "A=1" } },
        { toolUseId: "tool_use_2", name: "Write", input: { file_path: "b.env", content: "B=2" } },
      ]),
    );

    const run = await startRun(project.slug, task.key);
    const parked = await waitForRun(
      run.id,
      (view) => view.operations.filter((operation) => operation.status === "proposed").length === 2,
      "both operations to park",
    );
    expect(parked.status).toBe("awaiting_approval");
    const ids = parked.operations.map((operation) => operation.id);

    const res = await post(`/api/runs/${run.id}/approve`, { operationIds: ids });

    expect(res.statusCode).toBe(200);
    expect(res.json().approved).toEqual(ids);

    await app.runQueue.idle();
    const finished = await readRun(run.id);
    expect(finished.status).toBe("succeeded");
    expect(finished.operations.map((operation) => operation.summary)).toEqual([
      "Write a.env",
      "Write b.env",
    ]);
    expect(finished.operations.map((operation) => operation.status)).toEqual(["done", "done"]);
  });

  it("answers one parked operation after another", async () => {
    // Two writes, both on the ask list, parked one after the other.
    const project = await createProject({
      safety: { denyList: [], mode: "ask_listed", askList: ["*.env"] },
    });
    const task = await createTask(project.slug);
    const first = deferred();
    const second = deferred();
    scripts.push({
      steps: [
        {
          name: "Write",
          input: { file_path: "a.env", content: "A=1" },
          onDecision: () => {
            first.resolve();
          },
        },
        {
          name: "Write",
          input: { file_path: "b.env", content: "B=2" },
          onDecision: () => {
            second.resolve();
          },
        },
      ],
    });

    const run = await startRun(project.slug, task.key);
    const parkedA = await waitForProposed(run.id);

    // Approving the first lets the transcript reach the second, which parks
    // in its turn; then one request answers what is left.
    const res = await post(`/api/runs/${run.id}/approve`, { operationIds: [parkedA.id] });
    expect(res.statusCode).toBe(200);
    await first.promise;

    const parkedB = await waitForProposed(run.id);
    expect(parkedB.id).not.toBe(parkedA.id);
    const both = await post(`/api/runs/${run.id}/approve`, { operationIds: [parkedB.id] });
    expect(both.json().approved).toEqual([parkedB.id]);
    await second.promise;

    await app.runQueue.idle();
    const finished = await readRun(run.id);
    expect(finished.status).toBe("succeeded");
    expect(finished.operations.map((operation) => operation.status)).toEqual(["done", "done"]);
  });

  it("404s for an operation this run does not have, and answers nothing", async () => {
    const project = await createProject({ safety: ASK_ALL });
    const task = await createTask(project.slug);
    scripts.push({ steps: [{ name: "Read", input: { file_path: "src/app.ts" } }] });

    const run = await startRun(project.slug, task.key);
    const parked = await waitForProposed(run.id);

    const res = await post(`/api/runs/${run.id}/approve`, {
      operationIds: [parked.id, "6f1c4c2e-0000-4000-8000-000000000000"],
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("OPERATION_NOT_FOUND");
    // The valid id in the same request was not answered either.
    expect((await readRun(run.id)).status).toBe("awaiting_approval");
    expect((await readRun(run.id)).operations[0]!.status).toBe("proposed");

    await post(`/api/runs/${run.id}/cancel`, {});
    await app.runQueue.idle();
  });

  it("409s when the named operation is not waiting for an answer", async () => {
    const project = await createProject({ safety: ASK_ALL });
    const task = await createTask(project.slug);
    scripts.push({
      steps: [
        { name: "Read", input: { file_path: "a.ts" } },
        { name: "Read", input: { file_path: "b.ts" } },
      ],
    });

    const run = await startRun(project.slug, task.key);
    const parked = await waitForProposed(run.id);
    expect(
      (await post(`/api/runs/${run.id}/approve`, { operationIds: [parked.id] })).statusCode,
    ).toBe(200);

    const again = await post(`/api/runs/${run.id}/approve`, { operationIds: [parked.id] });
    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe("OPERATION_NOT_AWAITING_APPROVAL");

    await post(`/api/runs/${run.id}/cancel`, {});
    await app.runQueue.idle();
  });

  it("refuses a request that names no operation", async () => {
    const project = await createProject({ safety: ASK_ALL });
    const task = await createTask(project.slug);
    scripts.push({ steps: [{ name: "Read", input: { file_path: "a.ts" } }] });
    const run = await startRun(project.slug, task.key);
    await waitForProposed(run.id);

    for (const payload of [{}, { operationIds: [] }, { operationIds: "one" }]) {
      const res = await post(`/api/runs/${run.id}/approve`, payload);
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatchObject({
        code: "VALIDATION_FAILED",
        details: { field: "operationIds" },
      });
    }

    await post(`/api/runs/${run.id}/cancel`, {});
    await app.runQueue.idle();
  });

  it("409s once the run is finished", async () => {
    const project = await createProject({ safety: ALLOW_ALL });
    const task = await createTask(project.slug);
    scripts.push({ steps: [{ name: "Read", input: { file_path: "a.ts" } }] });

    const run = await startRun(project.slug, task.key);
    await app.runQueue.idle();
    const finished = await readRun(run.id);
    expect(finished.status).toBe("succeeded");

    const res = await post(`/api/runs/${run.id}/approve`, {
      operationIds: [finished.operations[0]!.id],
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatchObject({
      code: "RUN_NOT_ACTIVE",
      details: { status: "succeeded" },
    });
  });
});

// ---------------------------------------------------------------------------
// Deny
// ---------------------------------------------------------------------------

describe("POST /api/runs/:run/deny", () => {
  it("returns the reason to the model and the run adapts", async () => {
    // docs/10 §3 and §4: "The ask list asks. It does not refuse." The user
    // refuses this one operation with a reason, the model selects a different
    // method, and the run finishes — "a denied command must not end the run".
    const project = await createProject({
      safety: { denyList: [], mode: "ask_listed", askList: ["rm *"] },
    });
    const task = await createTask(project.slug);
    scripts.push({
      steps: [
        { name: "Bash", input: { command: "rm -r build" } },
        {
          name: "Bash",
          input: { command: "npm run clean" },
          outcome: { stdout: "cleaned", exitCode: 0 },
        },
      ],
      result: { usage: { inputTokens: 20, outputTokens: 8, costUsd: 0.004 } },
    });

    const run = await startRun(project.slug, task.key);
    const parked = await waitForProposed(run.id);
    expect(parked).toMatchObject({ kind: "bash", risk: "exec", summary: "Bash rm -r build" });

    const res = await post(`/api/runs/${run.id}/deny`, {
      operationId: parked.id,
      reason: "delete it yourself",
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ denied: parked.id, reason: "delete it yourself" });

    await app.runQueue.idle();
    const finished = await readRun(run.id);
    // The run continued and succeeded, and the log holds both operations in
    // the order they happened: the refusal, then the alternative.
    expect(finished.status).toBe("succeeded");
    expect(finished.operations.map((operation) => operation.summary)).toEqual([
      "Bash rm -r build",
      "Bash npm run clean",
    ]);
    expect(finished.operations.map((operation) => operation.status)).toEqual(["denied", "done"]);
    expect(finished.operations[0]).toMatchObject({ stdout: null, exitCode: null });
    expect(finished.operations[1]).toMatchObject({ stdout: "cleaned", exitCode: 0 });

    // The refusal, with its reason, is what the model was handed.
    expect(agents[0]!.decisions[0]).toEqual({ behavior: "deny", message: "delete it yourself" });
  });

  it("sends a reason of its own when the caller gives none", async () => {
    const project = await createProject({ safety: ASK_ALL });
    const task = await createTask(project.slug);
    scripts.push({ steps: [{ name: "Read", input: { file_path: "a.ts" } }] });

    const run = await startRun(project.slug, task.key);
    const parked = await waitForProposed(run.id);

    const res = await post(`/api/runs/${run.id}/deny`, { operationId: parked.id });
    expect(res.statusCode).toBe(200);

    await app.runQueue.idle();
    expect((agents[0]!.decisions[0] as { message: string }).message).toMatch(/denied/i);
    expect((await readRun(run.id)).operations[0]!.status).toBe("denied");
  });

  it("refuses a request with no operationId, and 404s an unknown one", async () => {
    const project = await createProject({ safety: ASK_ALL });
    const task = await createTask(project.slug);
    scripts.push({ steps: [{ name: "Read", input: { file_path: "a.ts" } }] });
    const run = await startRun(project.slug, task.key);
    await waitForProposed(run.id);

    const missing = await post(`/api/runs/${run.id}/deny`, { reason: "no" });
    expect(missing.statusCode).toBe(400);
    expect(missing.json().error.details).toMatchObject({ field: "operationId" });

    const unknown = await post(`/api/runs/${run.id}/deny`, { operationId: "nope" });
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json().error.code).toBe("OPERATION_NOT_FOUND");

    await post(`/api/runs/${run.id}/cancel`, {});
    await app.runQueue.idle();
  });
});

// ---------------------------------------------------------------------------
// Pause and resume
// ---------------------------------------------------------------------------

describe("POST /api/runs/:run/pause", () => {
  it("stops at the end of the current operation, never in the middle of it", async () => {
    // docs/09: "Pause — the run stops at the end of the current operation. It
    // can resume." The pause is requested while the first operation is still
    // running, so this test shows both halves: that operation finishes, and
    // the second one never starts.
    const project = await createProject({ safety: ALLOW_ALL });
    const task = await createTask(project.slug);
    const reachedFirst = deferred();
    const paused = deferred();
    scripts.push({
      steps: [
        {
          name: "Read",
          input: { file_path: "a.ts" },
          outcome: { text: "first" },
          onDecision: async () => {
            reachedFirst.resolve();
            await paused.promise;
          },
        },
        { name: "Read", input: { file_path: "b.ts" }, outcome: { text: "second" } },
      ],
    });

    const run = await startRun(project.slug, task.key);
    await reachedFirst.promise;

    const res = await post(`/api/runs/${run.id}/pause`, {});
    expect(res.statusCode).toBe(200);
    // Recorded, not effective yet: an operation is in flight.
    expect(res.json().paused).toBe(false);

    // Let the first operation report back.
    paused.resolve();

    const stopped = await waitForRun(
      run.id,
      (view) => view.status === "paused",
      "the run to pause",
    );
    expect(stopped.operations).toHaveLength(1);
    expect(stopped.operations[0]).toMatchObject({
      summary: "Read a.ts",
      status: "done",
      stdout: "first",
    });
    expect(stopped.endedAt).toBeNull();

    // It stays paused: nothing expires and nothing resumes on its own.
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect((await readRun(run.id)).status).toBe("paused");

    const resumed = await post(`/api/runs/${run.id}/resume`, {});
    expect(resumed.statusCode).toBe(200);

    await app.runQueue.idle();
    const finished = await readRun(run.id);
    expect(finished.status).toBe("succeeded");
    expect(finished.operations.map((operation) => operation.summary)).toEqual([
      "Read a.ts",
      "Read b.ts",
    ]);
    expect(finished.operations.map((operation) => operation.status)).toEqual(["done", "done"]);
  });

  it("pauses a run that is still in the queue, and resume puts it back", async () => {
    await app.close();
    app = build({ autoStart: false });
    const project = await createProject({ safety: ALLOW_ALL });
    const task = await createTask(project.slug);

    const run = await startRun(project.slug, task.key);
    expect(run.status).toBe("queued");

    const res = await post(`/api/runs/${run.id}/pause`, {});
    expect(res.statusCode).toBe(200);
    // No operation to finish, so the pause is effective at once.
    expect(res.json()).toMatchObject({ paused: true });
    expect((res.json().data as Run).status).toBe("paused");

    // A second pause asks for the state it is already in.
    const again = await post(`/api/runs/${run.id}/pause`, {});
    expect(again.statusCode).toBe(200);
    expect(again.json().paused).toBe(true);

    const resumed = await post(`/api/runs/${run.id}/resume`, {});
    expect(resumed.statusCode).toBe(200);
    expect((resumed.json().data as Run).status).toBe("queued");
    // Its place in the queue is untouched.
    expect((resumed.json().data as Run).createdAt).toBe(run.createdAt);
    expect(agents).toHaveLength(0);
  });

  it("keeps a run that was paused while it waited for a writer slot, then runs it on resume", async () => {
    // docs/10 §6 with the default capacity of 1: the second run waits for the
    // slot. Pausing it there takes it out of the queue's reach; resume must
    // put it back rather than leave it stranded.
    const project = await createProject({ safety: ASK_ALL, maxConcurrentRuns: 1 });
    const holder = await createTask(project.slug, { title: "Hold the slot" });
    const waiter = await createTask(project.slug, { title: "Wait for the slot" });
    scripts.push(
      { steps: [{ name: "Read", input: { file_path: "held.ts" } }] },
      { steps: [{ name: "Read", input: { file_path: "waited.ts" } }] },
    );

    const first = await startRun(project.slug, holder.key);
    const parked = await waitForProposed(first.id);

    const second = await startRun(project.slug, waiter.key);
    const paused = await post(`/api/runs/${second.id}/pause`, {});
    expect(paused.json()).toMatchObject({ paused: true });

    // The slot frees; the paused run must not be started or failed by it.
    expect(
      (await post(`/api/runs/${first.id}/approve`, { operationIds: [parked.id] })).statusCode,
    ).toBe(200);
    await app.runQueue.idle();
    expect((await readRun(first.id)).status).toBe("succeeded");
    const stillPaused = await readRun(second.id);
    expect(stillPaused.status).toBe("paused");
    expect(stillPaused.operations).toEqual([]);

    // Resume returns it to the queue, and the queue serves it.
    expect((await post(`/api/runs/${second.id}/resume`, {})).statusCode).toBe(200);
    const secondParked = await waitForProposed(second.id);
    expect(secondParked.summary).toBe("Read waited.ts");
    expect(
      (await post(`/api/runs/${second.id}/approve`, { operationIds: [secondParked.id] }))
        .statusCode,
    ).toBe(200);
    await app.runQueue.idle();
    expect((await readRun(second.id)).status).toBe("succeeded");
  });

  it("409s on a finished run, and resume 409s on a run that is not paused", async () => {
    await app.close();
    app = build({ autoStart: false });
    const project = await createProject({ safety: ALLOW_ALL });
    const task = await createTask(project.slug);
    const run = await startRun(project.slug, task.key);

    const resume = await post(`/api/runs/${run.id}/resume`, {});
    expect(resume.statusCode).toBe(409);
    expect(resume.json().error).toMatchObject({
      code: "RUN_NOT_PAUSED",
      details: { status: "queued" },
    });

    expect((await post(`/api/runs/${run.id}/cancel`, {})).statusCode).toBe(200);

    const pause = await post(`/api/runs/${run.id}/pause`, {});
    expect(pause.statusCode).toBe(409);
    expect(pause.json().error).toMatchObject({
      code: "RUN_NOT_ACTIVE",
      details: { status: "cancelled" },
    });
  });
});

// ---------------------------------------------------------------------------
// Cancel
// ---------------------------------------------------------------------------

describe("POST /api/runs/:run/cancel", () => {
  it("stops a run that is waiting for an approval and keeps its record", async () => {
    // docs/09: "Cancel — the run stops. The changes stay." The run ends
    // `cancelled`, which is not a failure.
    const project = await createProject({ safety: ASK_ALL });
    const task = await createTask(project.slug);
    scripts.push({ steps: [{ name: "Write", input: { file_path: "a.ts", content: "x" } }] });

    const run = await startRun(project.slug, task.key);
    const parked = await waitForProposed(run.id);

    const res = await post(`/api/runs/${run.id}/cancel`, { restore: false });

    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({ status: "cancelled" });
    expect(res.json().restore).toEqual({ requested: false, performed: false });

    await app.runQueue.idle();
    const finished = await readRun(run.id);
    expect(finished.status).toBe("cancelled");
    expect(finished.failureReason).toBeNull();
    expect(finished.endedAt).not.toBeNull();
    // The operation the user never answered is not left `proposed` forever.
    expect(finished.operations).toHaveLength(1);
    expect(finished.operations[0]).toMatchObject({ id: parked.id, status: "failed" });
  });

  it("stops the transcript where it stood", async () => {
    const project = await createProject({ safety: ALLOW_ALL });
    const task = await createTask(project.slug);
    const reachedFirst = deferred();
    const cancelled = deferred();
    scripts.push({
      steps: [
        {
          name: "Read",
          input: { file_path: "a.ts" },
          onDecision: async () => {
            reachedFirst.resolve();
            await cancelled.promise;
          },
        },
        { name: "Read", input: { file_path: "b.ts" } },
      ],
    });

    const run = await startRun(project.slug, task.key);
    await reachedFirst.promise;
    expect((await post(`/api/runs/${run.id}/cancel`, {})).statusCode).toBe(200);
    cancelled.resolve();

    await app.runQueue.idle();
    const finished = await readRun(run.id);
    expect(finished.status).toBe("cancelled");
    // The operation that was already running finished; the next one was
    // never proposed.
    expect(finished.operations).toHaveLength(1);
    expect(finished.operations[0]).toMatchObject({ summary: "Read a.ts", status: "done" });
  });

  it("cancels a run that is still in the queue", async () => {
    await app.close();
    app = build({ autoStart: false });
    const project = await createProject({ safety: ALLOW_ALL });
    const task = await createTask(project.slug);
    const run = await startRun(project.slug, task.key);

    const res = await post(`/api/runs/${run.id}/cancel`, {});

    expect(res.statusCode).toBe(200);
    const cancelled = res.json().data as Run;
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.endedAt).not.toBeNull();
    expect(agents).toHaveLength(0);
  });

  it("refuses restore:true on a run with no restore point", async () => {
    // The revert itself is the restore work's; what this endpoint owes now is
    // a refusal instead of a silent *cancel and keep the changes*.
    await app.close();
    app = build({ autoStart: false });
    const project = await createProject({ safety: ALLOW_ALL });
    const task = await createTask(project.slug);
    const run = await startRun(project.slug, task.key);

    const res = await post(`/api/runs/${run.id}/cancel`, { restore: true });

    expect(res.statusCode).toBe(422);
    expect(res.json().error).toMatchObject({ code: "NO_RESTORE_POINT", details: { run: run.id } });
    // The run was not cancelled either: the request did nothing.
    expect((await readRun(run.id)).status).toBe("queued");
  });

  it("refuses restore:true when the restore point could not be captured", async () => {
    await app.close();
    app = build({ autoStart: false });
    const project = await createProject({ safety: ALLOW_ALL });
    const task = await createTask(project.slug);
    const run = await startRun(project.slug, task.key);

    updateRun(db, {
      ...getRunById(db, run.id)!,
      restorePoint: {
        method: "snapshot",
        available: false,
        reason: "a file was too large to snapshot",
        head: null,
        stash: null,
        snapshotDir: null,
        createdPaths: [],
        capturedAt: new Date().toISOString(),
      },
    });

    const res = await post(`/api/runs/${run.id}/cancel`, { restore: true });

    expect(res.statusCode).toBe(422);
    expect(res.json().error).toMatchObject({
      code: "NO_RESTORE_POINT",
      details: { reason: "a file was too large to snapshot" },
    });
  });

  it("accepts restore:true when the run has a restore point", async () => {
    await app.close();
    app = build({ autoStart: false });
    const project = await createProject({ safety: ALLOW_ALL });
    const task = await createTask(project.slug);
    const run = await startRun(project.slug, task.key);

    updateRun(db, {
      ...getRunById(db, run.id)!,
      restorePoint: {
        method: "git",
        available: true,
        reason: null,
        head: "0123456789abcdef0123456789abcdef01234567",
        stash: null,
        snapshotDir: null,
        createdPaths: [],
        capturedAt: new Date().toISOString(),
      },
    });

    const res = await post(`/api/runs/${run.id}/cancel`, { restore: true });

    expect(res.statusCode).toBe(200);
    expect((res.json().data as Run).status).toBe("cancelled");
    expect(res.json().restore).toEqual({ requested: true, performed: false });
  });

  it("refuses a restore flag that is not a boolean", async () => {
    await app.close();
    app = build({ autoStart: false });
    const project = await createProject({ safety: ALLOW_ALL });
    const task = await createTask(project.slug);
    const run = await startRun(project.slug, task.key);

    const res = await post(`/api/runs/${run.id}/cancel`, { restore: "yes" });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.details).toMatchObject({ field: "restore" });
    expect((await readRun(run.id)).status).toBe("queued");
  });

  it("409s on a run that already ended", async () => {
    const project = await createProject({ safety: ALLOW_ALL });
    const task = await createTask(project.slug);
    scripts.push({ steps: [{ name: "Read", input: { file_path: "a.ts" } }] });
    const run = await startRun(project.slug, task.key);
    await app.runQueue.idle();

    const res = await post(`/api/runs/${run.id}/cancel`, {});
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("RUN_NOT_ACTIVE");
  });
});

describe("every control endpoint", () => {
  it("404s for a run that does not exist", async () => {
    for (const [action, payload] of [
      ["approve", { operationIds: ["a"] }],
      ["deny", { operationId: "a" }],
      ["pause", {}],
      ["resume", {}],
      ["cancel", {}],
    ] as const) {
      const res = await post(`/api/runs/nope/${action}`, payload);
      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe("RUN_NOT_FOUND");
    }
  });
});

/**
 * `GET /api/runs/:run/stream` (T59; docs/06 "Runs", docs/09-ai-run.md
 * "Streams", docs/07-user-interface.md "Progress").
 *
 * A scripted agent drives one run through park → approve → execute →
 * succeed, and the stream is read the way `GET /api/events` is read in
 * test/server/routes/events.test.ts: raw frames, parsed here. What matters
 * is event *order* — the operation lifecycle and the run's own status
 * moves arrive in the order they happened, and progress goes from
 * `planning` to a growing `completed`/`planned` count, never a fabricated
 * percentage.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type Database from "better-sqlite3";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../../src/server/app.js";
import { openDatabase } from "../../../src/server/db/index.js";
import { clearValidatorCache } from "../../../src/server/fields/validator.js";
import { clearVersionCache } from "../../../src/server/projects/version.js";
import { createFakeAgent, type FakeAgentScript } from "../../../src/server/runs/fakeAgent.js";
import type { RunStreamFrame } from "../../../src/server/runs/streams.js";
import type { RunView } from "../../../src/shared/runs.js";
import type { SafetyPolicy } from "../../../src/shared/types.js";
import type { ProjectView, Task } from "../../../src/shared/types.js";

const HEADERS = { host: "localhost:4400" };

const ASK_A: SafetyPolicy = { denyList: [], mode: "ask_listed", askList: ["a.ts"] };

let dir: string;
let workspace: string;
let db: Database.Database;
let app: FastifyInstance;
let scripts: FakeAgentScript[];

function build(): FastifyInstance {
  return createApp({
    db,
    runs: {
      autoStart: true,
      createAgent: () => createFakeAgent(scripts.shift() ?? {}),
    },
  });
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "paim-run-stream-"));
  workspace = mkdtempSync(join(tmpdir(), "paim-workspace-"));
  db = openDatabase(join(dir, "paim.db"));
  scripts = [];
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

async function createProject(safety: SafetyPolicy): Promise<ProjectView> {
  const res = await app.inject({
    method: "POST",
    url: "/api/projects",
    headers: HEADERS,
    payload: { name: "PAIM", workspacePath: workspace, safety },
  });
  expect(res.statusCode).toBe(201);
  return res.json().data as ProjectView;
}

async function createTask(slug: string): Promise<Task> {
  const res = await app.inject({
    method: "POST",
    url: `/api/projects/${slug}/tasks`,
    headers: HEADERS,
    payload: { title: "Stream the run" },
  });
  expect(res.statusCode).toBe(201);
  return res.json().data as Task;
}

async function startRun(slug: string, key: string): Promise<RunView> {
  const res = await app.inject({
    method: "POST",
    url: `/api/projects/${slug}/tasks/${key}/runs`,
    headers: HEADERS,
    payload: {},
  });
  expect(res.statusCode).toBe(201);
  return res.json().data as RunView;
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

interface OpenFrame {
  name: string;
  data: RunStreamFrame;
}

interface OpenStream {
  frames: OpenFrame[];
  comments: string[];
  close(): void;
}

async function openRunStream(runId: string): Promise<OpenStream> {
  const res = await app.inject({
    method: "GET",
    url: `/api/runs/${runId}/stream`,
    headers: HEADERS,
    payloadAsStream: true,
  });
  expect(res.statusCode).toBe(200);
  expect(res.headers["content-type"]).toContain("text/event-stream");

  const stream = res.stream();
  const open: OpenStream = { frames: [], comments: [], close: () => stream.destroy() };

  let buffer = "";
  stream.on("data", (chunk: Buffer) => {
    buffer += chunk.toString("utf-8");
    let boundary = buffer.indexOf("\n\n");
    while (boundary !== -1) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      boundary = buffer.indexOf("\n\n");

      if (frame.startsWith(":")) {
        open.comments.push(frame.slice(1).trim());
        continue;
      }
      const lines = frame.split("\n");
      const name = lines.find((line) => line.startsWith("event:"));
      const data = lines
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice("data:".length).trim())
        .join("\n");
      if (data.length > 0) {
        open.frames.push({
          name: name === undefined ? "message" : name.slice("event:".length).trim(),
          data: JSON.parse(data) as RunStreamFrame,
        });
      }
    }
  });

  await settle();
  return open;
}

function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 5));
}

function post(url: string, payload: Record<string, unknown> = {}) {
  return app.inject({ method: "POST", url, headers: HEADERS, payload });
}

describe("GET /api/runs/:run/stream", () => {
  it("404s on an unknown run", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/runs/00000000-0000-0000-0000-000000000000/stream",
      headers: HEADERS,
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("RUN_NOT_FOUND");
  });

  it("carries the operation lifecycle and the run's status, in order", async () => {
    const project = await createProject(ASK_A);
    const task = await createTask(project.slug);

    scripts.push({
      steps: [
        { name: "Read", input: { file_path: "a.ts" }, outcome: { text: "body" } },
        { name: "Write", input: { file_path: "b.ts", content: "x" }, outcome: { text: "ok" } },
      ],
      result: { usage: { inputTokens: 10, outputTokens: 5, costUsd: 0.01 } },
    });

    const started = await startRun(project.slug, task.key);
    // `a.ts` is on the ask list: the run parks there, which is the window
    // this test opens the stream in — same as any client that connects
    // after starting a run, not before.
    const parked = await waitForRun(
      started.id,
      (run) => run.status === "awaiting_approval",
      "the run to park on a.ts",
    );
    const stream = await openRunStream(started.id);

    const proposed = parked.operations.find((op) => op.status === "proposed");
    expect(proposed).toBeDefined();
    const approve = await post(`/api/runs/${started.id}/approve`, {
      operationIds: [proposed!.id],
    });
    expect(approve.statusCode).toBe(200);

    await waitForRun(started.id, (run) => run.status === "succeeded", "the run to finish");
    await settle();
    stream.close();

    // Every frame this stream ever carries names its kind.
    expect(stream.frames.length).toBeGreaterThan(0);
    for (const frame of stream.frames) {
      expect(["run", "operation"]).toContain(frame.name);
      expect(frame.data.run.id).toBe(started.id);
    }

    // The operation this test approved reached every one of its statuses,
    // in the order docs/09 "Records" walks the lifecycle: approved, then
    // running, then done.
    const opFrames = stream.frames.filter(
      (frame) => frame.name === "operation" && frame.data.operation?.id === proposed!.id,
    );
    expect(opFrames.map((frame) => frame.data.operation!.status)).toEqual([
      "approved",
      "running",
      "done",
    ]);

    // The run itself moved to `executing` once approved, and ended
    // `succeeded` — and nothing after that final frame.
    const runFrames = stream.frames.filter((frame) => frame.name === "run");
    const statuses = runFrames.map((frame) => frame.data.run.status);
    expect(statuses[statuses.length - 1]).toBe("succeeded");
    expect(statuses.includes("executing")).toBe(true);

    // Progress: no percentage while the run is still planning, and an
    // honest, growing count of what actually happened once it is not.
    for (const frame of stream.frames) {
      if (frame.data.run.status === "planning") {
        expect(frame.data.progress).toEqual({ state: "planning" });
      } else {
        expect(frame.data.progress.state).toBe("counted");
      }
    }
    const finalFrame = stream.frames[stream.frames.length - 1]!;
    expect(finalFrame.data.progress).toEqual({ state: "counted", planned: 2, completed: 2 });
  });

  it("does not deliver another run's frames", async () => {
    const project = await createProject({ denyList: [], mode: "allow_all", askList: [] });
    const taskA = await createTask(project.slug);
    const taskB = await createTask(project.slug);

    scripts.push({ steps: [], result: { usage: {} } });
    scripts.push({
      steps: [{ name: "Read", input: { file_path: "a.ts" }, outcome: { text: "ok" } }],
      result: { usage: {} },
    });

    const runA = await startRun(project.slug, taskA.key);
    await waitForRun(runA.id, (run) => run.status === "succeeded", "run A to finish");

    const runB = await startRun(project.slug, taskB.key);
    const streamA = await openRunStream(runA.id);
    await waitForRun(runB.id, (run) => run.status === "succeeded", "run B to finish");
    await settle();

    expect(streamA.frames).toEqual([]);
    streamA.close();
  });
});

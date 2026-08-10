/**
 * `POST /api/projects/:project/tasks/:key/runs` — the queue endpoint
 * (T55; docs/06 "Runs", docs/05 "Dependencies", docs/11 "Model routing").
 *
 * The app is built with a scripted agent, so a dispatched run never reaches
 * the Agent SDK or the network; most cases turn the dispatcher off
 * altogether and assert the queue record alone.
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
import { createFakeAgent } from "../../../src/server/runs/fakeAgent.js";
import type { Agent } from "../../../src/server/runs/agent.js";
import type { Run } from "../../../src/shared/runs.js";
import type { ProjectView, Task } from "../../../src/shared/types.js";

const HEADERS = { host: "localhost:4400" };

let dir: string;
let workspace: string;
let db: Database.Database;
let app: FastifyInstance;
let agents: Agent[];

function build(options: { autoStart?: boolean } = {}): FastifyInstance {
  return createApp({
    db,
    runs: {
      autoStart: options.autoStart ?? false,
      createAgent: () => {
        const agent = createFakeAgent({ result: { usage: { inputTokens: 7, outputTokens: 3 } } });
        agents.push(agent);
        return agent;
      },
    },
  });
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "paim-run-start-"));
  workspace = mkdtempSync(join(tmpdir(), "paim-workspace-"));
  db = openDatabase(join(dir, "paim.db"));
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
    payload: { name: "PAIM", workspacePath: workspace, ...body },
  });
  expect(res.statusCode).toBe(201);
  return res.json().data as ProjectView;
}

async function createTask(slug: string, body: Record<string, unknown> = {}): Promise<Task> {
  const res = await app.inject({
    method: "POST",
    url: `/api/projects/${slug}/tasks`,
    headers: HEADERS,
    payload: { title: "Add the queue", ...body },
  });
  expect(res.statusCode).toBe(201);
  return res.json().data as Task;
}

function startRun(slug: string, key: string, payload: Record<string, unknown> = {}) {
  return app.inject({
    method: "POST",
    url: `/api/projects/${slug}/tasks/${key}/runs`,
    headers: HEADERS,
    payload,
  });
}

describe("POST .../runs", () => {
  it("enqueues a run and reports it as queued", async () => {
    const project = await createProject();
    const task = await createTask(project.slug);

    const res = await startRun(project.slug, task.key);

    expect(res.statusCode).toBe(201);
    const body = res.json() as { data: Run; blockedBy: unknown[]; model: unknown };
    expect(body.data).toMatchObject({
      taskId: task.id,
      projectId: project.id,
      kind: "single",
      trigger: "manual",
      status: "queued",
      startedAt: null,
      endedAt: null,
    });
    expect(body.blockedBy).toEqual([]);
    expect(body.model).toEqual({ model: "claude-opus-5", effort: "high" });

    const list = await app.inject({
      method: "GET",
      url: `/api/projects/${project.slug}/tasks/${task.key}/runs`,
      headers: HEADERS,
    });
    expect((list.json().data as Run[]).map((run) => run.id)).toEqual([body.data.id]);
  });

  it("refuses a project with no workspace path with 422 NO_WORKSPACE", async () => {
    const project = await createProject({ workspacePath: null });
    const task = await createTask(project.slug);

    const res = await startRun(project.slug, task.key);

    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("NO_WORKSPACE");
  });

  it("refuses a model the project does not allow with 422 MODEL_NOT_ALLOWED", async () => {
    const project = await createProject({ allowedModels: ["claude-sonnet-5"] });
    const task = await createTask(project.slug, { model: "claude-fable-5" });

    const res = await startRun(project.slug, task.key);

    expect(res.statusCode).toBe(422);
    expect(res.json().error).toMatchObject({
      code: "MODEL_NOT_ALLOWED",
      details: { model: "claude-fable-5" },
    });
  });

  it("routes the run through the project's routing field", async () => {
    const project = await createProject({
      modelRouting: {
        field: "size",
        map: {
          XS: { model: "claude-haiku-4-5", effort: "low" },
          M: { model: "claude-opus-5", effort: "high" },
        },
        fallback: { model: "claude-opus-5", effort: "high" },
      },
    });
    const task = await createTask(project.slug, { size: "XS" });

    const res = await startRun(project.slug, task.key);

    expect(res.json().model).toEqual({ model: "claude-haiku-4-5", effort: "low" });
  });

  it("queues a task with an unmet dependency and names the blocker", async () => {
    const project = await createProject();
    const blocker = await createTask(project.slug, { title: "Ship the schema" });
    const task = await createTask(project.slug, { dependsOn: [blocker.id] });

    const res = await startRun(project.slug, task.key);

    expect(res.statusCode).toBe(201);
    const body = res.json() as { data: Run; blockedBy: { key: string; title: string }[] };
    expect(body.data.status).toBe("queued");
    expect(body.blockedBy).toEqual([
      { id: blocker.id, key: blocker.key, title: "Ship the schema", status: blocker.status },
    ]);
  });

  it("refuses an unknown trigger", async () => {
    const project = await createProject();
    const task = await createTask(project.slug);

    const res = await startRun(project.slug, task.key, { trigger: "cron" });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("INVALID_TRIGGER");
  });

  it("404s for a task the project does not have", async () => {
    const project = await createProject();
    const res = await startRun(project.slug, "FEAT-404");
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("TASK_NOT_FOUND");
  });
});

describe("the endpoint hands the run to the queue", () => {
  it("answers before the run ends, then the queue starts it", async () => {
    await app.close();
    app = build({ autoStart: true });
    const project = await createProject();
    const task = await createTask(project.slug);

    const res = await startRun(project.slug, task.key);
    expect(res.statusCode).toBe(201);
    // The endpoint never waits for the agent (specs/README).
    expect((res.json().data as Run).status).toBe("queued");

    await app.runQueue.idle();

    const stored = await app.inject({
      method: "GET",
      url: `/api/runs/${(res.json().data as Run).id}`,
      headers: HEADERS,
    });
    expect(stored.json().data).toMatchObject({ status: "succeeded" });
    expect(agents).toHaveLength(1);

    const after = await app.inject({
      method: "GET",
      url: `/api/projects/${project.slug}/tasks/${task.key}`,
      headers: HEADERS,
    });
    // T55: the task moves to `executing` when the run starts. Advancing it
    // when the run ends is T61's.
    expect((after.json().data as Task).status).toBe("executing");
  });

  it("leaves a dependency-blocked run in the queue", async () => {
    await app.close();
    app = build({ autoStart: true });
    const project = await createProject();
    const blocker = await createTask(project.slug, { title: "Ship the schema" });
    const task = await createTask(project.slug, { dependsOn: [blocker.id] });

    const res = await startRun(project.slug, task.key);
    await app.runQueue.idle();

    const stored = await app.inject({
      method: "GET",
      url: `/api/runs/${(res.json().data as Run).id}`,
      headers: HEADERS,
    });
    expect(stored.json().data).toMatchObject({ status: "queued", startedAt: null });
    expect(agents).toHaveLength(0);
  });
});

/**
 * `GET /api/events` — the data-change stream (specs/06-events.md,
 * docs/06-rest-api.md "The events stream").
 *
 * The stream is read the way a client reads it: raw frames off the response,
 * parsed here into events. The coverage table walks every mutating endpoint
 * that exists today and asserts what it puts on the stream — exactly one
 * event per changed record, bulk included.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type Database from "better-sqlite3";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../../src/server/app.js";
import { openDatabase } from "../../../src/server/db/index.js";
import { changeListenerCount } from "../../../src/server/events/changes.js";
import type { ChangeEvent } from "../../../src/shared/events.js";

const HEADERS = { host: "localhost:4400" };

let dir: string;
let db: Database.Database;
let app: FastifyInstance;
let projectId: string;

/** What an open stream has received so far. */
interface OpenStream {
  events: ChangeEvent[];
  comments: string[];
  /** `id:` of every event frame, in order. */
  ids: string[];
  close(): void;
}

/**
 * Opens `/api/events` and parses the frames as they arrive. `payloadAsStream`
 * hands back the response body while the handler keeps writing, which is
 * what a stream that never ends needs.
 */
async function openStream(instance: FastifyInstance = app): Promise<OpenStream> {
  const res = await instance.inject({
    method: "GET",
    url: "/api/events",
    headers: HEADERS,
    payloadAsStream: true,
  });
  expect(res.statusCode).toBe(200);
  expect(res.headers["content-type"]).toContain("text/event-stream");

  const stream = res.stream();
  const open: OpenStream = {
    events: [],
    comments: [],
    ids: [],
    close: () => stream.destroy(),
  };

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
      const data = lines
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice("data:".length).trim())
        .join("\n");
      const id = lines.find((line) => line.startsWith("id:"));
      if (data.length > 0) {
        open.events.push(JSON.parse(data) as ChangeEvent);
        open.ids.push(id === undefined ? "" : id.slice("id:".length).trim());
      }
    }
  });

  await settle();
  return open;
}

/** Lets the frames written during a request reach the reader. */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 5));
}

function post(url: string, payload: unknown) {
  return app.inject({ method: "POST", url, headers: HEADERS, payload: payload as object });
}

function patch(url: string, payload: unknown) {
  return app.inject({ method: "PATCH", url, headers: HEADERS, payload: payload as object });
}

function del(url: string) {
  return app.inject({ method: "DELETE", url, headers: HEADERS });
}

async function createTask(title: string): Promise<{ id: string; key: string }> {
  const res = await post("/api/projects/paim/tasks", { title });
  expect(res.statusCode).toBe(201);
  const task = res.json().data as { id: string; key: string };
  return task;
}

/** `type/change` of each event — the shape the coverage table compares. */
function shapes(events: ChangeEvent[]): string[] {
  return events.map((event) => `${event.type}/${event.change}`);
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "paim-events-"));
  db = openDatabase(join(dir, "paim.db"));
  app = createApp({ db });
  const created = await post("/api/projects", { name: "PAIM" });
  projectId = created.json().data.id as string;
});

afterEach(async () => {
  await app.close();
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("the stream", () => {
  it("opens with a comment and stays open", async () => {
    const stream = await openStream();
    expect(stream.comments).toEqual(["connected"]);
    expect(stream.events).toEqual([]);
    expect(app.sse.size).toBe(1);
    stream.close();
  });

  it("accepts Last-Event-ID without replaying anything", async () => {
    await createTask("Before the reconnect");

    const res = await app.inject({
      method: "GET",
      url: "/api/events",
      headers: { ...HEADERS, "last-event-id": "1" },
      payloadAsStream: true,
    });
    expect(res.statusCode).toBe(200);

    const stream = res.stream();
    const chunk = (await stream[Symbol.asyncIterator]().next()).value as Buffer;
    // The stream carries no history: the reconnecting client revalidates.
    expect(chunk.toString("utf-8")).toBe(": connected\n\n");
    stream.destroy();
  });

  it("delivers a task/created event within 100 ms of the write", async () => {
    const stream = await openStream();

    const started = Date.now();
    const task = await createTask("A first task");
    while (stream.events.length === 0 && Date.now() - started < 100) await settle();

    expect(Date.now() - started).toBeLessThan(100);
    expect(stream.events).toEqual([
      { type: "task", id: task.id, projectId, change: "created" },
    ]);
    // Every frame is numbered, so a client can name the last one it saw.
    expect(stream.ids).toEqual(["1"]);
    stream.close();
  });

  it("writes a heartbeat comment while nothing changes", async () => {
    const beating = createApp({ db, sseHeartbeatMs: 10 });
    try {
      const stream = await openStream(beating);
      await new Promise((resolve) => setTimeout(resolve, 60));
      expect(stream.comments.filter((c) => c === "heartbeat").length).toBeGreaterThanOrEqual(2);
      stream.close();
    } finally {
      await beating.close();
    }
  });

  it("fans one event out to 100 clients", async () => {
    const streams = await Promise.all(Array.from({ length: 100 }, () => openStream()));
    expect(app.sse.size).toBe(100);

    const task = await createTask("Seen by everyone");
    await settle();

    for (const stream of streams) {
      expect(stream.events).toEqual([
        { type: "task", id: task.id, projectId, change: "created" },
      ]);
    }
    for (const stream of streams) stream.close();
  });
});

describe("one event per changed record", () => {
  it("covers every mutating endpoint", async () => {
    const stream = await openStream();

    const bulk = [await createTask("Bulk one"), await createTask("Bulk two")];
    const doomed = await createTask("To be trashed");
    await settle();
    stream.events.length = 0;

    const steps: { name: string; act: () => Promise<unknown>; expected: string[] }[] = [
      {
        name: "POST /tasks",
        act: () => post("/api/projects/paim/tasks", { title: "Created" }),
        expected: ["task/created"],
      },
      {
        name: "POST /tasks — rejected, no title",
        act: () => post("/api/projects/paim/tasks", {}),
        expected: [],
      },
      {
        name: "POST /tasks/:key",
        act: () => post(`/api/projects/paim/tasks/${bulk[0]!.key}`, { title: "Renamed" }),
        expected: ["task/updated"],
      },
      {
        name: "PATCH /tasks/:key",
        act: () => patch(`/api/projects/paim/tasks/${bulk[0]!.key}`, { priority: "high" }),
        expected: ["task/updated"],
      },
      {
        name: "PATCH /tasks/:key — rejected, unknown status",
        act: () => patch(`/api/projects/paim/tasks/${bulk[0]!.key}`, { status: "nowhere" }),
        expected: [],
      },
      {
        name: "POST /tasks/bulk — three tasks",
        act: () =>
          post("/api/projects/paim/tasks/bulk", {
            ids: [bulk[0]!.key, bulk[1]!.key, doomed.key],
            patch: { size: "M" },
          }),
        expected: ["task/updated", "task/updated", "task/updated"],
      },
      {
        name: "POST /tasks/bulk — one id fails",
        act: () =>
          post("/api/projects/paim/tasks/bulk", {
            ids: [bulk[0]!.key, "NOPE-404", bulk[1]!.key],
            patch: { assignee: "edu" },
          }),
        expected: ["task/updated", "task/updated"],
      },
      {
        name: "DELETE /tasks/:key — to the trash",
        act: () => del(`/api/projects/paim/tasks/${doomed.key}`),
        expected: ["task/deleted"],
      },
      {
        name: "POST /trash/:key — restored",
        act: () => post(`/api/projects/paim/trash/${doomed.key}`, {}),
        expected: ["task/created"],
      },
      {
        name: "DELETE /tasks/:key?hard=true",
        act: () => del(`/api/projects/paim/tasks/${doomed.key}?hard=true`),
        expected: ["task/deleted"],
      },
      {
        name: "POST /projects/:project — settings",
        act: () => post("/api/projects/paim", { description: "A local task service" }),
        expected: ["project/updated"],
      },
      {
        name: "POST /projects/:project — the pipeline is the schema",
        act: () =>
          post("/api/projects/paim", {
            statuses: ["backlog", "open_questions", "design", "ready", "executing", "done"],
          }),
        expected: ["schema/updated"],
      },
      {
        name: "POST /projects/:project/schema",
        act: () => post("/api/projects/paim/schema", { fields: [{ key: "layer", type: "text" }] }),
        expected: ["schema/updated"],
      },
      {
        name: "POST /projects/:project/schema — rejected",
        act: () => post("/api/projects/paim/schema", { fields: [{ key: "Layer", type: "text" }] }),
        expected: [],
      },
      {
        name: "POST /tasks?allowUnknownFields=true — two records change",
        act: () =>
          post("/api/projects/paim/tasks?allowUnknownFields=true", {
            title: "With a new field",
            fields: { squad: "core" },
          }),
        expected: ["schema/updated", "task/created"],
      },
      {
        name: "POST /projects",
        act: () => post("/api/projects", { name: "Second" }),
        expected: ["project/created"],
      },
      {
        name: "DELETE /projects/:project",
        act: () => del("/api/projects/second"),
        expected: ["project/deleted"],
      },
    ];

    for (const step of steps) {
      const before = stream.events.length;
      await step.act();
      await settle();
      expect(shapes(stream.events.slice(before)), step.name).toEqual(step.expected);
    }

    // Every event names the record and the project it belongs to.
    for (const event of stream.events) {
      expect(typeof event.id).toBe("string");
      expect(event.projectId).toBeTruthy();
    }
    stream.close();
  });

  it("reports a forced project delete once, and once per live task", async () => {
    const alive = await createTask("Still here");
    const trashed = await createTask("Already in the trash");
    await del(`/api/projects/paim/tasks/${trashed.key}`);

    const stream = await openStream();
    const res = await del("/api/projects/paim?force=true");
    expect(res.statusCode).toBe(200);
    await settle();

    // The trashed task left every read — and reported it — when it was
    // trashed, so the purge says nothing more about it.
    expect(stream.events).toEqual([
      { type: "task", id: alive.id, projectId, change: "deleted" },
      { type: "project", id: projectId, projectId, change: "deleted" },
    ]);
    stream.close();
  });

  it("says nothing for a sweep of the trash, which reported itself already", async () => {
    const task = await createTask("Trash me");
    const stream = await openStream();

    await del(`/api/projects/paim/tasks/${task.key}`);
    await settle();
    expect(shapes(stream.events)).toEqual(["task/deleted"]);

    const { sweepTrash } = await import("../../../src/server/db/tasks.js");
    const later = new Date(Date.now() + 400 * 24 * 60 * 60 * 1000).toISOString();
    expect(sweepTrash(db, later)).toBe(1);
    await settle();

    expect(shapes(stream.events)).toEqual(["task/deleted"]);
    stream.close();
  });
});

describe("the registry", () => {
  it("cleans up a dropped connection and its bus listener", async () => {
    const address = await app.listen({ port: 0, host: "127.0.0.1" });
    const port = Number(new URL(address).port);

    const connected = await new Promise<ReturnType<typeof httpRequest>>((resolve, reject) => {
      // The Host header is set by hand: the app admits only the two names of
      // src/server/app.ts, never an ephemeral test port.
      const req = httpRequest({
        host: "127.0.0.1",
        port,
        path: "/api/events",
        headers: { host: "127.0.0.1:4400", accept: "text/event-stream" },
      });
      req.on("error", reject);
      req.on("response", (res) => {
        expect(res.statusCode).toBe(200);
        res.on("data", () => {});
        resolve(req);
      });
      req.end();
    });

    await settle();
    expect(app.sse.size).toBe(1);

    connected.destroy();
    const deadline = Date.now() + 1000;
    while (app.sse.size > 0 && Date.now() < deadline) await settle();
    expect(app.sse.size).toBe(0);

    // Closing the app leaves nothing behind on the database's change bus,
    // so a long-lived database never accumulates dead listeners.
    expect(changeListenerCount(db)).toBe(1);
    await app.close();
    expect(changeListenerCount(db)).toBe(0);
  });

  it("closes every open stream when the app closes", async () => {
    const other = createApp({ db });
    const streams = await Promise.all([openStream(other), openStream(other)]);
    expect(other.sse.size).toBe(2);

    await other.close();

    expect(other.sse.size).toBe(0);
    for (const stream of streams) stream.close();
  });
});

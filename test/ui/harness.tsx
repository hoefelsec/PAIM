/* A fake service for the client suite.
 *
 * The client talks to the envelopes of docs/06, so the harness answers with
 * those and nothing else: `{ data, meta }` for a list, `{ data }` for a
 * record, `{ error: { code, message } }` for a failure. No live HTTP.
 */

import type { ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { render, type RenderResult } from "@testing-library/react";
import { vi } from "vitest";
import App from "../../src/app/App";
import { createQueryClient } from "../../src/app/queries";
import { Router } from "../../src/app/router";
import { OPEN_STATUSES } from "../../src/shared/statuses.js";
import type { TaskView } from "../../src/app/table";
import type { ProjectView } from "../../src/shared/types.js";

export interface Counts {
  total: number;
  open: number;
  done: number;
}

export function makeProject(overrides: Partial<ProjectView> & { slug: string }): ProjectView {
  const now = new Date().toISOString();
  return {
    id: `id-${overrides.slug}`,
    name: overrides.slug,
    description: "",
    icon: null,
    color: null,
    status: "active",
    type: "generic",
    workspacePath: null,
    autoCommit: false,
    autoPush: false,
    statuses: ["backlog", "open_questions", "design", "ready", "executing", "done"],
    fieldSchema: [],
    testFramework: null,
    regressionTests: [],
    safety: { denyList: [], mode: "ask_all", askList: [] },
    composeModel: { model: "claude-opus-5", effort: "medium" },
    modelRouting: { field: null, map: {}, fallback: { model: "claude-opus-5", effort: "medium" } },
    allowedModels: ["claude-opus-5"],
    usageCaps: { fiveHour: null, weekly: null, fable: null },
    maxConcurrentRuns: 2,
    trashRetentionDays: 30,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    version: null,
    ...overrides,
  };
}

let taskSeq = 0;

/** A task as the list endpoint returns it. `key` carries the type prefix. */
export function makeTask(overrides: Partial<TaskView> = {}): TaskView {
  const now = new Date().toISOString();
  const n = ++taskSeq;
  return {
    id: `task-${n}`,
    key: `TASK-${n}`,
    projectId: "id-paim",
    title: `Task ${n}`,
    description: "",
    status: "ready",
    priority: "none",
    size: "M",
    kind: overrides.size === "Epic" ? "epic" : "task",
    labels: [],
    assignee: null,
    parentId: null,
    order: n,
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
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
    closedAt: null,
    ...overrides,
  };
}

/** One write the client sent, as the fake service received it. */
export interface FakeWrite {
  path: string;
  method: string;
  body: Record<string, unknown>;
  ifMatch: string | null;
}

export interface FakeApi {
  /** Every path the client asked for, in order. */
  calls: string[];
  /** Every write, in order — what an inline edit actually sent. */
  writes: FakeWrite[];
}

/** The subset of `?open=`/`?status=` the table and the counters send. */
function selectTasks(tasks: readonly TaskView[], params: URLSearchParams): TaskView[] {
  const status = params.get("status");
  const open = params.get("open");
  return tasks.filter((task) => {
    if (status !== null && !status.split(",").includes(task.status)) return false;
    if (open === "true" && !(OPEN_STATUSES as string[]).includes(task.status)) return false;
    return true;
  });
}

/**
 * A write to one task, the way src/server/routes/tasks.ts applies it: a
 * shallow merge on the core, a shallow merge on `fields`, `kind` derived from
 * the size, and a fresh `updatedAt`.
 *
 * The stored object is mutated in place, so a test that holds a seeded task
 * sees the write — and can stage one of its own to provoke an If-Match
 * conflict.
 */
function applyWrite(task: TaskView, body: Record<string, unknown>): TaskView {
  const { fields, ...core } = body as Record<string, unknown> & {
    fields?: Record<string, unknown>;
  };
  Object.assign(task, core);
  if (fields) task.fields = { ...task.fields, ...fields };
  if (typeof core["size"] === "string") task.kind = core["size"] === "Epic" ? "epic" : "task";
  task.updatedAt = new Date(Date.parse(task.updatedAt) + 1000).toISOString();
  return task;
}

export function installApi(options: {
  projects: ProjectView[];
  counts?: Record<string, Counts>;
  /** Tasks per project slug. A slug with tasks answers `counts` from them. */
  tasks?: Record<string, TaskView[]>;
  /** Refuses every write with this error, the way a 4xx of docs/06 reads. */
  rejectWrites?: { status: number; code: string; message?: string };
}): FakeApi {
  const api: FakeApi = { calls: [], writes: [] };

  const json = (status: number, body: unknown): Response =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });

  const notFound = (code: string, message: string) => json(404, { error: { code, message } });

  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const path = typeof input === "string" ? input : input.toString();
    api.calls.push(path);
    const url = new URL(path, "http://127.0.0.1:4400");
    const params = url.searchParams;
    const method = (init?.method ?? "GET").toUpperCase();

    // One task: `POST|PATCH …/tasks/:key` is the inline edit of docs/07.
    const write = /^\/api\/projects\/([^/]+)\/tasks\/([^/]+)$/.exec(url.pathname);
    if (write?.[1] && write[2] && (method === "PATCH" || method === "POST")) {
      const headers = new Headers(init?.headers ?? {});
      const ifMatch = headers.get("if-match");
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      api.writes.push({ path, method, body, ifMatch });

      const ref = decodeURIComponent(write[2]);
      const task = (options.tasks?.[write[1]] ?? []).find(
        (row) => row.key === ref || row.id === ref,
      );
      if (!task) return notFound("TASK_NOT_FOUND", `No task "${ref}"`);

      if (options.rejectWrites) {
        const { status, code, message } = options.rejectWrites;
        return json(status, { error: { code, message: message ?? code } });
      }
      // docs/06 "Update semantics": `If-Match` makes the write a
      // compare-and-swap; a stale value is 409 IF_MATCH_FAILED.
      if (ifMatch !== null && ifMatch !== task.updatedAt) {
        return json(409, {
          error: {
            code: "IF_MATCH_FAILED",
            message: "The task changed since the version this write was based on",
          },
        });
      }
      return json(200, { data: { ...applyWrite(task, body) } });
    }

    if (url.pathname === "/api/projects") {
      const filter = params.get("status") ?? "active";
      const data = options.projects.filter((p) => filter === "all" || p.status === filter);
      return json(200, { data, meta: { total: data.length, cursor: null, hasMore: false } });
    }

    const one = /^\/api\/projects\/([^/]+)$/.exec(url.pathname);
    if (one?.[1]) {
      const project = options.projects.find((p) => p.slug === one[1]);
      if (!project) return notFound("PROJECT_NOT_FOUND", `No project "${one[1]}"`);
      return json(200, { data: project });
    }

    const tasks = /^\/api\/projects\/([^/]+)\/tasks$/.exec(url.pathname);
    if (tasks?.[1]) {
      const project = options.projects.find((p) => p.slug === tasks[1]);
      if (!project) return notFound("PROJECT_NOT_FOUND", `No project "${tasks[1]}"`);

      // A seeded project answers from its tasks, cursor walk included: the
      // cursor is the offset of the next row, which is all the client reads.
      const seeded = options.tasks?.[tasks[1]];
      if (seeded) {
        const selected = selectTasks(seeded, params);
        const limit = Number(params.get("limit") ?? "50");
        const from = Number(params.get("cursor") ?? "0");
        const page = selected.slice(from, from + limit);
        const hasMore = from + limit < selected.length;
        return json(200, {
          data: page,
          meta: {
            total: selected.length,
            cursor: hasMore ? String(from + limit) : null,
            hasMore,
          },
        });
      }

      const counts = options.counts?.[tasks[1]] ?? { total: 0, open: 0, done: 0 };
      const total =
        params.get("open") === "true"
          ? counts.open
          : params.get("status") === "done"
            ? counts.done
            : counts.total;
      return json(200, { data: [], meta: { total, cursor: null, hasMore: false } });
    }

    return notFound("NOT_FOUND", `no route for ${url.pathname}`);
  });

  return api;
}

export function Providers({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={createQueryClient()}>{children}</QueryClientProvider>;
}

/** Renders the whole application at one address, as the browser would. */
export function renderApp(path = "/"): RenderResult {
  window.history.replaceState({}, "", path);
  return render(
    <Providers>
      <Router>
        <App />
      </Router>
    </Providers>,
  );
}

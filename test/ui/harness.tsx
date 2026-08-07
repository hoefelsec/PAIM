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

export interface FakeApi {
  /** Every path the client asked for, in order. */
  calls: string[];
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

export function installApi(options: {
  projects: ProjectView[];
  counts?: Record<string, Counts>;
  /** Tasks per project slug. A slug with tasks answers `counts` from them. */
  tasks?: Record<string, TaskView[]>;
}): FakeApi {
  const api: FakeApi = { calls: [] };

  const json = (status: number, body: unknown): Response =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });

  const notFound = (code: string, message: string) => json(404, { error: { code, message } });

  vi.stubGlobal("fetch", async (input: RequestInfo | URL): Promise<Response> => {
    const path = typeof input === "string" ? input : input.toString();
    api.calls.push(path);
    const url = new URL(path, "http://127.0.0.1:4400");
    const params = url.searchParams;

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

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

export interface FakeApi {
  /** Every path the client asked for, in order. */
  calls: string[];
}

export function installApi(options: {
  projects: ProjectView[];
  counts?: Record<string, Counts>;
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

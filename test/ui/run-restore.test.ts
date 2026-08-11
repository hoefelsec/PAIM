/* Restore from the Run tab, against a real workspace (T69).
 *
 * Done: "restore confirmation reverts (integration against a temp
 * workspace)". So nothing is faked between the button and the filesystem: a
 * real Fastify app over a temporary SQLite database drives a scripted agent
 * that really writes files into a temporary workspace, the browser client is
 * rendered against that app, and the assertion is what is on disk after the
 * confirmation is accepted.
 *
 * The only seam is transport: `fetch` is bridged to `app.inject()` instead of
 * a socket, which is the same rule the server suite follows ("no live HTTP in
 * unit tests", specs/README). The Agent SDK is never reached — the transcript
 * is scripted (src/server/runs/fakeAgent.ts).
 *
 * It runs in the *server* project rather than the client one, and raises its
 * own DOM: a browser environment makes Vite transform every imported module
 * for the web, where a server module's `import.meta.url` is not a `file:` URL
 * and `src/server/db/index.ts` cannot resolve `data/paim.db`. Raising jsdom
 * by hand inside a node environment keeps both halves working at once — and
 * the DOM libraries are imported after it exists, because they read `window`
 * as they load.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type Database from "better-sqlite3";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { builtinEnvironments } from "vitest/runtime";
import { createApp } from "../../src/server/app.js";
import { openDatabase } from "../../src/server/db/index.js";
import { clearValidatorCache } from "../../src/server/fields/validator.js";
import { clearVersionCache } from "../../src/server/projects/version.js";
import { createFakeAgent, type FakeToolStep } from "../../src/server/runs/fakeAgent.js";
import type { ProjectView, Task } from "../../src/shared/types.js";

const HOST = "localhost:4400";

let dir: string;
let workspace: string;
let db: Database.Database;
let app: FastifyInstance;
let steps: FakeToolStep[];
let closeDom: (() => PromiseLike<void> | void) | null = null;

/** Loaded once the DOM exists; see the file comment. */
let dom: typeof import("@testing-library/react");
let userEvent: (typeof import("@testing-library/user-event"))["default"];
let harness: typeof import("./harness");

beforeAll(async () => {
  const environment = await builtinEnvironments.jsdom.setup(globalThis, {
    // The service's own origin, so the client's relative requests and the
    // loopback host guard agree.
    jsdom: { url: `http://${HOST}/` },
  });
  closeDom = () => environment.teardown(globalThis);

  dom = await import("@testing-library/react");
  userEvent = (await import("@testing-library/user-event")).default;
  harness = await import("./harness");
});

afterAll(async () => {
  await closeDom?.();
});

beforeEach(() => {
  // jsdom has no `EventSource`, and the shell opens one on every screen
  // (src/app/events.tsx). The stand-in just sits there: this suite drives the
  // interface through requests, not frames.
  harness.installEventSource();
  dir = mkdtempSync(join(tmpdir(), "paim-ui-restore-"));
  workspace = mkdtempSync(join(tmpdir(), "paim-ui-workspace-"));
  db = openDatabase(join(dir, "paim.db"));
  steps = [];
  app = createApp({
    db,
    staticDir: join(dir, "no-client"),
    runs: {
      restoreRoot: join(dir, "restore"),
      createAgent: () => createFakeAgent({ steps }),
    },
  });
  clearVersionCache();
  clearValidatorCache();
});

afterEach(async () => {
  dom.cleanup();
  vi.unstubAllGlobals();
  await app.close();
  db.close();
  rmSync(dir, { recursive: true, force: true });
  rmSync(workspace, { recursive: true, force: true });
});

/* ── the workspace ──────────────────────────────────────────────────────── */

function write(relativePath: string, content: string): void {
  const absolute = join(workspace, relativePath);
  mkdirSync(join(absolute, ".."), { recursive: true });
  writeFileSync(absolute, content);
}

function read(relativePath: string): string {
  return readFileSync(join(workspace, relativePath), "utf-8");
}

/** A Write the scripted agent really performs, once the runner allows it. */
function writeStep(relativePath: string, content: string): FakeToolStep {
  return {
    name: "Write",
    input: { file_path: relativePath, content },
    onDecision: (decision) => {
      if (decision.behavior === "allow") write(relativePath, content);
    },
  };
}

/* ── the transport ──────────────────────────────────────────────────────── */

/**
 * The browser's `fetch`, answered by the app in this process. Every header
 * the client sets travels; the `Host` the loopback guard demands is added
 * here, because a request the client makes carries jsdom's idea of it.
 */
function bridgeFetch(): void {
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input.toString();
    const headers: Record<string, string> = { host: HOST };
    new Headers(init?.headers ?? {}).forEach((value, name) => {
      headers[name] = value;
    });

    const res = await app.inject({
      method: (init?.method ?? "GET") as "GET",
      url,
      headers,
      ...(init?.body === undefined || init?.body === null ? {} : { payload: String(init.body) }),
    });

    return new Response(res.body, {
      status: res.statusCode,
      headers: { "content-type": res.headers["content-type"]?.toString() ?? "application/json" },
    });
  });
}

async function post(url: string, payload: Record<string, unknown>): Promise<unknown> {
  const res = await app.inject({ method: "POST", url, headers: { host: HOST }, payload });
  expect(res.statusCode).toBe(201);
  return res.json().data;
}

/* ── the scenario ───────────────────────────────────────────────────────── */

/** One project, one task, one finished run that wrote real files. */
async function runOnce(): Promise<{ project: ProjectView; task: Task }> {
  const project = (await post("/api/projects", {
    name: "Restore Fixture",
    workspacePath: workspace,
    safety: { denyList: [], mode: "allow_all", askList: [] },
  })) as ProjectView;

  const task = (await post(`/api/projects/${project.slug}/tasks`, {
    title: "Revert what the run wrote",
  })) as Task;

  steps.push(
    writeStep("src/app.ts", "export const value = 2;\n"),
    writeStep("src/added.ts", "export const added = true;\n"),
    // Something Restore cannot undo, so the confirmation has a limit to name.
    { name: "Bash", input: { command: "npm install left-pad" } },
  );

  await post(`/api/projects/${project.slug}/tasks/${task.key}/runs`, {});
  await app.runQueue.idle();
  return { project, task };
}

/** The Run tab, mounted at its own address, once it has a run to show. */
async function openRunTab(project: ProjectView, task: Task): Promise<HTMLElement> {
  bridgeFetch();
  harness.renderApp(`/p/${project.slug}/t/${task.key}/run`);
  await dom.waitFor(() => expect(document.querySelector("[data-slot='run-bar']")).toBeTruthy());
  return document.querySelector<HTMLElement>("[data-tab='run']")!;
}

describe("Restore from the Run tab", () => {
  it("reverts the workspace once the confirmation is accepted", async () => {
    const original = "export const value = 1;\n";
    write("src/app.ts", original);

    const { project, task } = await runOnce();
    // The run really changed the workspace.
    expect(read("src/app.ts")).toBe("export const value = 2;\n");
    expect(existsSync(join(workspace, "src/added.ts"))).toBe(true);

    const user = userEvent.setup();
    const body = await openRunTab(project, task);

    // The log is the real one: three operations, the shell command flagged.
    await dom.waitFor(() => expect(document.querySelectorAll("[data-operation]")).toHaveLength(3));
    expect(document.querySelectorAll("[data-slot='op-irreversible']")).toHaveLength(1);

    await user.click(dom.within(body).getByRole("button", { name: /Restore/ }));
    const dialog = dom.screen.getByRole("dialog", { name: "Restore the workspace" });
    expect(dialog.querySelector("[data-slot='restore-limit']")!.textContent).toContain(
      "npm install left-pad",
    );
    // Nothing has moved yet: the confirmation is the gate.
    expect(read("src/app.ts")).toBe("export const value = 2;\n");

    await user.click(dom.within(dialog).getByRole("button", { name: "Restore the workspace" }));

    await dom.waitFor(() =>
      expect(document.querySelector("[data-slot='restore-done']")).toBeTruthy(),
    );
    expect(document.querySelector("[data-slot='restore-done']")!.textContent).toContain(
      "1 file restored · 1 removed",
    );

    // The filesystem, byte for byte.
    expect(read("src/app.ts")).toBe(original);
    expect(existsSync(join(workspace, "src/added.ts"))).toBe(false);
  });

  it("leaves the workspace alone when the confirmation is declined", async () => {
    write("src/app.ts", "export const value = 1;\n");
    const { project, task } = await runOnce();

    const user = userEvent.setup();
    const body = await openRunTab(project, task);

    await user.click(dom.within(body).getByRole("button", { name: /Restore/ }));
    await user.click(dom.screen.getByRole("button", { name: "Keep the changes" }));

    expect(dom.screen.queryByRole("dialog")).toBeNull();
    expect(read("src/app.ts")).toBe("export const value = 2;\n");
    expect(existsSync(join(workspace, "src/added.ts"))).toBe(true);
  });
});

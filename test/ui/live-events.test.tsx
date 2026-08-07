/* Live updates over `/api/events` (specs/06-events.md T22).
 *
 * The Done line: "a task created via curl appears in an open table without
 * refresh (browser-mode test); indicator flips when the server drops." jsdom
 * has no `EventSource`, so `MockEventSource` (test/ui/harness.tsx) stands in
 * for the browser and is driven by hand: `.emit()` is one frame off the wire,
 * `.open()`/`.error()` are the connection events a real stream would raise.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, screen, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import {
  installApi,
  installEventSource,
  makeProject,
  makeTask,
  MockEventSource,
  renderApp,
} from "./harness";
import { invalidateForEvent } from "../../src/app/events";
import type { TaskView } from "../../src/app/table";
import type { ChangeEvent } from "../../src/shared/events.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("invalidateForEvent", () => {
  it("invalidates task lists and project stats on a task change", () => {
    const client = new QueryClient();
    const spy = vi.spyOn(client, "invalidateQueries");

    const event: ChangeEvent = { type: "task", id: "t1", projectId: "p1", change: "created" };
    invalidateForEvent(client, event);

    expect(spy).toHaveBeenCalledWith({ queryKey: ["tasks"] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["project-stats"] });
  });

  it("invalidates the project list, the single project, and its stats on a project change", () => {
    const client = new QueryClient();
    const spy = vi.spyOn(client, "invalidateQueries");

    invalidateForEvent(client, { type: "project", id: "p1", projectId: "p1", change: "updated" });

    expect(spy).toHaveBeenCalledWith({ queryKey: ["projects"] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["project"] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["project-stats"] });
  });

  it("invalidates the project (the schema lives on its row) on a schema change", () => {
    const client = new QueryClient();
    const spy = vi.spyOn(client, "invalidateQueries");

    invalidateForEvent(client, { type: "schema", id: "p1", projectId: "p1", change: "updated" });

    expect(spy).toHaveBeenCalledWith({ queryKey: ["project"] });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("does nothing for a view change — no saved-view query exists yet", () => {
    const client = new QueryClient();
    const spy = vi.spyOn(client, "invalidateQueries");

    invalidateForEvent(client, { type: "view", id: "v1", projectId: "p1", change: "created" });

    expect(spy).not.toHaveBeenCalled();
  });
});

const PAIM = makeProject({ slug: "paim", name: "PAIM" });

const rowFor = (key: string) => document.querySelector<HTMLTableRowElement>(`tr[data-task='${key}']`);

describe("the table, live", () => {
  it("shows a task created elsewhere without the user refreshing anything", async () => {
    installEventSource();
    const tasks: TaskView[] = [
      makeTask({ id: "t-1", key: "FEAT-1", title: "Existing task", status: "ready" }),
    ];
    installApi({ projects: [PAIM], tasks: { paim: tasks } });

    renderApp("/p/paim");
    await waitFor(() => expect(rowFor("FEAT-1")).toBeTruthy());
    expect(rowFor("FEAT-2")).toBeNull();

    const source = MockEventSource.instances[0]!;
    expect(source.url).toBe("/api/events");
    act(() => source.open());

    // A `curl` elsewhere creates a task: the storage layer writes it (it is
    // now in the fake service's backing array) and the change bus emits one
    // frame. Both happen before the client hears about either.
    tasks.push(makeTask({ id: "t-2", key: "FEAT-2", title: "Created via curl", status: "ready" }));
    act(() => {
      source.emit({ type: "task", id: "t-2", projectId: PAIM.id, change: "created" });
    });

    await waitFor(() => expect(rowFor("FEAT-2")).toBeTruthy());
    expect(rowFor("FEAT-2")!.textContent).toContain("Created via curl");
  });
});

describe("the live indicator", () => {
  it("starts connecting, flips to live on open, and to offline when the server drops", async () => {
    installEventSource();
    installApi({ projects: [PAIM], tasks: { paim: [] } });

    renderApp("/p/paim");
    await waitFor(() => expect(MockEventSource.instances).toHaveLength(1));

    const indicator = () => screen.getByTestId("live-indicator");
    expect(indicator().dataset["state"]).toBe("connecting");
    expect(indicator().textContent).toBe("Connecting");

    const source = MockEventSource.instances[0]!;
    act(() => source.open());
    expect(indicator().dataset["state"]).toBe("open");
    expect(indicator().textContent).toBe("Live");

    act(() => source.error());
    expect(indicator().dataset["state"]).toBe("closed");
    expect(indicator().textContent).toBe("Offline");
  });

  it("revalidates every cache on reconnect, not just what arrived while it was down", async () => {
    installEventSource();
    const tasks: TaskView[] = [makeTask({ id: "t-1", key: "FEAT-1", status: "ready" })];
    const api = installApi({ projects: [PAIM], tasks: { paim: tasks } });

    renderApp("/p/paim");
    await waitFor(() => expect(rowFor("FEAT-1")).toBeTruthy());

    const source = MockEventSource.instances[0]!;
    act(() => source.open());
    const callsBeforeDrop = api.calls.length;

    act(() => source.error());
    // The connection comes back after being down once: a real EventSource
    // would have retried on its own and fired `onopen` again.
    act(() => source.open());

    await waitFor(() => expect(api.calls.length).toBeGreaterThan(callsBeforeDrop));
  });
});

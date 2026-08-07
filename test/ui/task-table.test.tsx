/* The task table at `/p/:project` (docs/07 "The table", T19).
 *
 * The mockup this checks against is design/mockups.html "Table · epic": one
 * density, glyph columns, a group row per status, and an epic that opens in
 * place over its children.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { installApi, makeProject, makeTask, Providers, renderApp } from "./harness";
import { TaskTable } from "../../src/app/TaskTable";
import { PRIORITY_LABEL, SIZE_LABEL, TYPE_LABEL } from "../../src/ui/vocabulary";
import type { TaskView } from "../../src/app/table";

const PAIM = makeProject({
  slug: "paim",
  name: "PAIM",
  fieldSchema: [
    { key: "type", type: "select", options: ["feature", "bug", "chore", "spike", "debt"] },
    { key: "layer", type: "select", options: ["api", "ui"], showInTable: true, label: "Layer" },
  ],
});

/** The rows of design/mockups.html "Table · epic", trimmed to what T19 owns. */
const EPIC = makeTask({
  id: "epic-20",
  key: "FEAT-20",
  title: "Pagination overhaul",
  status: "ready",
  priority: "high",
  size: "Epic",
  fields: { type: "feature", layer: "api" },
  progress: { done: 3, cancelled: 0, total: 7 },
});

const KIDS = [
  makeTask({
    id: "kid-12",
    key: "CHORE-12",
    title: "Cursor pagination on the task list endpoint",
    status: "ready",
    priority: "low",
    size: "S",
    parentId: "epic-20",
    fields: { type: "chore" },
  }),
  makeTask({
    id: "kid-21",
    key: "BUG-21",
    title: "Cursor encoding is not stable across restarts",
    status: "ready",
    priority: "high",
    size: "M",
    parentId: "epic-20",
    fields: { type: "bug" },
  }),
];

const EXECUTING = [
  makeTask({
    id: "t-4",
    key: "FEAT-4",
    title: "Table view: grouping, inline edit, column resize",
    status: "executing",
    priority: "high",
    size: "M",
    fields: { type: "feature", layer: "ui" },
  }),
  makeTask({
    id: "t-3",
    key: "FEAT-3",
    title: "Per-project field schema validation",
    status: "executing",
    priority: "urgent",
    size: "L",
    fields: { type: "feature", layer: "api" },
  }),
];

const TASKS = [...EXECUTING, EPIC, ...KIDS];

function mount(tasks: TaskView[] = TASKS) {
  installApi({ projects: [PAIM], tasks: { paim: tasks } });
  return renderApp("/p/paim");
}

/** Every task row on screen, in document order. Group rows are not tasks. */
function rows(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>("tr[data-task]")];
}

const rowFor = (key: string) => document.querySelector<HTMLTableRowElement>(`tr[data-task='${key}']`);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("columns", () => {
  it("heads Key · Title · Prio · Type · Size · Updated plus the showInTable fields", async () => {
    mount();
    await screen.findByRole("columnheader", { name: "Key" });

    const heads = screen
      .getAllByRole("columnheader")
      .map((head) => head.textContent?.trim());
    expect(heads).toEqual(["Key", "Title", "Prio", "Type", "Size", "Layer", "Updated"]);
  });

  it("prints the custom value in its column", async () => {
    mount();
    const row = await waitFor(() => {
      const found = rowFor("FEAT-4");
      expect(found).toBeTruthy();
      return found!;
    });
    expect(row.cells[5]?.textContent).toBe("ui");
  });
});

describe("rows", () => {
  it("is one density: 33 pixel rows from the token", async () => {
    mount();
    await waitFor(() => expect(rowFor("FEAT-4")).toBeTruthy());

    // The height is a token, and Tailwind is not compiled in jsdom, so the
    // check is in two halves: the row reads --row-h, and --row-h is 33px.
    expect(rowFor("FEAT-4")!.className).toContain("h-[var(--row-h)]");
    const tokens = readFileSync(resolve(process.cwd(), "src/styles/tokens.css"), "utf-8");
    expect(tokens).toMatch(/--row-h:\s*33px/);
  });

  it("sets the key in monospace — it is an identifier", async () => {
    mount();
    await waitFor(() => expect(rowFor("FEAT-4")).toBeTruthy());

    const key = rowFor("FEAT-4")!.cells[0]!;
    expect(key.textContent).toBe("FEAT-4");
    expect(key.className).toContain("font-mono");
  });

  it("draws priority, type and size as glyphs that name themselves on hover", async () => {
    mount();
    await waitFor(() => expect(rowFor("FEAT-3")).toBeTruthy());
    const row = rowFor("FEAT-3")!;

    expect(within(row).getByRole("img", { name: PRIORITY_LABEL.urgent })).toBeTruthy();
    expect(within(row).getByRole("img", { name: TYPE_LABEL.feature })).toBeTruthy();
    expect(within(row).getByRole("img", { name: SIZE_LABEL.L })).toBeTruthy();
  });

  it("shows how long ago the task was updated", async () => {
    const task = makeTask({
      key: "FEAT-99",
      status: "ready",
      updatedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    });
    mount([task]);
    await waitFor(() => expect(rowFor("FEAT-99")).toBeTruthy());

    const row = rowFor("FEAT-99")!;
    expect(row.cells[row.cells.length - 1]?.textContent).toBe("2h ago");
  });

  it("says so when the project has no tasks", async () => {
    mount([]);
    expect(await screen.findByText("No tasks in this project yet.")).toBeTruthy();
  });
});

describe("group rows", () => {
  it("groups by status, in pipeline order, with a live count", async () => {
    mount();
    await waitFor(() => expect(rowFor("FEAT-4")).toBeTruthy());

    const groups = [...document.querySelectorAll<HTMLElement>("tr[data-group]")];
    expect(groups.map((group) => group.dataset["group"])).toEqual(["ready", "executing"]);
    // The epic is one row of `ready`; its two children are not.
    expect(groups[0]?.textContent).toContain("Ready");
    expect(groups[0]?.textContent).toContain("1");
    expect(groups[1]?.textContent).toContain("Executing");
    expect(groups[1]?.textContent).toContain("2");
  });

  it("collapses a group without touching the others", async () => {
    const user = userEvent.setup();
    mount();
    await waitFor(() => expect(rowFor("FEAT-4")).toBeTruthy());

    await user.click(screen.getByRole("button", { name: "Collapse Executing" }));

    expect(rowFor("FEAT-4")).toBeNull();
    expect(rowFor("FEAT-20")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Expand Executing" }));
    expect(rowFor("FEAT-4")).toBeTruthy();
  });
});

describe("epics", () => {
  it("carries a disclosure triangle, the n/m done count, and the Epic mark", async () => {
    mount();
    await waitFor(() => expect(rowFor("FEAT-20")).toBeTruthy());
    const row = rowFor("FEAT-20")!;

    expect(within(row).getByRole("button", { name: "Expand FEAT-20" })).toBeTruthy();
    expect(row.textContent).toContain("3/7 done");
    // Size is a container mark, not a point on the dot scale.
    expect(within(row).getByTitle(SIZE_LABEL.Epic).textContent).toBe("Epic");
    expect(within(row).queryByRole("img", { name: SIZE_LABEL.M })).toBeNull();
  });

  it("shows the children indented in place, under the epic, and closes again", async () => {
    const user = userEvent.setup();
    mount();
    await waitFor(() => expect(rowFor("FEAT-20")).toBeTruthy());

    expect(rowFor("CHORE-12")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Expand FEAT-20" }));

    const order = rows().map((row) => row.dataset["task"]);
    expect(order).toEqual(["FEAT-20", "CHORE-12", "BUG-21", "FEAT-4", "FEAT-3"]);
    expect(rowFor("CHORE-12")!.dataset["child"]).toBe("true");
    // A child never appears a second time in its own status group.
    expect(document.querySelectorAll("tr[data-task='CHORE-12']")).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: "Collapse FEAT-20" }));
    expect(rowFor("CHORE-12")).toBeNull();
  });

  it("keeps the scroll position: expanding is view state, not navigation", async () => {
    const user = userEvent.setup();
    const { container } = mount();
    await waitFor(() => expect(rowFor("FEAT-20")).toBeTruthy());

    const pane = container.querySelector<HTMLElement>("[data-slot='main']")!;
    pane.scrollTop = 240;

    await user.click(screen.getByRole("button", { name: "Expand FEAT-20" }));

    // The same scroll container, at the same offset, at the same address.
    expect(container.querySelector("[data-slot='main']")).toBe(pane);
    expect(pane.scrollTop).toBe(240);
    expect(window.location.pathname).toBe("/p/paim");

    await user.click(screen.getByRole("button", { name: "Collapse FEAT-20" }));

    expect(container.querySelector("[data-slot='main']")).toBe(pane);
    expect(pane.scrollTop).toBe(240);
  });
});

describe("a thousand tasks", () => {
  it("renders them all, and an epic still opens in a fraction of the mount", async () => {
    const seeded: TaskView[] = [
      EPIC,
      ...KIDS,
      ...Array.from({ length: 1000 }, (_, i) =>
        makeTask({
          id: `seed-${i}`,
          key: `FEAT-${100 + i}`,
          title: `Seeded task ${i}`,
          status: i % 2 === 0 ? "ready" : "executing",
          priority: "medium",
          size: "S",
          fields: { type: "feature" },
        }),
      ),
    ];

    const started = performance.now();
    mount(seeded);
    await waitFor(() => expect(rows()).toHaveLength(1001), { timeout: 30_000 });
    const mounted = performance.now() - started;

    // A row far from the epic: it must survive the toggle, not be rebuilt.
    const untouched = rowFor("FEAT-600")!;

    const opened = performance.now();
    fireEvent.click(screen.getByRole("button", { name: "Expand FEAT-20" }));
    const toggled = performance.now() - opened;

    expect(rows()).toHaveLength(1003);
    expect(rowFor("FEAT-600")).toBe(untouched);
    // Rows are memoised on their task, so opening an epic costs the rows it
    // added — not the thousand rows around it.
    expect(toggled).toBeLessThan(mounted / 2);
  }, 60_000);
});

describe("the shell around it", () => {
  it("puts the table in the main pane, under the switcher", async () => {
    const { container } = mount();
    await waitFor(() => expect(rowFor("FEAT-4")).toBeTruthy());

    const main = container.querySelector("[data-slot='main']")!;
    expect(main.querySelector("table")).toBeTruthy();
  });

  it("reports a failed read instead of an empty table", async () => {
    const ok = (body: unknown) =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });

    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const path = typeof input === "string" ? input : input.toString();
      if (path.includes("/tasks")) {
        return new Response(JSON.stringify({ error: { code: "INTERNAL", message: "boom" } }), {
          status: 500,
          headers: { "content-type": "application/json" },
        });
      }
      if (path.startsWith("/api/projects?")) {
        return ok({ data: [PAIM], meta: { total: 1, cursor: null, hasMore: false } });
      }
      return ok({ data: PAIM });
    });
    renderApp("/p/paim");

    expect(await screen.findByText(/could not be read/)).toBeTruthy();
  });
});

describe("paging", () => {
  it("walks the cursor so the table holds the whole project", async () => {
    // 620 tasks is two pages of the 500-row maximum of docs/06.
    const seeded = Array.from({ length: 620 }, (_, i) =>
      makeTask({ id: `p-${i}`, key: `FEAT-${i}`, status: "ready" }),
    );
    const api = installApi({ projects: [PAIM], tasks: { paim: seeded } });
    // The table alone: this case is about the request walk, not the shell.
    render(
      <Providers>
        <TaskTable slug="paim" />
      </Providers>,
    );

    await waitFor(() => expect(rows()).toHaveLength(620), { timeout: 30_000 });
    expect(api.calls.filter((path) => path.includes("cursor="))).toHaveLength(1);
  }, 60_000);
});

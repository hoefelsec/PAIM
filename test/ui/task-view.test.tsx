/* The task view at `/p/:project/t/:key` (T24, docs/07 "The task view").
 *
 * "The task view is a full screen with tabs. It is not a panel." — so the
 * checks here are: a deep link loads the whole screen, the Overview tab shows
 * the description and the original prompt, the rail is a back link, and every
 * property in the right column edits in place and reaches the service
 * (docs/07 "Editing", the same rules as the table).
 *
 * The fake service in ./harness applies a write the way
 * src/server/routes/tasks.ts does, `If-Match` included.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { installApi, makeProject, makeTask, renderApp, type FakeApi } from "./harness";
import { PRIORITY_LABEL, SIZE_LABEL, STATUS_LABEL, TYPE_LABEL } from "../../src/ui/vocabulary";
import type { TaskView } from "../../src/app/table";

const PAIM = makeProject({
  slug: "paim",
  name: "PAIM",
  statuses: ["backlog", "open_questions", "design", "ready", "executing", "done"],
  fieldSchema: [
    { key: "type", type: "select", options: ["feature", "bug", "chore"] },
    { key: "layer", type: "select", options: ["api", "ui"], showInTable: true, label: "Layer" },
    { key: "points", type: "number", order: 2 },
    // Not a table column, and not hidden: the properties column still shows
    // it — that is the difference between the two surfaces (docs/03).
    { key: "notes", type: "long_text", order: 3 },
    // Removed from the schema: gone from the column, value untouched.
    { key: "legacy", type: "text", hidden: true, order: 4 },
  ],
});

const DESCRIPTION = [
  "Build a Zod schema from each project's `fieldSchema` and cache it.",
  "",
  "- invalidate on a schema write",
  "- unknown keys are refused by default",
].join("\n");

function seed(): TaskView[] {
  return [
    makeTask({
      id: "t-3",
      key: "FEAT-3",
      title: "Per-project field schema validation",
      description: DESCRIPTION,
      sourcePrompt: "the field validation needs to actually be per project",
      status: "executing",
      priority: "high",
      size: "L",
      labels: ["storage"],
      assignee: "edu",
      fields: { type: "feature", layer: "api", points: 3, notes: "", legacy: "kept" },
      updatedAt: "2026-01-01T10:00:00.000Z",
    }),
    makeTask({ id: "t-4", key: "FEAT-4", title: "Table view", status: "ready" }),
  ];
}

interface Mounted {
  api: FakeApi;
  tasks: TaskView[];
  user: ReturnType<typeof userEvent.setup>;
}

function mount(
  options: {
    path?: string;
    rejectWrites?: { status: number; code: string; message?: string };
    task?: Partial<TaskView>;
  } = {},
): Mounted {
  const tasks = seed();
  if (options.task) Object.assign(tasks[0]!, options.task);
  const api = installApi({
    projects: [PAIM],
    tasks: { paim: tasks },
    ...(options.rejectWrites ? { rejectWrites: options.rejectWrites } : {}),
  });
  const user = userEvent.setup();
  renderApp(options.path ?? "/p/paim/t/FEAT-3");
  return { api, tasks, user };
}

/** Waits for the screen, then hands back the task view element. */
async function view(): Promise<HTMLElement> {
  await waitFor(() =>
    expect(document.querySelector<HTMLElement>("[data-slot='task-view']")).toBeTruthy(),
  );
  return document.querySelector<HTMLElement>("[data-slot='task-view']")!;
}

/** One property row of the right column. */
function property(id: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(`[data-property='${id}']`);
  if (!found) throw new Error(`no ${id} property on the task view`);
  return found;
}

/** Opens one property for editing, the way a user does: a click on the value. */
async function open(user: Mounted["user"], id: string) {
  await user.click(property(id).querySelector<HTMLElement>(`[data-edit='${id}']`)!);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the deep link", () => {
  it("loads the full page: crumb, title, status pill and the tab row", async () => {
    await mount();
    const page = await view();

    // The crumb goes back to the list, and the key is beside it.
    const crumb = within(page).getByRole("navigation", { name: "Breadcrumb" });
    expect(within(crumb).getByRole("link", { name: "All tasks" }).getAttribute("href")).toBe(
      "/p/paim",
    );
    expect(crumb.textContent).toContain("FEAT-3");

    expect(
      within(page).getByRole("heading", { name: "Per-project field schema validation" }),
    ).toBeTruthy();
    // The status pill, in the header — the same status the property shows.
    expect(within(page).getAllByText(STATUS_LABEL.executing).length).toBeGreaterThan(0);

    // Only Overview until the later tabs arrive (T24 scope).
    expect(within(page).getByRole("button", { name: "Overview" })).toBeTruthy();
    for (const later of ["Questions", "Design", "Run", "Tests", "Review"]) {
      expect(within(page).queryByRole("button", { name: later })).toBeNull();
    }

    // A full screen, not a panel over the table.
    expect(document.querySelector("table")).toBeNull();
  });

  it("makes the rail a link back to the task list, with no facets", async () => {
    await mount();
    await view();
    const rail = document.querySelector<HTMLElement>("[data-slot='rail']")!;

    expect(within(rail).getByRole("link", { name: /All tasks/ }).getAttribute("href")).toBe(
      "/p/paim",
    );
    expect(rail.querySelector("[aria-label='Filters']")).toBeNull();
    // The switcher stays: the workspace still scopes the screen (docs/07).
    expect(document.querySelector("[data-slot='rail']")).toBeTruthy();
  });

  it("reads the one task, not the whole project", async () => {
    const { api } = mount();
    await view();

    expect(api.calls).toContain("/api/projects/paim/tasks/FEAT-3");
    // The switcher still counts open tasks (`limit=1`), but nothing walks the
    // project's task list the way the table does (`limit=500`, ./queries.ts).
    expect(api.calls.some((path) => path.includes("limit=500"))).toBe(false);
  });

  it("goes back to the table from the crumb", async () => {
    const { user } = mount();
    const page = await view();

    await user.click(within(page).getByRole("navigation", { name: "Breadcrumb" }).querySelector("a")!);

    await waitFor(() => expect(document.querySelector("table")).toBeTruthy());
    expect(window.location.pathname).toBe("/p/paim");
  });

  it("says so when the key is not a task in this project", async () => {
    mount({ path: "/p/paim/t/FEAT-99" });

    await waitFor(() => expect(screen.getByText(/No task/)).toBeTruthy());
    expect(document.querySelector("[data-slot='task-view']")).toBeNull();
  });
});

describe("the Overview tab", () => {
  it("renders the description as markdown", async () => {
    await mount();
    const page = await view();

    const overview = page.querySelector<HTMLElement>("[data-tab='overview']")!;
    expect(within(overview).getByText("fieldSchema").tagName).toBe("CODE");
    expect(within(overview).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "invalidate on a schema write",
      "unknown keys are refused by default",
    ]);
  });

  it("shows the original prompt when the task has one", async () => {
    await mount();
    const page = await view();

    const prompt = page.querySelector<HTMLElement>("[data-slot='source-prompt']")!;
    expect(prompt.textContent).toBe("the field validation needs to actually be per project");
    expect(within(page).getByText("Original prompt")).toBeTruthy();
  });

  it("shows no prompt block when there is no prompt, and says a description is missing", async () => {
    mount({ task: { sourcePrompt: "", description: "" } });
    const page = await view();

    expect(page.querySelector("[data-slot='source-prompt']")).toBeNull();
    expect(within(page).queryByText("Original prompt")).toBeNull();
    expect(within(page).getByText("No description yet.")).toBeTruthy();
  });
});

describe("the properties column", () => {
  it("lists the properties docs/07 names, in order", async () => {
    await mount();
    const page = await view();

    const ids = [...page.querySelectorAll<HTMLElement>("[data-property]")].map(
      (node) => node.dataset["property"],
    );
    expect(ids).toEqual([
      "status",
      "priority",
      "size",
      "type",
      "field.layer",
      "field.points",
      "field.notes",
      "labels",
      "assignee",
    ]);
    // A removed field is off the column; its stored value is untouched.
    expect(page.querySelector("[data-property='field.legacy']")).toBeNull();
  });

  it("prints each value, glyph and word together", async () => {
    await mount();
    await view();

    expect(property("status").textContent).toContain(STATUS_LABEL.executing);
    expect(property("priority").textContent).toContain(PRIORITY_LABEL.high);
    expect(property("size").textContent).toContain(SIZE_LABEL.L);
    expect(property("type").textContent).toContain(TYPE_LABEL.feature);
    expect(property("field.layer").textContent).toContain("api");
    expect(property("field.points").textContent).toContain("3");
    expect(property("labels").textContent).toContain("storage");
    expect(property("assignee").textContent).toContain("edu");
    // An empty value is a dash, not a blank row.
    expect(property("field.notes").textContent).toContain("—");
  });
});

describe("editing a property", () => {
  it("moves the task through the pipeline from the status menu", async () => {
    const { api, tasks, user } = mount();
    await view();

    await open(user, "status");
    const menu = screen.getByRole("combobox", { name: "Status of FEAT-3" });
    // The menu is this project's pipeline, in catalogue order (docs/04).
    expect(within(menu).getAllByRole("option").map((option) => option.textContent)).toEqual([
      STATUS_LABEL.backlog,
      STATUS_LABEL.open_questions,
      STATUS_LABEL.design,
      STATUS_LABEL.ready,
      STATUS_LABEL.executing,
      STATUS_LABEL.done,
    ]);
    await user.selectOptions(menu, "done");

    await waitFor(() => expect(api.writes).toHaveLength(1));
    expect(api.writes[0]!.path).toBe("/api/projects/paim/tasks/FEAT-3");
    expect(api.writes[0]!.body).toEqual({ status: "done" });
    // It persisted: the service holds it, and the screen shows what it holds.
    expect(tasks[0]!.status).toBe("done");
    await waitFor(() => expect(property("status").textContent).toContain(STATUS_LABEL.done));
  });

  it("writes priority, size and type through their menus", async () => {
    const { api, tasks, user } = mount();
    await view();

    await open(user, "priority");
    await user.selectOptions(screen.getByRole("combobox", { name: "Prio of FEAT-3" }), "urgent");
    await waitFor(() => expect(api.writes).toHaveLength(1));
    expect(api.writes[0]!.body).toEqual({ priority: "urgent" });
    await waitFor(() => expect(property("priority").textContent).toContain(PRIORITY_LABEL.urgent));

    await open(user, "size");
    await user.selectOptions(screen.getByRole("combobox", { name: "Size of FEAT-3" }), "XS");
    await waitFor(() => expect(api.writes).toHaveLength(2));
    expect(api.writes[1]!.body).toEqual({ size: "XS" });
    await waitFor(() => expect(property("size").textContent).toContain(SIZE_LABEL.XS));

    await open(user, "type");
    await user.selectOptions(screen.getByRole("combobox", { name: "Type of FEAT-3" }), "bug");
    await waitFor(() => expect(api.writes).toHaveLength(3));
    expect(api.writes[2]!.body).toEqual({ fields: { type: "bug" } });
    await waitFor(() => expect(property("type").textContent).toContain(TYPE_LABEL.bug));

    expect(tasks[0]!.priority).toBe("urgent");
    expect(tasks[0]!.size).toBe("XS");
    expect(tasks[0]!.fields["type"]).toBe("bug");
  });

  it("writes a custom field into `fields`, not the core", async () => {
    const { api, tasks, user } = mount();
    await view();

    await open(user, "field.layer");
    await user.selectOptions(screen.getByRole("combobox", { name: "Layer of FEAT-3" }), "ui");
    await waitFor(() => expect(api.writes).toHaveLength(1));
    expect(api.writes[0]!.body).toEqual({ fields: { layer: "ui" } });

    await open(user, "field.points");
    const points = screen.getByRole("textbox", { name: "Points of FEAT-3" });
    await user.clear(points);
    await user.type(points, "8{Enter}");
    await waitFor(() => expect(api.writes).toHaveLength(2));
    expect(api.writes[1]!.body).toEqual({ fields: { points: 8 } });

    expect(tasks[0]!.fields).toMatchObject({ layer: "ui", points: 8 });
    await waitFor(() => expect(property("field.points").textContent).toContain("8"));
  });

  it("writes labels as a list and clears an assignee to null", async () => {
    const { api, tasks, user } = mount();
    await view();

    await open(user, "labels");
    const labels = screen.getByRole("textbox", { name: "Labels of FEAT-3" });
    expect((labels as HTMLInputElement).value).toBe("storage");
    await user.clear(labels);
    await user.type(labels, "storage, api{Enter}");
    await waitFor(() => expect(api.writes).toHaveLength(1));
    expect(api.writes[0]!.body).toEqual({ labels: ["storage", "api"] });
    await waitFor(() => expect(property("labels").textContent).toContain("api"));

    await open(user, "assignee");
    const assignee = screen.getByRole("textbox", { name: "Assignee of FEAT-3" });
    await user.clear(assignee);
    // Blur is the save (docs/07): clicking outside commits.
    await user.click(screen.getByRole("heading", { name: /Per-project field schema/ }));
    await waitFor(() => expect(api.writes).toHaveLength(2));
    expect(api.writes[1]!.body).toEqual({ assignee: null });

    expect(tasks[0]!.labels).toEqual(["storage", "api"]);
    expect(tasks[0]!.assignee).toBeNull();
    await waitFor(() => expect(property("assignee").textContent).toContain("—"));
  });

  it("sends If-Match: the screen is the version being edited", async () => {
    const { api, user } = mount();
    await view();

    await open(user, "priority");
    await user.selectOptions(screen.getByRole("combobox", { name: "Prio of FEAT-3" }), "low");

    await waitFor(() => expect(api.writes).toHaveLength(1));
    expect(api.writes[0]!.ifMatch).toBe("2026-01-01T10:00:00.000Z");
  });

  it("cancels on Esc and writes nothing", async () => {
    const { api, user } = mount();
    await view();

    await open(user, "assignee");
    const input = screen.getByRole("textbox", { name: "Assignee of FEAT-3" });
    await user.clear(input);
    await user.type(input, "someone else{Escape}");

    expect(screen.queryByRole("textbox", { name: "Assignee of FEAT-3" })).toBeNull();
    expect(api.writes).toHaveLength(0);
    expect(property("assignee").textContent).toContain("edu");
  });

  it("does not write when nothing changed", async () => {
    const { api, user } = mount();
    await view();

    await open(user, "labels");
    await user.click(screen.getByRole("heading", { name: /Per-project field schema/ }));

    expect(api.writes).toHaveLength(0);
    expect(property("labels").textContent).toContain("storage");
  });

  it("flashes the property clay and puts the value back when the write is refused", async () => {
    const { api, user } = mount({
      rejectWrites: { status: 422, code: "STATUS_NOT_ENABLED", message: "not in the pipeline" },
    });
    await view();

    await open(user, "priority");
    await user.selectOptions(screen.getByRole("combobox", { name: "Prio of FEAT-3" }), "urgent");

    await waitFor(() => expect(property("priority").dataset["rejected"]).toBe("true"));
    expect(property("priority").className).toContain("bg-pr-urgent");
    expect(api.writes).toHaveLength(1);
    // Back to what the service holds — and no dialog, no toast (docs/07).
    expect(property("priority").textContent).toContain(PRIORITY_LABEL.high);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();

    // A flash, not a state the row stays in (docs/13 "Motion").
    await waitFor(() => expect(property("priority").dataset["rejected"]).toBeUndefined(), {
      timeout: 3_000,
    });
  });

  it("reverts on an If-Match conflict: another writer moved the task", async () => {
    const { api, tasks, user } = mount();
    await view();

    tasks[0]!.priority = "low";
    tasks[0]!.updatedAt = "2026-01-01T11:00:00.000Z";

    await open(user, "priority");
    await user.selectOptions(screen.getByRole("combobox", { name: "Prio of FEAT-3" }), "urgent");

    await waitFor(() => expect(property("priority").dataset["rejected"]).toBe("true"));
    expect(api.writes[0]!.ifMatch).toBe("2026-01-01T10:00:00.000Z");
    // The other write stands: this one changed nothing.
    expect(tasks[0]!.priority).toBe("low");
    expect(property("priority").textContent).toContain(PRIORITY_LABEL.high);
  });

  it("edits one property at a time", async () => {
    const { user } = mount();
    await view();

    await open(user, "labels");
    await open(user, "assignee");

    expect(screen.queryByRole("textbox", { name: "Labels of FEAT-3" })).toBeNull();
    expect(screen.getByRole("textbox", { name: "Assignee of FEAT-3" })).toBeTruthy();
  });
});

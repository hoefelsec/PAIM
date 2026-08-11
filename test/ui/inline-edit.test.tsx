/* Inline editing in the table (docs/07 "Editing", T21).
 *
 * docs/07: "Click a value, change it, and click outside to save. There are no
 * modal forms and no Save control." — and "The interface shows the change at
 * once. It reconciles with the response. A rejected write makes the row flash
 * and then returns to the previous value."
 *
 * The title is not an inline edit: a click on it opens the task view, and the
 * rename lives there (test/ui/task-view.test.tsx). The text-input flows here
 * run through a text custom field instead.
 *
 * The fake service in ./harness applies a write the way
 * src/server/routes/tasks.ts does, `If-Match` included, so a conflict here is
 * the conflict of docs/06 and not a mock of one.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { installApi, makeProject, makeTask, renderApp, type FakeApi } from "./harness";
import { PRIORITY_LABEL, SIZE_LABEL, TYPE_LABEL } from "../../src/ui/vocabulary";
import type { TaskView } from "../../src/app/table";

const PAIM = makeProject({
  slug: "paim",
  name: "PAIM",
  fieldSchema: [
    { key: "type", type: "select", options: ["feature", "bug", "chore"] },
    { key: "layer", type: "select", options: ["api", "ui"], showInTable: true, label: "Layer" },
    { key: "points", type: "number", showInTable: true, order: 2 },
    { key: "team", type: "text", showInTable: true, order: 3, label: "Team" },
  ],
});

function seed(): TaskView[] {
  return [
    makeTask({
      id: "t-4",
      key: "FEAT-4",
      title: "Table view",
      status: "executing",
      priority: "low",
      size: "M",
      fields: { type: "feature", layer: "ui", points: 3, team: "core" },
      updatedAt: "2026-01-01T10:00:00.000Z",
    }),
    makeTask({
      id: "t-3",
      key: "FEAT-3",
      title: "Field schema validation",
      status: "executing",
      priority: "urgent",
      size: "L",
      fields: { type: "feature", layer: "api", team: "infra" },
      updatedAt: "2026-01-01T09:00:00.000Z",
    }),
  ];
}

interface Mounted {
  api: FakeApi;
  tasks: TaskView[];
  user: ReturnType<typeof userEvent.setup>;
}

function mount(
  options: { rejectWrites?: { status: number; code: string; message?: string } } = {},
): Mounted {
  const tasks = seed();
  const api = installApi({ projects: [PAIM], tasks: { paim: tasks }, ...options });
  const user = userEvent.setup();
  renderApp("/p/paim");
  return { api, tasks, user };
}

const rowFor = (key: string) =>
  document.querySelector<HTMLTableRowElement>(`tr[data-task='${key}']`);

/** Waits for the table, then hands back the row under test. */
async function row(key = "FEAT-4"): Promise<HTMLTableRowElement> {
  await waitFor(() => expect(rowFor(key)).toBeTruthy());
  return rowFor(key)!;
}

/** The cell of one column on one row — the click target of an inline edit. */
function cell(key: string, columnId: string): HTMLElement {
  const found = rowFor(key)?.querySelector<HTMLElement>(`[data-edit='${columnId}']`);
  if (!found) throw new Error(`no editable ${columnId} cell on ${key}`);
  return found;
}

/** Opens one cell for editing, the way a user does: a click on the value. */
async function open(user: Mounted["user"], key: string, columnId: string) {
  await user.click(cell(key, columnId));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("opening a cell", () => {
  it("puts a text input in the cell, with the value in it", async () => {
    const { user } = mount();
    await row();

    await open(user, "FEAT-4", "field.team");

    const input = screen.getByRole("textbox", { name: "Team of FEAT-4" });
    expect((input as HTMLInputElement).value).toBe("core");
    expect(document.activeElement).toBe(input);
    // In the cell, in the row — not a form on top of the table (docs/07).
    expect(rowFor("FEAT-4")!.contains(input)).toBe(true);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("button", { name: /save/i })).toBeNull();
  });

  it("puts a menu in an enum-like cell", async () => {
    const { user } = mount();
    await row();

    await open(user, "FEAT-4", "priority");

    const menu = screen.getByRole("combobox", { name: "Prio of FEAT-4" });
    expect((menu as HTMLSelectElement).value).toBe("low");
    expect(
      within(menu).getAllByRole("option").map((option) => option.textContent),
    ).toEqual([
      PRIORITY_LABEL.none,
      PRIORITY_LABEL.low,
      PRIORITY_LABEL.medium,
      PRIORITY_LABEL.high,
      PRIORITY_LABEL.urgent,
    ]);
  });

  it("does not open the key, the title or the timestamp", async () => {
    const { user } = mount();
    const target = await row();

    const editable = [...target.cells]
      .map((td) => td.dataset["edit"])
      .filter((id) => id !== undefined);
    expect(editable).toEqual([
      "priority",
      "type",
      "size",
      "field.layer",
      "field.points",
      "field.team",
    ]);

    // A key is permanent, `updatedAt` is the service's own record, and the
    // title is the link to the task view — not an editor.
    expect(target.cells[0]!.dataset["edit"]).toBeUndefined();
    expect(target.cells[1]!.dataset["edit"]).toBeUndefined();
    expect(target.cells[target.cells.length - 1]!.dataset["edit"]).toBeUndefined();
    await user.click(target.cells[0]!);
    await user.click(target.cells[target.cells.length - 1]!);
    expect(screen.queryByRole("textbox")).toBeNull();

    await open(user, "FEAT-4", "size");
    expect(screen.getByRole("combobox", { name: "Size of FEAT-4" })).toBeTruthy();
  });

  it("opens from a click anywhere in the cell, not on the word alone", async () => {
    const { user } = mount();
    const target = await row();

    // The glyph columns have no text to aim at: the cell is the target.
    const size = cell("FEAT-4", "size");
    expect(target.contains(size)).toBe(true);
    await user.click(size);

    expect(screen.getByRole("combobox", { name: "Size of FEAT-4" })).toBeTruthy();
    // And the editor sits in that cell, not over the table.
    expect(size.contains(screen.getByRole("combobox", { name: "Size of FEAT-4" }))).toBe(true);
  });

  it("edits one cell at a time", async () => {
    const { user } = mount();
    await row();

    await open(user, "FEAT-4", "field.team");
    await open(user, "FEAT-3", "field.team");

    expect(screen.queryByRole("textbox", { name: "Team of FEAT-4" })).toBeNull();
    expect(screen.getByRole("textbox", { name: "Team of FEAT-3" })).toBeTruthy();
  });
});

describe("saving", () => {
  it("saves on Enter and sends a patch of that field alone", async () => {
    const { api, user } = mount();
    await row();

    await open(user, "FEAT-4", "field.team");
    await user.clear(screen.getByRole("textbox", { name: "Team of FEAT-4" }));
    await user.type(screen.getByRole("textbox", { name: "Team of FEAT-4" }), "platform{Enter}");

    await waitFor(() => expect(api.writes).toHaveLength(1));
    expect(api.writes[0]!.path).toBe("/api/projects/paim/tasks/FEAT-4");
    expect(api.writes[0]!.method).toBe("PATCH");
    expect(api.writes[0]!.body).toEqual({ fields: { team: "platform" } });
    // The editor is gone and the value is on the row.
    expect(screen.queryByRole("textbox", { name: "Team of FEAT-4" })).toBeNull();
    expect((await row()).textContent).toContain("platform");
  });

  it("saves on blur — clicking outside is the save (docs/07)", async () => {
    const { api, user } = mount();
    await row();

    await open(user, "FEAT-4", "field.team");
    await user.clear(screen.getByRole("textbox", { name: "Team of FEAT-4" }));
    await user.type(screen.getByRole("textbox", { name: "Team of FEAT-4" }), "saved-by-blur");
    await user.click(screen.getByRole("columnheader", { name: "Key" }));

    await waitFor(() => expect(api.writes).toHaveLength(1));
    expect(api.writes[0]!.body).toEqual({ fields: { team: "saved-by-blur" } });
    expect((await row()).textContent).toContain("saved-by-blur");
  });

  it("saves a menu choice as soon as it is made", async () => {
    const { api, user } = mount();
    await row();

    await open(user, "FEAT-4", "priority");
    await user.selectOptions(screen.getByRole("combobox", { name: "Prio of FEAT-4" }), "urgent");

    await waitFor(() => expect(api.writes).toHaveLength(1));
    expect(api.writes[0]!.body).toEqual({ priority: "urgent" });
    await waitFor(() =>
      expect(within(rowFor("FEAT-4")!).getByRole("img", { name: PRIORITY_LABEL.urgent })).toBeTruthy(),
    );
  });

  it("writes a custom field into `fields`, not the core", async () => {
    const { api, user } = mount();
    await row();

    await open(user, "FEAT-4", "field.layer");
    await user.selectOptions(screen.getByRole("combobox", { name: "Layer of FEAT-4" }), "api");

    await waitFor(() => expect(api.writes).toHaveLength(1));
    expect(api.writes[0]!.body).toEqual({ fields: { layer: "api" } });
    await waitFor(() => expect(rowFor("FEAT-4")!.cells[5]?.textContent).toBe("api"));
  });

  it("changes the type through its fixed column", async () => {
    const { api, user } = mount();
    await row();

    await open(user, "FEAT-4", "type");
    await user.selectOptions(screen.getByRole("combobox", { name: "Type of FEAT-4" }), "bug");

    await waitFor(() => expect(api.writes).toHaveLength(1));
    expect(api.writes[0]!.body).toEqual({ fields: { type: "bug" } });
    await waitFor(() =>
      expect(within(rowFor("FEAT-4")!).getByRole("img", { name: TYPE_LABEL.bug })).toBeTruthy(),
    );
  });

  it("promotes a task to an epic through the size menu", async () => {
    const { api, user } = mount();
    await row();

    await open(user, "FEAT-4", "size");
    await user.selectOptions(screen.getByRole("combobox", { name: "Size of FEAT-4" }), "Epic");

    await waitFor(() => expect(api.writes).toHaveLength(1));
    expect(api.writes[0]!.body).toEqual({ size: "Epic" });
    await waitFor(() =>
      expect(within(rowFor("FEAT-4")!).getByTitle(SIZE_LABEL.Epic).textContent).toBe("Epic"),
    );
    expect(rowFor("FEAT-4")!.dataset["epic"]).toBe("true");
  });

  it("sends If-Match: the row on screen is the version being edited", async () => {
    const { api, user, tasks } = mount();
    await row();

    await open(user, "FEAT-4", "field.team");
    await user.clear(screen.getByRole("textbox", { name: "Team of FEAT-4" }));
    await user.type(screen.getByRole("textbox", { name: "Team of FEAT-4" }), "platform{Enter}");

    await waitFor(() => expect(api.writes).toHaveLength(1));
    expect(api.writes[0]!.ifMatch).toBe("2026-01-01T10:00:00.000Z");
    await waitFor(() => expect(rowFor("FEAT-4")!.textContent).toContain("platform"));

    // Reconciled with the answer: the second edit carries the timestamp the
    // service stamped on the first, so it is not a conflict with itself.
    const stamped = tasks[0]!.updatedAt;
    expect(stamped).not.toBe("2026-01-01T10:00:00.000Z");

    await open(user, "FEAT-4", "field.team");
    await user.clear(screen.getByRole("textbox", { name: "Team of FEAT-4" }));
    await user.type(screen.getByRole("textbox", { name: "Team of FEAT-4" }), "platform-2{Enter}");

    await waitFor(() => expect(api.writes).toHaveLength(2));
    expect(api.writes[1]!.ifMatch).toBe(stamped);
    await waitFor(() => expect(rowFor("FEAT-4")!.textContent).toContain("platform-2"));
    expect(rowFor("FEAT-4")!.dataset["rejected"]).toBeUndefined();
  });

  it("shows the change at once, before the service answers", async () => {
    const { user } = mount();
    await row();

    // A write that never lands: what is on screen is the optimistic copy.
    const answered = vi.fn();
    const original = globalThis.fetch;
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      if ((init?.method ?? "GET") !== "GET") {
        answered();
        await new Promise(() => {});
      }
      return original(input, init);
    });

    await open(user, "FEAT-4", "field.team");
    await user.clear(screen.getByRole("textbox", { name: "Team of FEAT-4" }));
    await user.type(screen.getByRole("textbox", { name: "Team of FEAT-4" }), "optimistic{Enter}");

    await waitFor(() => expect(answered).toHaveBeenCalled());
    expect((await row()).textContent).toContain("optimistic");
  });

  it("does not write when nothing changed", async () => {
    const { api, user } = mount();
    await row();

    await open(user, "FEAT-4", "field.team");
    await user.click(screen.getByRole("columnheader", { name: "Key" }));

    expect(api.writes).toHaveLength(0);
    expect((await row()).textContent).toContain("core");
  });
});

describe("cancelling", () => {
  it("puts the value back on Esc and writes nothing", async () => {
    const { api, user } = mount();
    await row();

    await open(user, "FEAT-4", "field.team");
    await user.clear(screen.getByRole("textbox", { name: "Team of FEAT-4" }));
    await user.type(screen.getByRole("textbox", { name: "Team of FEAT-4" }), "thrown-away{Escape}");

    expect(screen.queryByRole("textbox", { name: "Team of FEAT-4" })).toBeNull();
    expect(api.writes).toHaveLength(0);
    const cell = await row();
    expect(cell.textContent).toContain("core");
    expect(cell.textContent).not.toContain("thrown-away");
  });

  it("cancels a menu on Esc without choosing", async () => {
    const { api, user } = mount();
    await row();

    await open(user, "FEAT-4", "priority");
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("combobox", { name: "Prio of FEAT-4" })).toBeNull();
    expect(api.writes).toHaveLength(0);
    expect(within(rowFor("FEAT-4")!).getByRole("img", { name: PRIORITY_LABEL.low })).toBeTruthy();
  });
});

describe("a refused write", () => {
  it("flashes the row clay and puts the old value back (4xx)", async () => {
    const { api, user } = mount({
      rejectWrites: { status: 422, code: "FIELD_INVALID", message: "points must be a number" },
    });
    await row();

    await open(user, "FEAT-4", "field.team");
    await user.clear(screen.getByRole("textbox", { name: "Team of FEAT-4" }));
    await user.type(screen.getByRole("textbox", { name: "Team of FEAT-4" }), "refused{Enter}");

    // The flash is clay (docs/13 "Motion"), and it is on the row that failed.
    await waitFor(() => expect(rowFor("FEAT-4")!.dataset["rejected"]).toBe("true"));
    expect(rowFor("FEAT-4")!.className).toContain("bg-pr-urgent");
    expect(rowFor("FEAT-3")!.dataset["rejected"]).toBeUndefined();

    // And the row is back to what the service holds.
    expect(rowFor("FEAT-4")!.textContent).toContain("core");
    expect(rowFor("FEAT-4")!.textContent).not.toContain("refused");
    expect(api.writes).toHaveLength(1);

    // Then it returns: a flash, not a state the row stays in.
    await waitFor(() => expect(rowFor("FEAT-4")!.dataset["rejected"]).toBeUndefined(), {
      timeout: 3_000,
    });
    expect(rowFor("FEAT-4")!.className).not.toContain("bg-pr-urgent");
  });

  it("reverts a menu choice too, without a dialog or a toast", async () => {
    const { user } = mount({ rejectWrites: { status: 409, code: "TASK_HAS_CHILDREN" } });
    await row();

    await open(user, "FEAT-4", "priority");
    await user.selectOptions(screen.getByRole("combobox", { name: "Prio of FEAT-4" }), "urgent");

    await waitFor(() => expect(rowFor("FEAT-4")!.dataset["rejected"]).toBe("true"));
    expect(within(rowFor("FEAT-4")!).getByRole("img", { name: PRIORITY_LABEL.low })).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("reverts on an If-Match conflict: another writer moved the task", async () => {
    const { api, user, tasks } = mount();
    await row();

    // Another program writes the same task while the row sits on screen —
    // docs/07: "Other programs write to the same store."
    tasks[0]!.fields = { ...tasks[0]!.fields, team: "written-by-someone-else" };
    tasks[0]!.updatedAt = "2026-01-01T11:00:00.000Z";

    await open(user, "FEAT-4", "field.team");
    await user.clear(screen.getByRole("textbox", { name: "Team of FEAT-4" }));
    await user.type(screen.getByRole("textbox", { name: "Team of FEAT-4" }), "stale-edit{Enter}");

    await waitFor(() => expect(rowFor("FEAT-4")!.dataset["rejected"]).toBe("true"));
    // The write was a compare-and-swap on the version the user saw.
    expect(api.writes[0]!.ifMatch).toBe("2026-01-01T10:00:00.000Z");
    // The other write stands: this one changed nothing.
    expect(tasks[0]!.fields["team"]).toBe("written-by-someone-else");
    expect(rowFor("FEAT-4")!.textContent).not.toContain("stale-edit");
    expect(rowFor("FEAT-4")!.textContent).toContain("core");
  });
});

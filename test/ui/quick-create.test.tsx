/* Interim task creation (specs/TASKS.md T23, src/app/QuickCreate.tsx).
 *
 * Covers T23's Done line: "create-via-keyboard works end to end" — `C` (and
 * the New task button) open a single title input, Enter posts `{ title }`
 * and the new row ends up focused — and that the surface is self-contained
 * enough to test on its own.
 */

import { describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { installApi, makeProject, makeTask, renderApp } from "./harness";

const PAIM = makeProject({ slug: "paim", name: "PAIM" });

function mount(tasks: ReturnType<typeof makeTask>[] = []) {
  const api = installApi({ projects: [PAIM], tasks: { paim: tasks } });
  const view = renderApp("/p/paim");
  return { api, ...view };
}

const rowFor = (key: string) =>
  document.querySelector<HTMLTableRowElement>(`tr[data-task='${key}']`);

describe("opening", () => {
  it("opens the title input when 'New task' is clicked", async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByText("+ New task");

    await user.click(screen.getByText("+ New task"));

    const field = screen.getByLabelText("New task title");
    expect(field).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(field));
  });

  it("opens on 'C' when nothing else is being typed into", async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByText("+ New task");

    await user.keyboard("c");

    expect(screen.getByLabelText("New task title")).toBeTruthy();
  });

  it("leaves 'C' alone while another field has focus", async () => {
    const user = userEvent.setup();
    mount([makeTask({ key: "FEAT-1", title: "Existing", status: "ready" })]);
    await waitFor(() => expect(rowFor("FEAT-1")).toBeTruthy());

    // Open the cell editor on the title column — a genuine text field
    // elsewhere on the same screen.
    await user.click(rowFor("FEAT-1")!.querySelector("[data-edit='title']")!);
    const editor = screen.getByLabelText("Title of FEAT-1");
    await user.type(editor, "c");

    expect(screen.queryByLabelText("New task title")).toBeNull();
  });

  it("closes on Escape without creating anything", async () => {
    const user = userEvent.setup();
    const { api } = mount();
    await screen.findByText("+ New task");
    await user.click(screen.getByText("+ New task"));

    await user.type(screen.getByLabelText("New task title"), "Something");
    await user.keyboard("{Escape}");

    expect(screen.queryByLabelText("New task title")).toBeNull();
    expect(api.creates).toHaveLength(0);
    // Escape returns the button, not a partial draft.
    expect(screen.getByText("+ New task")).toBeTruthy();
  });
});

describe("create-via-keyboard, end to end", () => {
  it("posts {title} on Enter, closes the input, and shows the new row", async () => {
    const user = userEvent.setup();
    const { api } = mount([makeTask({ key: "FEAT-1", title: "Existing", status: "ready" })]);
    await waitFor(() => expect(rowFor("FEAT-1")).toBeTruthy());

    await user.keyboard("c");
    await user.type(screen.getByLabelText("New task title"), "Ship the quick create");
    await user.keyboard("{Enter}");

    await waitFor(() => expect(api.creates).toHaveLength(1));
    expect(api.creates[0]?.body).toEqual({ title: "Ship the quick create" });

    // The input is gone; the button is back.
    expect(screen.queryByLabelText("New task title")).toBeNull();
    expect(screen.getByText("+ New task")).toBeTruthy();

    // The new row is on screen, with the title that was typed.
    await waitFor(() => {
      const rows = [...document.querySelectorAll("tr[data-task]")];
      expect(rows.some((row) => row.textContent?.includes("Ship the quick create"))).toBe(true);
    });
  });

  it("focuses the row it just created", async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByText("+ New task");

    await user.click(screen.getByText("+ New task"));
    await user.type(screen.getByLabelText("New task title"), "Focus me");
    await user.keyboard("{Enter}");

    await waitFor(() => {
      const row = [...document.querySelectorAll<HTMLElement>("tr[data-task]")].find((r) =>
        r.textContent?.includes("Focus me"),
      );
      expect(row).toBeTruthy();
      expect(document.activeElement).toBe(row);
    });
  });

  it("does nothing on Enter with a blank title", async () => {
    const user = userEvent.setup();
    const { api } = mount();
    await screen.findByText("+ New task");

    await user.click(screen.getByText("+ New task"));
    await user.keyboard("{Enter}");

    expect(api.creates).toHaveLength(0);
    // Still open — a blank Enter is not a close.
    expect(screen.getByLabelText("New task title")).toBeTruthy();
  });

  it("reports the failure and keeps the draft when the service refuses", async () => {
    const user = userEvent.setup();
    installApi({
      projects: [PAIM],
      tasks: { paim: [] },
      rejectWrites: { status: 500, code: "INTERNAL", message: "boom" },
    });
    renderApp("/p/paim");
    await screen.findByText("+ New task");

    await user.click(screen.getByText("+ New task"));
    await user.type(screen.getByLabelText("New task title"), "Retry me");
    await user.keyboard("{Enter}");

    await screen.findByRole("alert");
    // The input is still open with the draft intact, so the user can retry.
    expect((screen.getByLabelText("New task title") as HTMLInputElement).value).toBe("Retry me");
  });
});

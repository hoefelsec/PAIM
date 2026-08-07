/* The left rail on the table screen (docs/07 "Filter facets", T20).
 *
 * The mockup this checks against is design/mockups.html "Table": a facet per
 * dimension, the source on each head, live counts beside each value, and a
 * "Clear all" footer with the number of checked values.
 *
 * The three properties the rail must have — a generated facet list, filters
 * that live only in the address, and a working Back control — are the three
 * groups below.
 */

import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { installApi, makeProject, makeTask, renderApp } from "./harness";
import type { FieldDef } from "../../src/shared/fields.js";

const TYPE_FIELD: FieldDef = {
  key: "type",
  type: "select",
  options: ["feature", "bug", "chore"],
  showAsFacet: true,
  order: 1,
};

const PAIM = makeProject({
  slug: "paim",
  name: "PAIM",
  statuses: ["backlog", "open_questions", "design", "ready", "executing", "done"],
  fieldSchema: [
    TYPE_FIELD,
    {
      key: "layer",
      type: "select",
      options: ["api", "ui"],
      label: "Layer",
      showAsFacet: true,
      order: 2,
    },
  ],
});

/** A second workspace, same core facets, no `layer` field. */
const HOMELAB = makeProject({
  slug: "homelab",
  name: "Homelab",
  statuses: PAIM.statuses,
  fieldSchema: [TYPE_FIELD],
});

const TASKS = [
  makeTask({
    id: "a",
    key: "FEAT-1",
    title: "Cursor pagination",
    status: "ready",
    priority: "high",
    size: "M",
    labels: ["backend"],
    fields: { type: "feature", layer: "api" },
  }),
  makeTask({
    id: "b",
    key: "BUG-2",
    title: "Cursor encoding is unstable",
    status: "ready",
    priority: "urgent",
    size: "S",
    labels: ["backend"],
    fields: { type: "bug", layer: "api" },
  }),
  makeTask({
    id: "c",
    key: "CHORE-3",
    title: "Rename the rail slot",
    status: "executing",
    priority: "low",
    size: "L",
    fields: { type: "chore", layer: "ui" },
  }),
];

function install() {
  return installApi({
    projects: [PAIM, HOMELAB],
    tasks: { paim: TASKS, homelab: [] },
  });
}

/** The checkbox of one facet value, by the label the rail prints. */
function box(name: RegExp | string): HTMLInputElement {
  return screen.getByRole("checkbox", { name }) as HTMLInputElement;
}

/** The keys the table is showing, in order. */
function visibleKeys(): string[] {
  return [...document.querySelectorAll("tr[data-task]")].map(
    (row) => row.getAttribute("data-task") ?? "",
  );
}

async function railReady(): Promise<HTMLElement> {
  return await screen.findByRole("checkbox", { name: /Ready/ }).then(
    () => document.querySelector("[data-slot='rail']") as HTMLElement,
  );
}

describe("the facet rail is generated from the project", () => {
  it("shows a Layer facet in the project that has one", async () => {
    install();
    renderApp("/p/paim");
    await railReady();

    expect(screen.getByRole("button", { name: /Layer/ })).toBeTruthy();
    expect(document.querySelector("[data-facet='field.layer']")).toBeTruthy();
  });

  it("leaves it out of a project that does not have one", async () => {
    install();
    renderApp("/p/homelab");

    // Same rail, same core facets — the schema facets are what differ.
    await screen.findByRole("button", { name: /STATUS|Status/ });
    expect(document.querySelector("[data-facet='field.type']")).toBeTruthy();
    expect(document.querySelector("[data-facet='field.layer']")).toBeNull();
  });

  it("names the source of every facet head: pipeline, core, schema", async () => {
    install();
    renderApp("/p/paim");
    await railReady();

    const source = (id: string) =>
      within(document.querySelector(`[data-facet='${id}']`) as HTMLElement)
        .getByRole("button")
        .textContent;

    expect(source("status")).toMatch(/pipeline/);
    expect(source("priority")).toMatch(/core/);
    expect(source("assignee")).toMatch(/core/);
    expect(source("field.layer")).toMatch(/schema/);
  });

  it("prints the live count beside each value", async () => {
    install();
    renderApp("/p/paim");
    await railReady();

    expect(box(/^Ready/).closest("label")?.textContent).toMatch(/Ready2$/);
    expect(box(/^Executing/).closest("label")?.textContent).toMatch(/Executing1$/);
    expect(box(/^Design/)).toBeTruthy();
    expect(box(/^Design/).closest("label")?.textContent).toMatch(/Design0$/);
  });

  it("collapses a facet head and opens it again — view state, not the address", async () => {
    const user = userEvent.setup();
    install();
    renderApp("/p/paim");
    await railReady();

    const head = within(document.querySelector("[data-facet='status']") as HTMLElement).getByRole(
      "button",
    );
    expect(head.getAttribute("aria-expanded")).toBe("true");

    await user.click(head);
    expect(head.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("checkbox", { name: /^Ready/ })).toBeNull();
    expect(window.location.search).toBe("");
  });
});

describe("the rail filters the set through the address", () => {
  it("writes the checked value into the query string and filters the table", async () => {
    const user = userEvent.setup();
    install();
    renderApp("/p/paim");
    await railReady();
    expect(visibleKeys()).toEqual(["FEAT-1", "BUG-2", "CHORE-3"]);

    await user.click(box(/^Ready/));

    await waitFor(() => expect(window.location.search).toBe("?status=ready"));
    await waitFor(() => expect(visibleKeys()).toEqual(["FEAT-1", "BUG-2"]));
    expect(box(/^Ready/).checked).toBe(true);
  });

  it("ANDs two facets and ORs the values inside one", async () => {
    const user = userEvent.setup();
    install();
    renderApp("/p/paim");
    await railReady();

    await user.click(box(/^Ready/));
    await user.click(box(/^Executing/));
    await waitFor(() => expect(window.location.search).toBe("?status=ready%2Cexecuting"));
    await waitFor(() => expect(visibleKeys()).toHaveLength(3));

    await user.click(box(/^ui/));
    await waitFor(() =>
      expect(window.location.search).toBe("?status=ready%2Cexecuting&field.layer=ui"),
    );
    await waitFor(() => expect(visibleKeys()).toEqual(["CHORE-3"]));
  });

  it("unchecks a value and takes it back out of the address", async () => {
    const user = userEvent.setup();
    install();
    renderApp("/p/paim");
    await railReady();

    await user.click(box(/^Ready/));
    await waitFor(() => expect(window.location.search).toBe("?status=ready"));

    await user.click(box(/^Ready/));
    await waitFor(() => expect(window.location.search).toBe(""));
    await waitFor(() => expect(visibleKeys()).toHaveLength(3));
  });

  it("clears every facet from the footer, which counts the checked values", async () => {
    const user = userEvent.setup();
    install();
    renderApp("/p/paim");
    await railReady();

    const clear = screen.getByRole("button", { name: "Clear all" });
    expect(clear).toHaveProperty("disabled", true);

    await user.click(box(/^Ready/));
    await user.click(box(/^Urgent/));
    await waitFor(() => expect(screen.getByTestId("active-filters").textContent).toBe("2"));

    await user.click(screen.getByRole("button", { name: "Clear all" }));
    await waitFor(() => expect(window.location.search).toBe(""));
    await waitFor(() => expect(visibleKeys()).toHaveLength(3));
    expect(screen.queryByTestId("active-filters")).toBeNull();
  });

  it("says so when the filters leave nothing on screen", async () => {
    const user = userEvent.setup();
    install();
    renderApp("/p/paim");
    await railReady();

    await user.click(box(/^Backlog/));
    expect(await screen.findByText("No tasks match these filters.")).toBeTruthy();
  });
});

describe("a filtered list is a link", () => {
  it("reproduces the list from a pasted address, boxes included", async () => {
    install();
    renderApp("/p/paim?status=ready&field.layer=api");

    await waitFor(() => expect(visibleKeys()).toEqual(["FEAT-1", "BUG-2"]));
    expect(box(/^Ready/).checked).toBe(true);
    expect(box(/^api/).checked).toBe(true);
    expect(box(/^Executing/).checked).toBe(false);
    expect(screen.getByTestId("active-filters").textContent).toBe("2");
  });

  it("shows a checked value the project no longer offers, so it can be undone", async () => {
    const user = userEvent.setup();
    install();
    renderApp("/p/paim?field.layer=ghost");

    const stale = await screen.findByRole("checkbox", { name: /^ghost/ });
    expect((stale as HTMLInputElement).checked).toBe(true);
    expect(await screen.findByText("No tasks match these filters.")).toBeTruthy();

    await user.click(stale);
    await waitFor(() => expect(window.location.search).toBe(""));
    await waitFor(() => expect(visibleKeys()).toHaveLength(3));
  });

  it("restores the previous filter state on Back", async () => {
    const user = userEvent.setup();
    install();
    renderApp("/p/paim");
    await railReady();

    await user.click(box(/^Ready/));
    await waitFor(() => expect(window.location.search).toBe("?status=ready"));
    await user.click(box(/^Executing/));
    await waitFor(() => expect(window.location.search).toBe("?status=ready%2Cexecuting"));
    await waitFor(() => expect(visibleKeys()).toHaveLength(3));

    window.history.back();

    await waitFor(() => expect(window.location.search).toBe("?status=ready"));
    await waitFor(() => expect(visibleKeys()).toEqual(["FEAT-1", "BUG-2"]));
    expect(box(/^Ready/).checked).toBe(true);
    expect(box(/^Executing/).checked).toBe(false);

    window.history.back();

    await waitFor(() => expect(window.location.search).toBe(""));
    await waitFor(() => expect(visibleKeys()).toHaveLength(3));
    expect(box(/^Ready/).checked).toBe(false);
  });
});

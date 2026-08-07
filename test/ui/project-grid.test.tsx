/* The project grid at `/` (design/mockups.html "All projects"). */

import { afterEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { installApi, makeProject, renderApp } from "./harness";

const PROJECTS = [
  makeProject({
    slug: "paim",
    name: "PAIM",
    description: "Local-first task service. REST API plus HTML UI on one port.",
    color: "steel",
    icon: "◈",
  }),
  makeProject({ slug: "homelab", name: "Homelab", description: "NAS, backups, mesh." }),
  makeProject({ slug: "old", name: "Old thing", status: "archived" }),
];

const COUNTS = {
  paim: { total: 28, open: 17, done: 11 },
  homelab: { total: 31, open: 9, done: 22 },
  old: { total: 4, open: 0, done: 4 },
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("project grid", () => {
  it("shows one card per active project with name, description and counts", async () => {
    installApi({ projects: PROJECTS, counts: COUNTS });
    renderApp("/");

    const card = await screen.findByRole("link", { name: "PAIM" });
    expect(
      within(card).getByText("Local-first task service. REST API plus HTML UI on one port."),
    ).toBeTruthy();
    await waitFor(() => expect(card.textContent).toContain("17"));
    expect(card.textContent).toContain("11 done");
    expect(card.getAttribute("href")).toBe("/p/paim");
  });

  it("draws the progress meter from done over total", async () => {
    installApi({ projects: PROJECTS, counts: COUNTS });
    renderApp("/");

    const card = await screen.findByRole("link", { name: "PAIM" });
    const meter = within(card).getByRole("progressbar");
    // 11 of 28 done.
    await waitFor(() => expect(meter.getAttribute("aria-valuenow")).toBe("39"));
  });

  it("keeps archived projects out of the grid and counts them in the footer", async () => {
    installApi({ projects: PROJECTS, counts: COUNTS });
    renderApp("/");

    await screen.findByRole("link", { name: "PAIM" });
    expect(screen.queryByRole("link", { name: "Old thing" })).toBeNull();

    const header = screen.getByRole("heading", { name: "Projects" }).parentElement;
    expect(header?.textContent).toContain("2 active projects");
    expect(header?.textContent).toContain("1 archived");
  });

  it("says so when there is no active project", async () => {
    installApi({ projects: [makeProject({ slug: "old", status: "archived" })] });
    renderApp("/");

    expect(await screen.findByText("No active project yet.")).toBeTruthy();
  });

  it("reports a failed read instead of an empty grid", async () => {
    vi.stubGlobal("fetch", async () =>
      new Response(JSON.stringify({ error: { code: "INTERNAL", message: "boom" } }), {
        status: 500,
        headers: { "content-type": "application/json" },
      }),
    );
    renderApp("/");

    expect(await screen.findByText(/could not be read/)).toBeTruthy();
  });
});

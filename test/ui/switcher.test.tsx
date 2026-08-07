/* The workspace switcher (docs/07 "One workspace at a time"). */

import { afterEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { installApi, makeProject, renderApp } from "./harness";

const PROJECTS = [
  makeProject({ slug: "paim", name: "PAIM" }),
  makeProject({ slug: "homelab", name: "Homelab" }),
  makeProject({ slug: "old", name: "Old thing", status: "archived" }),
  makeProject({ slug: "older", name: "Older thing", status: "archived" }),
];

const COUNTS = {
  paim: { total: 28, open: 17, done: 11 },
  homelab: { total: 31, open: 9, done: 22 },
  old: { total: 4, open: 0, done: 4 },
  older: { total: 2, open: 0, done: 2 },
};

async function openMenu() {
  const user = userEvent.setup();
  renderApp("/p/paim");
  await user.click(await screen.findByRole("button", { name: /PAIM/ }));
  return { user, menu: await screen.findByRole("menu", { name: "Workspaces" }) };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("workspace switcher", () => {
  it("shows the workspace name and its open count", async () => {
    installApi({ projects: PROJECTS, counts: COUNTS });
    renderApp("/p/paim");

    const button = await screen.findByRole("button", { name: /PAIM/ });
    await waitFor(() => expect(button.textContent).toContain("17 open"));
  });

  it("lists the active projects with their open counts", async () => {
    installApi({ projects: PROJECTS, counts: COUNTS });
    const { menu } = await openMenu();

    expect(within(menu).getByRole("menuitem", { name: /PAIM/ })).toBeTruthy();
    const other = within(menu).getByRole("menuitem", { name: /Homelab/ });
    await waitFor(() => expect(other.textContent).toContain("9"));

    // Archived projects belong to their own row, not to the list.
    expect(within(menu).queryByRole("menuitem", { name: /Old thing/ })).toBeNull();
  });

  it("has one row for the archived projects and the three exits", async () => {
    installApi({ projects: PROJECTS, counts: COUNTS });
    const { menu } = await openMenu();

    const archived = within(menu).getByRole("menuitem", { name: /Archived/ });
    expect(archived.textContent).toContain("2");

    expect(within(menu).getByRole("menuitem", { name: "Project settings" })).toBeTruthy();
    expect(within(menu).getByRole("menuitem", { name: "New project" })).toBeTruthy();
    expect(within(menu).getByRole("menuitem", { name: "All projects" })).toBeTruthy();
  });

  it("re-scopes the URL when the workspace changes", async () => {
    installApi({ projects: PROJECTS, counts: COUNTS });
    const { user, menu } = await openMenu();

    await user.click(within(menu).getByRole("menuitem", { name: /Homelab/ }));

    expect(window.location.pathname).toBe("/p/homelab");
    expect(await screen.findByRole("button", { name: /Homelab/ })).toBeTruthy();
    expect(screen.queryByRole("menu", { name: "Workspaces" })).toBeNull();
  });

  it("leaves the workspace for the grid through All projects", async () => {
    installApi({ projects: PROJECTS, counts: COUNTS });
    const { user, menu } = await openMenu();

    await user.click(within(menu).getByRole("menuitem", { name: "All projects" }));

    expect(window.location.pathname).toBe("/");
    expect(await screen.findByRole("heading", { name: "Projects" })).toBeTruthy();
  });

  it("closes on Escape", async () => {
    installApi({ projects: PROJECTS, counts: COUNTS });
    const { user } = await openMenu();

    await user.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByRole("menu", { name: "Workspaces" })).toBeNull());
  });
});

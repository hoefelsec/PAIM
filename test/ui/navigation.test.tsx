/* The Done line of T18: grid → project → back, and switching projects
 * re-scopes the URL. */

import { afterEach, describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { installApi, makeProject, renderApp } from "./harness";

const PROJECTS = [
  makeProject({ slug: "paim", name: "PAIM", description: "Local-first task service." }),
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

describe("shell navigation", () => {
  it("walks grid → project → back", async () => {
    installApi({ projects: PROJECTS, counts: COUNTS });
    const user = userEvent.setup();
    renderApp("/");

    expect(await screen.findByRole("heading", { name: "Projects" })).toBeTruthy();

    await user.click(await screen.findByRole("link", { name: "PAIM" }));

    expect(window.location.pathname).toBe("/p/paim");
    expect(await screen.findByRole("button", { name: /PAIM/ })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Projects" })).toBeNull();

    window.history.back();

    await waitFor(() => {
      expect(window.location.pathname).toBe("/");
    });
    expect(await screen.findByRole("heading", { name: "Projects" })).toBeTruthy();
  });

  it("never redirects the root to a workspace", async () => {
    installApi({ projects: PROJECTS, counts: COUNTS });
    renderApp("/");

    expect(await screen.findByRole("heading", { name: "Projects" })).toBeTruthy();
    await waitFor(() => expect(window.location.pathname).toBe("/"));
  });

  it("renders the shell with a rail slot, a main pane and the dock", async () => {
    installApi({ projects: PROJECTS, counts: COUNTS });
    const { container } = renderApp("/p/paim");

    await screen.findByRole("button", { name: /PAIM/ });
    expect(container.querySelector("[data-slot='rail']")).toBeTruthy();
    expect(container.querySelector("[data-slot='main']")).toBeTruthy();
    expect(container.querySelector("[data-slot='dock']")).toBeTruthy();
  });

  it("has no rail on the grid — it uses the full width", async () => {
    installApi({ projects: PROJECTS, counts: COUNTS });
    const { container } = renderApp("/");

    await screen.findByRole("heading", { name: "Projects" });
    expect(container.querySelector("[data-slot='rail']")).toBeNull();
  });

  it("says so when the address names a project that does not exist", async () => {
    installApi({ projects: PROJECTS, counts: COUNTS });
    renderApp("/p/nope");

    expect(await screen.findByText(/No project/)).toBeTruthy();
  });
});

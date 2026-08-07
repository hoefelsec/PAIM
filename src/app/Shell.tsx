/* The workspace shell (docs/07 "Layout").
 *
 *   ┌──────────────┬───────────────────────────────┐
 *   │ switcher     │ main pane                     │
 *   │ rail slot    │                               │
 *   ├──────────────┴───────────────────────────────┤
 *   │ dock — full width, under the sidebar         │
 *   └──────────────────────────────────────────────┘
 *
 * The rail holds different content on different screens, so it is a slot the
 * screen fills: facets on the table, a file tree in docs, a back link on the
 * task view. The dock shows runs in all projects and is a placeholder until
 * runs exist.
 */

import type { ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ApiError } from "./api";
import { LiveIndicator, useLiveEvents, type LiveState } from "./events";
import { useProject } from "./queries";
import { Link } from "./router";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";

/**
 * The dock is on every screen, at one collapsed row, until runs exist. The
 * `live` indicator rides along on the right (specs/06-events.md T22,
 * docs/07 "toolbar") — the toolbar itself belongs to the table screen and
 * ships piece by piece with later tasks, but the connection state is
 * app-wide, so it lives on the one bar every screen already has.
 */
function Dock({ live }: { live: LiveState }) {
  return (
    <div
      data-slot="dock"
      aria-label="Activity"
      className="flex h-[var(--dock-h)] items-center gap-2 border-t border-bd-subtle
                 bg-surface px-3 text-label text-tx-muted"
    >
      <span aria-hidden="true">▴</span>
      <span className="font-mono uppercase">Activity</span>
      <LiveIndicator state={live} />
    </div>
  );
}

function ShellFrame({
  rail,
  children,
  live,
}: {
  rail?: ReactNode;
  children: ReactNode;
  live: LiveState;
}) {
  return (
    <div className="flex h-dvh flex-col bg-base">
      <div className="grid min-h-0 flex-1 grid-cols-[var(--rail-w)_1fr]">
        <aside className="flex min-h-0 flex-col border-r border-bd-subtle bg-base">
          {rail}
        </aside>
        <main data-slot="main" className="min-h-0 overflow-auto bg-surface">
          {children}
        </main>
      </div>
      <Dock live={live} />
    </div>
  );
}

/** A screen-sized message: a missing project, or a request that failed. */
function ShellMessage({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-10 text-center">
      <p className="text-task text-tx-primary">{title}</p>
      {detail && <p className="text-prop text-tx-secondary">{detail}</p>}
      <Link to="/" className="text-prop text-accent hover:text-accent-hover">
        All projects
      </Link>
    </div>
  );
}

/**
 * `/p/:project`. The workspace scopes everything below it, so the shell reads
 * the project first and renders nothing else until it has one.
 *
 * `rail` is what this screen puts in the rail slot — facets on the table, a
 * file tree in docs, a back link on the task view. The shell does not choose:
 * the screen does (docs/07 "The left rail").
 */
export function Shell({
  slug,
  rail,
  children,
}: {
  slug: string;
  rail?: ReactNode;
  children?: ReactNode;
}) {
  const project = useProject(slug);
  // One subscription for the whole workspace — every screen this shell
  // wraps shares it (specs/06-events.md T22).
  const client = useQueryClient();
  const live = useLiveEvents(client);

  if (project.isPending) {
    return (
      <ShellFrame live={live}>
        <p className="p-6 text-prop text-tx-muted">Loading…</p>
      </ShellFrame>
    );
  }

  if (project.isError) {
    const error = project.error;
    const missing = error instanceof ApiError && error.code === "PROJECT_NOT_FOUND";
    return (
      <ShellFrame live={live}>
        <ShellMessage
          title={missing ? `No project “${slug}”` : "The project could not be read"}
          detail={missing ? undefined : (error as Error).message}
        />
      </ShellFrame>
    );
  }

  return (
    <ShellFrame
      live={live}
      rail={
        <>
          <WorkspaceSwitcher project={project.data} />
          <div data-slot="rail" className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {rail}
          </div>
        </>
      }
    >
      {children}
    </ShellFrame>
  );
}

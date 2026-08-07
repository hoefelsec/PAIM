/* The route table (docs/07 "Routes").
 *
 * `/` is the project grid and never redirects to the last workspace, so one
 * URL always answers "which projects exist?". `/p/:project` is the workspace
 * shell. The remaining routes of docs/07 — the task view, the composer, docs,
 * settings, search — arrive with the screens that own them; until then an
 * address inside a workspace still renders that workspace's shell, so the
 * switcher stays reachable.
 */

import { useMemo } from "react";

import { FacetRail } from "./FacetRail";
import { parseFilters } from "./facets";
import { ProjectGrid } from "./ProjectGrid";
import { QuickCreate } from "./QuickCreate";
import { Shell } from "./Shell";
import { TaskTable } from "./TaskTable";
import { Link, matchPath, useLocation } from "./router";

function NotFound({ pathname }: { pathname: string }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-base p-10">
      <p className="text-task text-tx-primary">No screen at {pathname}</p>
      <Link to="/" className="text-prop text-accent hover:text-accent-hover">
        All projects
      </Link>
    </div>
  );
}

export default function App() {
  const { pathname, search } = useLocation();
  // Memoised: a fresh object on every render would rebuild the table model
  // for a thousand rows each time the shell re-rendered.
  const filters = useMemo(() => parseFilters(search), [search]);

  if (matchPath("/", pathname)) return <ProjectGrid />;

  const workspace = matchPath("/p/:project", pathname);
  if (workspace?.["project"]) {
    const slug = workspace["project"];
    // The table is the only view (docs/07): the workspace address is it, and
    // the rail beside it holds the facets that filter it. The filter state is
    // the query string and nothing else, so the route reads it here and the
    // two screens are given the same answer.
    return (
      <Shell slug={slug} rail={<FacetRail slug={slug} />}>
        {/* Interim task creation (T23) — a stopgap for T41's composer;
            see src/app/QuickCreate.tsx for why this is the whole surface. */}
        <QuickCreate slug={slug} />
        <TaskTable slug={slug} filters={filters} />
      </Shell>
    );
  }

  // Deeper workspace addresses (/p/:project/t/:key, /docs, /settings, …) keep
  // the shell and leave the main pane to the screen that will own them.
  const inside = pathname.match(/^\/p\/([^/]+)\//);
  if (inside?.[1]) {
    return (
      <Shell slug={decodeURIComponent(inside[1])}>
        <p className="p-6 text-prop text-tx-muted">No screen at {pathname}</p>
      </Shell>
    );
  }

  return <NotFound pathname={pathname} />;
}

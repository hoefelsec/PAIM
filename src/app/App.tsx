/* The route table (docs/07 "Routes").
 *
 * `/` is the project grid and never redirects to the last workspace, so one
 * URL always answers "which projects exist?". `/p/:project` is the workspace
 * shell. The remaining routes of docs/07 — the task view, the composer, docs,
 * settings, search — arrive with the screens that own them; until then an
 * address inside a workspace still renders that workspace's shell, so the
 * switcher stays reachable.
 */

import { ProjectGrid } from "./ProjectGrid";
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
  const { pathname } = useLocation();

  if (matchPath("/", pathname)) return <ProjectGrid />;

  const workspace = matchPath("/p/:project", pathname);
  if (workspace?.["project"]) {
    const slug = workspace["project"];
    // The table is the only view (docs/07): the workspace address is it.
    return (
      <Shell slug={slug}>
        <TaskTable slug={slug} />
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

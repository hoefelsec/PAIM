/* The project grid at `/` (docs/07 "Routes").
 *
 * The root path answers "which projects exist?". It never redirects to the
 * last workspace, and it has no rail: the grid uses the full width.
 */

import { ProjectTile } from "../ui/controls";
import { toneVar } from "../ui/vocabulary";
import { progressPercent, projectGlyph, projectTone, relativeTime } from "./format";
import { useProjects, useProjectStats } from "./queries";
import { Link } from "./router";
import type { ProjectView } from "../shared/types.js";

function ProgressMeter({ percent, tone }: { percent: number; tone: string }) {
  return (
    <div
      className="h-[3px] overflow-hidden rounded-full bg-bd-subtle"
      role="progressbar"
      aria-label="Done"
      aria-valuenow={percent}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className="h-full rounded-full" style={{ width: `${percent}%`, background: tone }} />
    </div>
  );
}

function ProjectCard({ project }: { project: ProjectView }) {
  const stats = useProjectStats(project.slug);
  const tone = projectTone(project);
  const counts = stats.data ?? { total: 0, open: 0, done: 0 };
  const percent = progressPercent(counts.done, counts.total);

  return (
    <Link
      to={`/p/${project.slug}`}
      aria-label={project.name}
      className="flex flex-col gap-3 rounded-card border border-bd-subtle bg-raised p-3.5
                 text-tx-secondary transition-colors ease-(--ease) duration-(--dur-fast)
                 hover:border-bd-strong hover:bg-overlay"
    >
      <span className="flex items-center gap-2.5">
        <ProjectTile tone={tone} glyph={projectGlyph(project)} size={26} />
        <span className="truncate text-ws text-tx-primary">{project.name}</span>
      </span>

      <p className="text-prop leading-relaxed text-tx-muted">{project.description}</p>

      {/* The tile and this bar are the only two places a project colour
          appears (docs/13 "Project identity"). */}
      <ProgressMeter percent={percent} tone={toneVar(tone)} />

      <span className="flex items-center gap-1.5 text-prop text-tx-muted" data-numeric>
        <span className="font-medium text-tx-secondary">{counts.open}</span>
        <span>open</span>
        <span aria-hidden="true">·</span>
        <span>{counts.done} done</span>
        <span className="ml-auto">{relativeTime(project.updatedAt)}</span>
      </span>
    </Link>
  );
}

export function ProjectGrid() {
  const projects = useProjects("all");

  if (projects.isPending) {
    return <p className="p-8 text-prop text-tx-muted">Loading…</p>;
  }
  if (projects.isError) {
    return (
      <p className="p-8 text-prop text-pr-urgent">
        The projects could not be read: {(projects.error as Error).message}
      </p>
    );
  }

  const active = projects.data.filter((p) => p.status === "active");
  const archived = projects.data.filter((p) => p.status === "archived");

  return (
    <div className="flex min-h-dvh flex-col gap-6 bg-base p-7">
      <header className="flex flex-wrap items-end gap-3.5">
        <h1 className="text-page text-tx-primary">Projects</h1>
        <p className="text-prop text-tx-muted" data-numeric>
          {active.length} active {active.length === 1 ? "project" : "projects"} ·{" "}
          {archived.length} archived
        </p>
      </header>

      {active.length === 0 ? (
        <p className="text-prop text-tx-muted">No active project yet.</p>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-3">
          {active.map((project) => (
            <ProjectCard key={project.id} project={project} />
          ))}
        </div>
      )}

      <div className="mt-auto flex items-center gap-2.5 border-t border-bd-subtle pt-4
                      text-prop text-tx-muted">
        <span aria-hidden="true">›</span>
        <span>Archived</span>
        <span className="text-bd-strong" data-numeric>
          {archived.length}
        </span>
        <span className="ml-auto text-label">Still readable over the API</span>
      </div>
    </div>
  );
}

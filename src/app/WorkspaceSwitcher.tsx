/* The workspace switcher (docs/07 "One workspace at a time").
 *
 * The switcher is the only way to change workspace, so every workspace-level
 * exit hangs off it: Project settings, New project, All projects. The menu is
 * hand-built rather than a Radix menu — it is one list with one open state,
 * and the shell has no other overlay yet.
 */

import { useEffect, useRef, useState } from "react";
import { ProjectTile } from "../ui/controls";
import { projectGlyph, projectTone } from "./format";
import { Link, useNavigate } from "./router";
import { useProjects, useProjectStats } from "./queries";
import type { ProjectView } from "../shared/types.js";

/** The open count of one project, read on its own so a slow count never
 *  delays the name beside it. */
function OpenCount({ slug }: { slug: string }) {
  const stats = useProjectStats(slug);
  if (stats.data === undefined) return null;
  return (
    <span className="text-prop text-tx-muted" data-numeric data-testid={`open-count-${slug}`}>
      {stats.data.open}
    </span>
  );
}

function Chevron({ size = 11 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 6.5L8 10.5L12 6.5" />
    </svg>
  );
}

export function WorkspaceSwitcher({ project }: { project: ProjectView }) {
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const projects = useProjects("all");

  const all = projects.data ?? [];
  const active = all.filter((p) => p.status === "active");
  const archived = all.filter((p) => p.status === "archived");

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const onPointer = (event: MouseEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPointer);
    };
  }, [open]);

  const stats = useProjectStats(project.slug);

  return (
    <div className="relative" ref={wrapper}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
        className="flex w-full items-center gap-2.5 border-b border-bd-subtle px-3 py-2.5
                   text-left transition-colors ease-(--ease) duration-(--dur-fast)
                   hover:bg-surface"
      >
        <ProjectTile tone={projectTone(project)} glyph={projectGlyph(project)} size={26} />
        <span className="flex min-w-0 flex-col leading-tight">
          <span className="truncate text-ws text-tx-primary">{project.name}</span>
          <span className="text-prop text-tx-muted" data-numeric>
            {stats.data ? `${stats.data.open} open` : " "}
          </span>
        </span>
        <span className="ml-auto text-tx-muted">
          <Chevron />
        </span>
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Workspaces"
          className="absolute left-2 top-2 z-10 flex w-[266px] flex-col gap-px rounded-card
                     border border-bd-strong bg-overlay p-1.5 shadow-menu"
        >
          <p className="px-2 pt-2 pb-1 font-mono text-label uppercase text-tx-muted">
            Workspaces
          </p>

          {active.map((p) => {
            const current = p.slug === project.slug;
            return (
              <Link
                key={p.id}
                to={`/p/${p.slug}`}
                role="menuitem"
                aria-current={current ? "page" : undefined}
                onClick={() => setOpen(false)}
                className={`flex items-center gap-2.5 rounded-ctl px-2 py-1.5 text-prop
                            hover:bg-raised hover:text-tx-primary ${
                              current ? "bg-raised text-tx-primary" : "text-tx-secondary"
                            }`}
              >
                <ProjectTile tone={projectTone(p)} glyph={projectGlyph(p)} size={17} />
                <span className="truncate">{p.name}</span>
                <span className="ml-auto">
                  {current ? (
                    <span aria-label="Current workspace" className="text-tx-muted">
                      ✓
                    </span>
                  ) : (
                    <OpenCount slug={p.slug} />
                  )}
                </span>
              </Link>
            );
          })}

          {/* One row for the archived projects (docs/07). The archived list is
              a screen of its own and does not exist yet, so the row states the
              count without pretending to lead anywhere. */}
          <div
            role="menuitem"
            aria-disabled="true"
            className="flex items-center gap-2.5 rounded-ctl px-2 py-1.5 text-prop text-tx-muted"
          >
            <span aria-hidden="true">›</span>
            <span>Archived</span>
            <span className="ml-auto text-label" data-numeric>
              {archived.length}
            </span>
          </div>

          <hr className="my-1" />

          <Link
            to={`/p/${project.slug}/settings`}
            role="menuitem"
            onClick={() => setOpen(false)}
            className="rounded-ctl px-2 py-1.5 text-prop text-tx-secondary hover:bg-raised
                       hover:text-tx-primary"
          >
            Project settings
          </Link>
          {/* Project creation is a screen of its own; the exit lives here from
              the start so the menu keeps the shape docs/07 gives it. */}
          <div
            role="menuitem"
            aria-disabled="true"
            className="rounded-ctl px-2 py-1.5 text-prop text-tx-muted"
          >
            New project
          </div>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              navigate("/");
            }}
            className="rounded-ctl px-2 py-1.5 text-left text-prop text-tx-secondary
                       hover:bg-raised hover:text-tx-primary"
          >
            All projects
          </button>
        </div>
      )}
    </div>
  );
}

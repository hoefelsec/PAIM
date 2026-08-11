/* The task view at `/p/:project/t/:key` (docs/07 "The task view").
 *
 *   All tasks › FEAT-3
 *   Per-project field schema validation          ◐ Executing
 *   ── Overview ────────────────────────────────────────────
 *   the description, as markdown          │ STATUS   ◐ Executing
 *   the original prompt, when there is one│ PRIORITY ▮▮▮ High
 *                                         │ …
 *
 * "The task view is a full screen with tabs. It is not a panel." The tab row
 * is the pipeline in order, so it doubles as a progress indicator — but a tab
 * only exists once the stage behind it does, and Overview is the only one
 * that needs nothing: Questions, Design, Run, Tests and Review arrive with
 * the work that fills them (specs/15-ui-task-view-and-composer.md).
 *
 * The right column holds the properties, and every one of them edits in place
 * exactly the way a table cell does (docs/07 "Editing", T21): the same
 * {@link EditorSpec} list, the same editor component, the same optimistic
 * write with a clay flash on a refusal. There is no form and no Save control
 * here either.
 *
 * The rail is a link back to the task list (docs/07 "The left rail").
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Chip, SizePill, StatusPill, Tabs } from "../ui/controls";
import { PriorityIcon, SizeIcon, TypeIcon } from "../ui/shapes";
import { PRIORITY_LABEL, SIZE_LABEL, TYPE_LABEL } from "../ui/vocabulary";
import { ApiError } from "./api";
import { FLASH_MS, isNoop, propertyEditors, TITLE, type EditorSpec, type TaskPatch } from "./edit";
import { Markdown } from "./markdown";
import { useProject, useSaveTask, useStartRun, useTask } from "./queries";
import { Link, navigate } from "./router";
import { RunTab } from "./RunTab";
import { taskType, type TaskView as TaskRecord } from "./table";
import { ValueEditor } from "./ValueEditor";

/** An empty property is a dash, not a blank: the row still says it is there. */
function Empty() {
  return <span className="text-tx-muted">—</span>;
}

/**
 * A property value as the column prints it. Glyph first, then the word — the
 * table shows the glyph alone because a column of words does not scan, but
 * a property has its name beside it and room for both (docs/13 "Icons").
 */
function PropertyValue({ spec, task }: { spec: EditorSpec; task: TaskRecord }) {
  switch (spec.columnId) {
    case "status":
      return <StatusPill status={task.status} />;
    case "priority":
      return (
        <>
          <span aria-hidden="true" className="inline-flex">
            <PriorityIcon priority={task.priority} size={11} />
          </span>
          {PRIORITY_LABEL[task.priority]}
        </>
      );
    case "size":
      return task.size === "Epic" ? (
        <SizePill size="Epic" />
      ) : (
        <>
          <span aria-hidden="true" className="inline-flex">
            <SizeIcon size={task.size} height={11} />
          </span>
          {SIZE_LABEL[task.size]}
        </>
      );
    case "type": {
      const type = taskType(task);
      const value = spec.read(task);
      if (value === "") return <Empty />;
      return (
        <>
          {type !== null && (
            <span aria-hidden="true" className="inline-flex">
              <TypeIcon type={type} size={13} />
            </span>
          )}
          {type === null ? value : TYPE_LABEL[type]}
        </>
      );
    }
    case "labels":
      return task.labels.length === 0 ? (
        <Empty />
      ) : (
        <>
          {task.labels.map((label) => (
            <Chip key={label}>{label}</Chip>
          ))}
        </>
      );
    case "assignee":
      return task.assignee === null || task.assignee === "" ? <Empty /> : <>{task.assignee}</>;
    default: {
      // A custom field, printed the way its cell prints it (./edit.ts reads
      // the value; ./table.ts formats a list as `a, b`). A value out of a
      // menu is a chip, so a `select` reads as one of a set; a checkbox reads
      // as a word, because a bare ✓ in a column of names says nothing.
      const value = spec.read(task);
      if (value === "") return <Empty />;
      if (value === "true" || value === "false") return <>{value === "true" ? "Yes" : "No"}</>;
      if (spec.kind === "select") return <Chip>{value}</Chip>;
      return <>{value}</>;
    }
  }
}

/**
 * One row of the properties column: the name, and the value that opens an
 * editor when it is clicked. The click target is the value, as in the table —
 * the name is not a control.
 */
function Property({
  spec,
  task,
  editing,
  rejected,
  onOpen,
  onCommit,
  onCancel,
}: {
  spec: EditorSpec;
  task: TaskRecord;
  editing: boolean;
  rejected: boolean;
  onOpen: (columnId: string) => void;
  onCommit: (task: TaskRecord, spec: EditorSpec, raw: string) => void;
  onCancel: () => void;
}) {
  return (
    <div
      data-property={spec.columnId}
      data-rejected={rejected ? "true" : undefined}
      style={rejected ? { transitionDuration: "var(--dur-slow)" } : undefined}
      className={`flex flex-col gap-[5px] rounded-ctl px-1 py-0.5 transition-colors
                  duration-(--dur-hover-out) ${rejected ? "bg-pr-urgent/25" : ""}`}
    >
      <span className="font-mono text-label font-medium uppercase tracking-[0.1em] text-tx-muted">
        {spec.label}
      </span>
      <div
        data-edit={spec.columnId}
        onClick={editing ? undefined : () => onOpen(spec.columnId)}
        className="flex min-h-[21px] flex-wrap items-center gap-[7px] rounded-[4px]
                   text-prop text-tx-primary cursor-text transition-colors
                   duration-(--dur-hover-out) hover:bg-raised
                   hover:duration-(--dur-hover-in)"
      >
        {editing ? (
          <ValueEditor spec={spec} task={task} onCommit={onCommit} onCancel={onCancel} />
        ) : (
          <PropertyValue spec={spec} task={task} />
        )}
      </div>
    </div>
  );
}

/* ── the overview tab ───────────────────────────────────────────────────── */

/** A quiet section head inside the tab body — "Original prompt", and later
 *  the headings the other tabs bring with them. */
function SectionLabel({ children, note }: { children: ReactNode; note?: string }) {
  return (
    <div className="flex items-baseline gap-2 pt-1">
      <span className="font-mono text-label uppercase tracking-[0.1em] text-tx-muted">
        {children}
      </span>
      {note && <span className="text-prop text-tx-muted">{note}</span>}
    </div>
  );
}

/**
 * Overview: the description, and the prompt the task was written from.
 *
 * docs/05 keeps `sourcePrompt` "so re-evaluation has something to re-read",
 * which is why it is shown as it was typed and never edited here. The stale
 * banner and its **Re-evaluate** control belong to the re-evaluation work
 * (specs/15) and are not part of this screen yet.
 */
function Overview({ task }: { task: TaskRecord }) {
  const description = task.description.trim();
  const prompt = task.sourcePrompt.trim();

  return (
    <section data-tab="overview" className="flex min-w-0 flex-col gap-3.5 p-5">
      {description === "" ? (
        <p className="text-row text-tx-muted">No description yet.</p>
      ) : (
        <Markdown text={task.description} />
      )}

      {prompt !== "" && (
        <>
          <SectionLabel note="— kept so re-evaluation has something to re-read">
            Original prompt
          </SectionLabel>
          <p
            data-slot="source-prompt"
            className="text-row leading-[1.65] text-tx-secondary italic"
          >
            {prompt}
          </p>
        </>
      )}
    </section>
  );
}

/* ── the keyboard ───────────────────────────────────────────────────────── */

/**
 * docs/07 "Keyboard": `R` runs the task. The complete keyboard map belongs to
 * one registry module (T47, not built yet), so this is the one binding the
 * task view owns; when the registry arrives, `R` moves into it and this hook
 * goes away.
 *
 * A key that types a letter must not also fire a command, so an event from a
 * field the user is writing in is left alone.
 */
function useRunShortcut(enabled: boolean, run: () => void): void {
  const latest = useRef(run);
  useEffect(() => {
    latest.current = run;
  });

  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "r" && event.key !== "R") return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (target?.isContentEditable) return;
      event.preventDefault();
      latest.current();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled]);
}

/* ── the screen ─────────────────────────────────────────────────────────── */

/** The rail on this screen: one link back to the list (docs/07). */
export function TaskViewRail({ slug }: { slug: string }) {
  return (
    <nav aria-label="Back" className="px-2 py-3">
      <Link
        to={`/p/${encodeURIComponent(slug)}`}
        className="flex items-center gap-2 rounded-ctl px-2 py-1 text-prop text-tx-secondary
                   transition-colors duration-(--dur-hover-out) hover:bg-surface
                   hover:text-tx-primary hover:duration-(--dur-hover-in)"
      >
        <span aria-hidden="true">‹</span>
        All tasks
      </Link>
    </nav>
  );
}

function Message({ title, detail, slug }: { title: string; detail?: string; slug: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-10 text-center">
      <p className="text-task text-tx-primary">{title}</p>
      {detail && <p className="text-prop text-tx-secondary">{detail}</p>}
      <Link
        to={`/p/${encodeURIComponent(slug)}`}
        className="text-prop text-accent hover:text-accent-hover"
      >
        All tasks
      </Link>
    </div>
  );
}

/** The tabs this screen can show today. The rest arrive with their stages. */
export type TaskViewTab = "overview" | "run";

export function TaskView({
  slug,
  taskKey,
  tab = "overview",
}: {
  slug: string;
  taskKey: string;
  tab?: TaskViewTab;
}) {
  const project = useProject(slug);
  const query = useTask(slug, taskKey);
  const task = query.data;

  const base = `/p/${encodeURIComponent(slug)}/t/${encodeURIComponent(taskKey)}`;
  // docs/07: "A tab appears only when the project's pipeline includes that
  // stage." Every project must enable `executing` (docs/04), so in practice
  // the Run tab is always there — the rule is checked all the same, because
  // the tab row is the pipeline and nothing else decides it.
  const hasRun = (project.data?.statuses ?? []).includes("executing");

  const start = useStartRun(slug, taskKey);
  // Not while one is already on its way: a second press must not queue a
  // second run of the same task.
  useRunShortcut(task !== undefined && !start.isPending, () => {
    start.mutate(undefined, { onSuccess: () => navigate(`${base}/run`) });
  });

  const [editing, setEditing] = useState<string | null>(null);
  /** The properties whose last write was refused — clay for one beat (docs/13). */
  const [rejected, setRejected] = useState<ReadonlySet<string>>(() => new Set());

  const properties = useMemo(
    () => propertyEditors(project.data?.statuses ?? [], project.data?.fieldSchema ?? []),
    [project.data?.statuses, project.data?.fieldSchema],
  );

  // The mutation object is new on every render; the callback below is not.
  const mutation = useSaveTask(slug);
  const latest = useRef(mutation);
  useEffect(() => {
    latest.current = mutation;
  });
  const save = useCallback(
    (record: TaskRecord, patch: TaskPatch) => latest.current.mutateAsync({ task: record, patch }),
    [],
  );

  const flash = useCallback((columnId: string) => {
    setRejected((current) => new Set(current).add(columnId));
    window.setTimeout(() => {
      setRejected((current) => {
        const next = new Set(current);
        next.delete(columnId);
        return next;
      });
    }, FLASH_MS);
  }, []);

  const commit = useCallback(
    (record: TaskRecord, spec: EditorSpec, raw: string) => {
      setEditing(null);
      if (isNoop(spec, record, raw)) return;
      void save(record, spec.patch(raw)).catch(() => flash(spec.columnId));
    },
    [save, flash],
  );

  if (query.isPending) {
    return <p className="p-6 text-prop text-tx-muted">Loading task…</p>;
  }

  if (query.isError || task === undefined) {
    const error = query.error;
    const missing = error instanceof ApiError && error.code === "TASK_NOT_FOUND";
    return (
      <Message
        slug={slug}
        title={missing ? `No task “${taskKey}” in this project` : "The task could not be read"}
        detail={missing ? undefined : (error as Error | null)?.message}
      />
    );
  }

  return (
    <article data-slot="task-view" className="flex min-h-0 flex-col">
      <header className="flex flex-col gap-[11px] px-5 pt-4">
        <nav aria-label="Breadcrumb" className="flex items-center gap-2.5 text-prop text-tx-muted">
          <Link
            to={`/p/${encodeURIComponent(slug)}`}
            className="transition-colors duration-(--dur-hover-out) hover:text-tx-secondary
                       hover:duration-(--dur-hover-in)"
          >
            All tasks
          </Link>
          <span aria-hidden="true">›</span>
          {/* docs/13: monospace marks an identifier — a key goes in a URL. */}
          <span className="font-mono text-id">{task.key}</span>
        </nav>

        <div className="flex items-start gap-3">
          {/* The heading is the rename (the table's title is a link here, not
              an editor): click it, type, blur or Enter saves, Esc cancels —
              the same in-place contract as every property (docs/07). */}
          <h1
            data-edit={editing === "title" ? undefined : "title"}
            data-rejected={rejected.has("title") ? "true" : undefined}
            onClick={editing === "title" ? undefined : () => setEditing("title")}
            style={rejected.has("title") ? { transitionDuration: "var(--dur-slow)" } : undefined}
            className={`min-w-0 flex-1 cursor-text rounded-[4px] text-task
                        transition-colors duration-(--dur-hover-out)
                        hover:bg-overlay hover:duration-(--dur-hover-in) ${
                          rejected.has("title") ? "bg-pr-urgent/25" : ""
                        } text-tx-primary`}
          >
            {editing === "title" ? (
              <ValueEditor
                spec={TITLE}
                task={task}
                onCommit={commit}
                onCancel={() => setEditing(null)}
                className="w-full min-w-0 rounded-[4px] border border-bd-strong bg-raised
                           px-1.5 text-task text-tx-primary outline-none focus:border-accent"
              />
            ) : (
              task.title
            )}
          </h1>
          <StatusPill status={task.status} />
        </div>

        {/* `R` asked for a run and the service refused: the reason belongs
            beside the task, not in a toast the interface does not have. */}
        {start.isError && (
          <p data-slot="run-start-error" role="alert" className="text-prop text-pr-urgent">
            {(start.error as Error).message}
          </p>
        )}
      </header>

      {/* The row is the pipeline in order (docs/07), so the remaining tabs
          appear as the stages behind them are built (specs/15). */}
      <Tabs
        tabs={[
          { id: "overview", label: "Overview" },
          ...(hasRun ? [{ id: "run", label: "Run" }] : []),
        ]}
        active={tab}
        onSelect={(id) => navigate(id === "run" ? `${base}/run` : base)}
      />

      <div className="grid min-h-0 flex-1 grid-cols-[1fr_244px]">
        {tab === "run" && hasRun ? (
          project.data === undefined ? (
            <section data-tab="run" className="p-5">
              <p className="text-row text-tx-muted">Loading the workspace…</p>
            </section>
          ) : (
            <RunTab slug={slug} project={project.data} task={task} />
          )
        ) : (
          <Overview task={task} />
        )}

        <aside
          aria-label="Properties"
          className="flex flex-col gap-3 border-l border-bd-subtle px-4 py-3.5"
        >
          {properties.map((spec) => (
            <Property
              key={spec.columnId}
              spec={spec}
              task={task}
              editing={editing === spec.columnId}
              rejected={rejected.has(spec.columnId)}
              onOpen={setEditing}
              onCommit={commit}
              onCancel={() => setEditing(null)}
            />
          ))}
        </aside>
      </div>
    </article>
  );
}

/* The task table at `/p/:project` (docs/07 "The table").
 *
 * One density, 33 pixel rows, `Key · Title · Prio · Type · Size · Updated`
 * plus the project's `showInTable` fields. Rows group by status. An epic
 * carries a disclosure triangle and its `n/m done` count, and its children
 * appear indented under it — expansion is view state, not navigation, so the
 * address bar never moves and the scroll position never jumps.
 *
 * Icons, not words: `priority`, `type` and `size` are glyphs from
 * src/ui/shapes.tsx, and the name appears only under the pointer. The column
 * head names the dimension, so the row does not repeat it.
 *
 * There is no virtualiser. The dependency list of docs/14 does not name one,
 * and it does not need to: every row is memoised on its task, so a project
 * of a thousand tasks pays for its rows once and an expand or a collapse
 * re-renders the handful of rows that changed.
 */

import { Fragment, memo, useCallback, useMemo, useState } from "react";
import { SizePill } from "../ui/controls";
import { PriorityIcon, SizeIcon, StatusRing, TypeIcon } from "../ui/shapes";
import { SIZE_LABEL, STATUS_LABEL, TASK_TYPES, type TaskType } from "../ui/vocabulary";
import { activeFilterCount, filterTasks, type Filters } from "./facets";
import { relativeTime } from "./format";
import { useProject, useTasks } from "./queries";
import {
  buildTable,
  epicProgress,
  epicProgressText,
  formatFieldValue,
  tableColumns,
  type Column,
  type TableModel,
  type TaskView,
} from "./table";
import type { Status } from "../shared/statuses.js";

/** The `type` value of a task, when it is one the pool draws (docs/03). */
function taskType(task: TaskView): TaskType | null {
  const value = task.fields["type"];
  return typeof value === "string" && (TASK_TYPES as readonly string[]).includes(value)
    ? (value as TaskType)
    : null;
}

/* ── cells ──────────────────────────────────────────────────────────────── */

/** The bracket that ties a child row to the epic above it. */
function ChildGuide() {
  return (
    <span
      aria-hidden="true"
      className="mr-[7px] ml-[9px] inline-block h-2 w-[15px] rounded-bl-[3px]
                 border-b border-l border-bd-strong align-[3px]"
    />
  );
}

function Disclosure({
  open,
  label,
  onClick,
}: {
  open: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-label={label}
      onClick={onClick}
      className="mr-0.5 inline-block w-[11px] text-[9px] leading-none text-tx-muted
                 transition-colors duration-(--dur-hover-out)
                 hover:text-tx-primary hover:duration-(--dur-hover-in)"
    >
      {open ? "▾" : "›"}
    </button>
  );
}

/** Size is a glyph, except `Epic`: a container is not a point on the scale. */
function SizeCell({ size }: { size: TaskView["size"] }) {
  if (size === "Epic") {
    return (
      <span title={SIZE_LABEL.Epic} className="inline-flex">
        <SizePill size="Epic" />
      </span>
    );
  }
  return <SizeIcon size={size} height={11} className="inline-block align-middle" />;
}

function cellContent(column: Column, task: TaskView, progress: string | null) {
  switch (column.id) {
    case "key":
      return task.key;
    case "title":
      return (
        <>
          <span className="align-middle">{task.title}</span>
          {progress !== null && (
            <span className="ml-[9px] align-middle text-id text-tx-muted" data-numeric>
              {progress}
            </span>
          )}
        </>
      );
    case "priority":
      return (
        <PriorityIcon
          priority={task.priority}
          size={11}
          className="inline-block align-middle"
        />
      );
    case "type": {
      const type = taskType(task);
      return type === null ? null : (
        <TypeIcon type={type} size={13} className="inline-block align-middle" />
      );
    }
    case "size":
      return <SizeCell size={task.size} />;
    case "updated":
      return relativeTime(task.updatedAt);
    default:
      return column.field ? formatFieldValue(column.field, task.fields[column.field.key]) : null;
  }
}

const ALIGN = { left: "text-left", center: "text-center", right: "text-right" } as const;

/* ── rows ───────────────────────────────────────────────────────────────── */

interface RowProps {
  task: TaskView;
  columns: readonly Column[];
  /** A child of an open epic: indented, and quieter than its parent. */
  child: boolean;
  /** Epic rows only: whether the children are showing. */
  open?: boolean;
  progress: string | null;
  onToggle: (id: string) => void;
}

const TaskRow = memo(function TaskRow({
  task,
  columns,
  child,
  open,
  progress,
  onToggle,
}: RowProps) {
  const isEpic = task.kind === "epic";

  return (
    <tr
      data-task={task.key}
      data-child={child ? "true" : undefined}
      data-epic={isEpic ? "true" : undefined}
      className={`h-[var(--row-h)] border-b border-bd-subtle transition-colors
                  duration-(--dur-hover-out) hover:bg-raised
                  hover:duration-(--dur-hover-in) ${isEpic ? "bg-accent/5" : ""}`}
    >
      {columns.map((column) => {
        const isKey = column.id === "key";
        const isTitle = column.id === "title";
        return (
          <td
            key={column.id}
            className={`whitespace-nowrap px-3 align-middle ${ALIGN[column.align]} ${
              isKey
                ? // docs/13: monospace marks an identifier — a key goes in a URL.
                  "font-mono text-id text-tx-muted"
                : isTitle
                  ? `w-full truncate text-row ${
                      child ? "text-tx-secondary" : "text-tx-primary"
                    } ${isEpic ? "font-medium" : ""}`
                  : "text-prop text-tx-secondary"
            }`}
            data-numeric={column.id === "updated" || column.align === "right" ? "" : undefined}
          >
            {isKey && isEpic && (
              <Disclosure
                open={open === true}
                label={`${open === true ? "Collapse" : "Expand"} ${task.key}`}
                onClick={() => onToggle(task.id)}
              />
            )}
            {isKey && child && <ChildGuide />}
            {cellContent(column, task, progress)}
          </td>
        );
      })}
    </tr>
  );
});

function GroupRow({
  status,
  count,
  open,
  span,
  onToggle,
}: {
  status: Status;
  count: number;
  open: boolean;
  span: number;
  onToggle: (status: Status) => void;
}) {
  return (
    <tr data-group={status}>
      <td colSpan={span} className="border-b border-bd-subtle px-3 pt-3.5 pb-[7px]">
        <div className="flex items-center gap-2 text-prop font-semibold text-tx-primary">
          <button
            type="button"
            aria-expanded={open}
            aria-label={`${open ? "Collapse" : "Expand"} ${STATUS_LABEL[status]}`}
            onClick={() => onToggle(status)}
            className="w-[9px] text-[9px] leading-none text-tx-muted
                       transition-colors duration-(--dur-hover-out)
                       hover:text-tx-primary hover:duration-(--dur-hover-in)"
          >
            {open ? "▾" : "›"}
          </button>
          <StatusRing status={status} size={9} />
          <span>{STATUS_LABEL[status]}</span>
          <span className="font-normal text-tx-muted" data-numeric>
            {count}
          </span>
        </div>
      </td>
    </tr>
  );
}

/* ── the table ──────────────────────────────────────────────────────────── */

function Table({ model, columns }: { model: TableModel; columns: Column[] }) {
  const [openEpics, setOpenEpics] = useState<ReadonlySet<string>>(() => new Set());
  const [shutGroups, setShutGroups] = useState<ReadonlySet<Status>>(() => new Set());

  // Stable callbacks: a new function on every render would defeat the row
  // memoisation and re-render the whole table on one disclosure click.
  const toggleEpic = useCallback((id: string) => {
    setOpenEpics((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }, []);

  const toggleGroup = useCallback((status: Status) => {
    setShutGroups((current) => {
      const next = new Set(current);
      if (!next.delete(status)) next.add(status);
      return next;
    });
  }, []);

  return (
    <table className="w-full border-collapse text-row">
      <thead>
        <tr>
          {columns.map((column) => (
            <th
              key={column.id}
              scope="col"
              style={column.width ? { width: column.width } : undefined}
              // Sticky: a thousand rows scroll past, and a glyph column is
              // unreadable once the head that names it is gone.
              className={`sticky top-0 z-[1] whitespace-nowrap border-b border-bd-subtle
                          bg-surface px-3 py-[9px] font-mono text-label font-medium
                          uppercase text-tx-muted ${ALIGN[column.align]}`}
            >
              {column.label}
            </th>
          ))}
        </tr>
      </thead>

      <tbody>
        {model.groups.map((group) => {
          const open = !shutGroups.has(group.status);
          return (
            // A fragment, not a wrapper: a `<tbody>` takes rows and nothing else.
            <Fragment key={group.status}>
              <GroupRow
                status={group.status}
                count={group.tasks.length}
                open={open}
                span={columns.length}
                onToggle={toggleGroup}
              />
              {open &&
                group.tasks.map((task) => {
                  // A plain task is one row and nothing else: the common case
                  // costs one element, not an element inside a fragment.
                  if (task.kind !== "epic") {
                    return (
                      <TaskRow
                        key={task.id}
                        task={task}
                        columns={columns}
                        child={false}
                        progress={null}
                        onToggle={toggleEpic}
                      />
                    );
                  }

                  const expanded = openEpics.has(task.id);
                  const children = expanded ? (model.childrenOf.get(task.id) ?? []) : [];
                  return (
                    <Fragment key={task.id}>
                      <TaskRow
                        task={task}
                        columns={columns}
                        child={false}
                        open={expanded}
                        progress={epicProgressText(epicProgress(task, model.childrenOf))}
                        onToggle={toggleEpic}
                      />
                      {children.map((kid) => (
                        <TaskRow
                          key={kid.id}
                          task={kid}
                          columns={columns}
                          child
                          progress={null}
                          onToggle={toggleEpic}
                        />
                      ))}
                    </Fragment>
                  );
                })}
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}

/**
 * `/p/:project`. The shell has already read the project, so this screen only
 * reads the tasks; the project comes back from the query cache.
 *
 * `filters` is the state of the rail. It lives in the query string (docs/07
 * "Saved views"), the route reads it there and hands it down, and the table
 * never holds a copy — that is what makes a filtered list a link and Back the
 * undo. No filters is the whole project.
 */
export function TaskTable({ slug, filters = {} }: { slug: string; filters?: Filters }) {
  const project = useProject(slug);
  const tasks = useTasks(slug);

  const columns = useMemo(
    () => tableColumns(project.data?.fieldSchema ?? []),
    [project.data?.fieldSchema],
  );

  const model = useMemo(
    () =>
      buildTable(
        filterTasks(tasks.data ?? [], filters, project.data?.fieldSchema ?? []),
        project.data?.statuses ?? [],
      ),
    [tasks.data, filters, project.data?.fieldSchema, project.data?.statuses],
  );

  if (tasks.isPending) {
    return <p className="p-6 text-prop text-tx-muted">Loading tasks…</p>;
  }
  if (tasks.isError) {
    return (
      <p className="p-6 text-prop text-pr-urgent">
        The tasks could not be read: {(tasks.error as Error).message}
      </p>
    );
  }
  if (model.total === 0) {
    return (
      <p className="p-6 text-prop text-tx-muted">
        {activeFilterCount(filters) > 0
          ? "No tasks match these filters."
          : "No tasks in this project yet."}
      </p>
    );
  }

  return <Table model={model} columns={columns} />;
}

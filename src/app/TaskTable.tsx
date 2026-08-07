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
 * Every cell but the key and the timestamp edits in place (docs/07
 * "Editing"): a click opens a control inside the cell, blur or Enter saves,
 * Esc cancels, and a refused write flashes the row clay and puts the old
 * value back. There is no modal form and no Save control. What each column
 * edits, and what its write says, is in ./edit.ts.
 *
 * There is no virtualiser. The dependency list of docs/14 does not name one,
 * and it does not need to: every row is memoised on its task, so a project
 * of a thousand tasks pays for its rows once and an expand or a collapse
 * re-renders the handful of rows that changed.
 */

import { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SizePill } from "../ui/controls";
import { PriorityIcon, SizeIcon, StatusRing, TypeIcon } from "../ui/shapes";
import { SIZE_LABEL, STATUS_LABEL } from "../ui/vocabulary";
import {
  columnEditors,
  isNoop,
  FLASH_MS,
  type EditorSpec,
  type TaskPatch,
} from "./edit";
import { activeFilterCount, filterTasks, type Filters } from "./facets";
import { relativeTime } from "./format";
import { useProject, useSaveTask, useTasks } from "./queries";
import {
  buildTable,
  epicProgress,
  epicProgressText,
  formatFieldValue,
  tableColumns,
  taskType,
  type Column,
  type TableModel,
  type TaskView,
} from "./table";
import { ValueEditor } from "./ValueEditor";
import type { Status } from "../shared/statuses.js";

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

function cellContent(column: Column, task: TaskView) {
  switch (column.id) {
    case "key":
      return task.key;
    case "title":
      // The epic count is not part of the title, so it is not part of what a
      // click on the title edits: the row prints it beside the editor.
      return <span className="align-middle">{task.title}</span>;
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

/* ── editing (docs/07 "Editing") ────────────────────────────────────────── */

/**
 * An editable cell is the click target — the whole cell, not a control inside
 * it. docs/07 asks for a value on screen that the user clicks, and a table of
 * a thousand rows cannot answer that with seven buttons per row: it would put
 * seven thousand stops in the tab order and make every accessible-name query
 * walk them. The keyboard path to an edit is `E` on the focused row, and the
 * keyboard map has one owner (docs/07 "Keyboard", T47).
 */
const EDITABLE_CELL =
  "cursor-text transition-colors duration-(--dur-hover-out) " +
  "hover:bg-overlay hover:duration-(--dur-hover-in)";

/* ── rows ───────────────────────────────────────────────────────────────── */

interface RowProps {
  task: TaskView;
  columns: readonly Column[];
  /** The editor of each editable column, by column id. Not editable: absent. */
  editors: ReadonlyMap<string, EditorSpec>;
  /** A child of an open epic: indented, and quieter than its parent. */
  child: boolean;
  /** Epic rows only: whether the children are showing. */
  open?: boolean;
  progress: string | null;
  /** The column being edited on this row, or null. One cell at a time. */
  editing: string | null;
  /** The last write on this row was refused: clay, then back (docs/13). */
  rejected: boolean;
  onToggle: (id: string) => void;
  onOpen: (taskId: string, columnId: string) => void;
  onCommit: (task: TaskView, spec: EditorSpec, raw: string) => void;
  onCancel: () => void;
}

const TaskRow = memo(function TaskRow({
  task,
  columns,
  editors,
  child,
  open,
  progress,
  editing,
  rejected,
  onToggle,
  onOpen,
  onCommit,
  onCancel,
}: RowProps) {
  const isEpic = task.kind === "epic";

  return (
    <tr
      data-task={task.key}
      data-child={child ? "true" : undefined}
      data-epic={isEpic ? "true" : undefined}
      data-rejected={rejected ? "true" : undefined}
      // Inline, not a utility: the flash has to beat the hover duration on the
      // same property, and a token duration in a class cannot promise that.
      style={rejected ? { transitionDuration: "var(--dur-slow)" } : undefined}
      className={`h-[var(--row-h)] border-b border-bd-subtle transition-colors
                  duration-(--dur-hover-out) hover:bg-raised
                  hover:duration-(--dur-hover-in) ${
                    rejected ? "bg-pr-urgent/25" : isEpic ? "bg-accent/5" : ""
                  }`}
    >
      {columns.map((column) => {
        const isKey = column.id === "key";
        const isTitle = column.id === "title";
        const spec = editors.get(column.id);
        const content = cellContent(column, task);
        // A click inside an open editor bubbles to the cell; it must not
        // re-open the editor it came from.
        const opens = spec !== undefined && editing !== column.id;
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
            } ${spec === undefined ? "" : EDITABLE_CELL}`}
            // Marks the cell as editable without renaming it: a screen reader
            // must still read the value, not the action. The editor that
            // opens carries the label.
            data-edit={spec === undefined ? undefined : column.id}
            onClick={opens ? () => onOpen(task.id, column.id) : undefined}
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
            {spec !== undefined && editing === column.id ? (
              <ValueEditor spec={spec} task={task} onCommit={onCommit} onCancel={onCancel} />
            ) : (
              content
            )}
            {isTitle && progress !== null && (
              <span className="ml-[9px] align-middle text-id text-tx-muted" data-numeric>
                {progress}
              </span>
            )}
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

/** Which cell is open. One at a time: an edit ends when the next one starts. */
interface EditingCell {
  taskId: string;
  columnId: string;
}

function Table({
  model,
  columns,
  editors,
  save,
}: {
  model: TableModel;
  columns: Column[];
  editors: ReadonlyMap<string, EditorSpec>;
  /** Writes one edit. It rejects when the service refuses (docs/06). */
  save: (task: TaskView, patch: TaskPatch) => Promise<unknown>;
}) {
  const [openEpics, setOpenEpics] = useState<ReadonlySet<string>>(() => new Set());
  const [shutGroups, setShutGroups] = useState<ReadonlySet<Status>>(() => new Set());
  const [editing, setEditing] = useState<EditingCell | null>(null);
  /** The rows whose last write was refused — clay for one beat (docs/13). */
  const [rejected, setRejected] = useState<ReadonlySet<string>>(() => new Set());

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

  const openEditor = useCallback((taskId: string, columnId: string) => {
    setEditing({ taskId, columnId });
  }, []);

  const cancelEdit = useCallback(() => setEditing(null), []);

  const flash = useCallback((id: string) => {
    setRejected((current) => new Set(current).add(id));
    window.setTimeout(() => {
      setRejected((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    }, FLASH_MS);
  }, []);

  const commit = useCallback(
    (task: TaskView, spec: EditorSpec, raw: string) => {
      // The editor closes on commit, not on the answer: docs/07 shows the
      // change at once, and a control that lingers is a Save button waiting.
      setEditing(null);
      if (isNoop(spec, task, raw)) return;
      // The rejection is the flash; the value itself is put back by the
      // mutation, which holds the row as it was before the guess.
      void save(task, spec.patch(raw)).catch(() => flash(task.id));
    },
    [save, flash],
  );

  /** The column open on one row, or null. A row is only told about itself. */
  const editingOn = (taskId: string) =>
    editing !== null && editing.taskId === taskId ? editing.columnId : null;

  // Every value here is stable, so spreading it does not defeat the memo.
  const shared = {
    columns,
    editors,
    onToggle: toggleEpic,
    onOpen: openEditor,
    onCommit: commit,
    onCancel: cancelEdit,
  };

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
                        child={false}
                        progress={null}
                        editing={editingOn(task.id)}
                        rejected={rejected.has(task.id)}
                        {...shared}
                      />
                    );
                  }

                  const expanded = openEpics.has(task.id);
                  const children = expanded ? (model.childrenOf.get(task.id) ?? []) : [];
                  return (
                    <Fragment key={task.id}>
                      <TaskRow
                        task={task}
                        child={false}
                        open={expanded}
                        progress={epicProgressText(epicProgress(task, model.childrenOf))}
                        editing={editingOn(task.id)}
                        rejected={rejected.has(task.id)}
                        {...shared}
                      />
                      {children.map((kid) => (
                        <TaskRow
                          key={kid.id}
                          task={kid}
                          child
                          progress={null}
                          editing={editingOn(kid.id)}
                          rejected={rejected.has(kid.id)}
                          {...shared}
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

  // One editor per column, not per cell: the menu of a select comes from the
  // schema, so a thousand rows share it.
  const editors = useMemo(
    () => columnEditors(columns, project.data?.fieldSchema ?? []),
    [columns, project.data?.fieldSchema],
  );

  // The mutation object is new on every render; the rows are not allowed to
  // be. One stable callback in front of it keeps the memo intact.
  const mutation = useSaveTask(slug);
  const latest = useRef(mutation);
  useEffect(() => {
    latest.current = mutation;
  });
  const save = useCallback(
    (task: TaskView, patch: TaskPatch) => latest.current.mutateAsync({ task, patch }),
    [],
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

  return <Table model={model} columns={columns} editors={editors} save={save} />;
}

/* Interim task creation (specs/TASKS.md T23).
 *
 * docs/08-ai-compose.md opens with "the service has no form for a new task —
 * it has a text box" and describes `POST …/tasks/compose`, which Claude has
 * not been wired up to yet (T35/T36). Until then the workspace needs *some*
 * way to add a task, so this is a deliberate, narrow exception to that rule:
 * one plain input, `{ title }`, straight to `POST /api/projects/:project/
 * tasks` (T12) — no draft, no questions, no field inference.
 *
 * T41 (the composer, at `/p/:project/new`) replaces this surface outright.
 * That is why every part of the interim UI lives in this one file and touches
 * nothing else's internals: deleting this component and its one call site in
 * App.tsx is the whole migration.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiPost } from "./api";
import { queryKeys } from "./queries";
import type { TaskView } from "./table";

/** True while the keyboard focus is already inside a text control — `C`
 *  must not steal a keystroke the user is typing somewhere else. */
function typing(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

/**
 * The new row is drawn by the table (src/app/TaskTable.tsx), not by this
 * component — this only waits for it to appear and moves focus onto it, the
 * way docs/07 "Keyboard" describes `C` finishing on the row it made.
 *
 * The write that adds the row to the query cache and the state change that
 * triggers this effect usually land in the same React commit, but nothing
 * guarantees it — so this polls a few animation frames rather than assuming
 * the row is already on screen the instant the effect runs.
 */
function focusRow(key: string, onDone: () => void): () => void {
  let cancelled = false;
  let attempts = 0;

  const attempt = () => {
    if (cancelled) return;
    const row = document.querySelector<HTMLElement>(`tr[data-task="${key}"]`);
    if (row) {
      if (!row.hasAttribute("tabindex")) row.setAttribute("tabindex", "-1");
      row.focus();
      onDone();
      return;
    }
    attempts += 1;
    if (attempts < 20) {
      setTimeout(attempt, 0);
    } else {
      onDone(); // Gave up — the row never showed up; nothing more to wait for.
    }
  };
  attempt();

  return () => {
    cancelled = true;
  };
}

/**
 * `C` opens the input; the "New task" button does the same thing. Both live
 * on the table screen (docs/07 "Keyboard", `C` — "New task").
 */
export function QuickCreate({ slug }: { slug: string }) {
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);

  // Waits for the table to commit the new row, then focuses it.
  useEffect(() => {
    if (focusKey === null) return undefined;
    return focusRow(focusKey, () => setFocusKey(null));
  }, [focusKey]);

  useEffect(() => {
    if (open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "c") return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (typing(event.target)) return;
      event.preventDefault();
      setOpen(true);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  const close = useCallback(() => {
    setOpen(false);
    setTitle("");
    setError(null);
  }, []);

  const submit = useCallback(async () => {
    const value = title.trim();
    if (value === "" || pending) return;
    setPending(true);
    setError(null);
    try {
      const task = await apiPost<TaskView>(
        `/api/projects/${encodeURIComponent(slug)}/tasks`,
        { title: value },
      );
      client.setQueryData<TaskView[]>(queryKeys.tasks(slug), (rows) =>
        rows ? [...rows, task] : [task],
      );
      setOpen(false);
      setTitle("");
      setFocusKey(task.key);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The task could not be created");
    } finally {
      setPending(false);
    }
  }, [client, pending, slug, title]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void submit();
    } else if (event.key === "Escape") {
      event.preventDefault();
      close();
    }
  };

  if (!open) {
    return (
      <div className="flex items-center gap-2 border-b border-bd-subtle px-3 py-2">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="text-prop text-tx-secondary transition-colors duration-(--dur-hover-out)
                     hover:text-tx-primary hover:duration-(--dur-hover-in)"
        >
          + New task
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 border-b border-bd-subtle px-3 py-2">
      <input
        ref={input}
        type="text"
        value={title}
        disabled={pending}
        onChange={(event) => setTitle(event.target.value)}
        onKeyDown={onKeyDown}
        onBlur={close}
        placeholder="Task title, then Enter"
        aria-label="New task title"
        className="h-[23px] w-full max-w-sm min-w-0 rounded-[4px] border border-bd-strong
                   bg-raised px-1 text-row text-tx-primary outline-none focus:border-accent"
      />
      {error && (
        <span role="alert" className="text-prop text-pr-urgent">
          {error}
        </span>
      )}
    </div>
  );
}

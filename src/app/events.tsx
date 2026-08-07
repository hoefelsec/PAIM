/* Live updates over `GET /api/events` (specs/06-events.md, T22).
 *
 * One subscription for the whole app — opened in the shell (see Shell.tsx)
 * so a screen never manages its own `EventSource`. On every frame it
 * invalidates the TanStack Query keys the change could have touched; on
 * reconnect it revalidates everything, because a frame lost while the
 * stream was down has no replay (specs/06: "replay not required — clients
 * revalidate via TanStack Query on reconnect").
 *
 * docs/07-user-interface.md "Editing": "Server-Sent Events keep the
 * interface current. […] The interface subscribes to GET /api/events."
 */

import type { QueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { ChangeEvent } from "../shared/events.js";

export type LiveState = "connecting" | "open" | "closed";

/**
 * Which cached queries a change could affect. The event carries the
 * project's id (src/shared/events.ts), not the slug the query keys of
 * ./queries.ts are built from, so this invalidates every query of the shape
 * rather than resolving the one slug — a workspace has tens of projects, not
 * thousands, so the extra reads cost nothing on a loopback service.
 */
export function invalidateForEvent(client: QueryClient, event: ChangeEvent): void {
  switch (event.type) {
    case "task":
      // Every task list, every single task a task view is holding open, and
      // the open/done tallies the switcher and the grid read (queryKeys.tasks
      // / queryKeys.task / queryKeys.projectStats).
      void client.invalidateQueries({ queryKey: ["tasks"] });
      void client.invalidateQueries({ queryKey: ["task"] });
      void client.invalidateQueries({ queryKey: ["project-stats"] });
      return;
    case "project":
      void client.invalidateQueries({ queryKey: ["projects"] });
      void client.invalidateQueries({ queryKey: ["project"] });
      void client.invalidateQueries({ queryKey: ["project-stats"] });
      return;
    case "schema":
      // The field schema lives on the project row (docs/06), not a record
      // of its own — a schema write is a project write as far as the cache
      // is concerned.
      void client.invalidateQueries({ queryKey: ["project"] });
      return;
    case "view":
      // No saved-view query exists yet (docs/07 "Saved views" ships later);
      // nothing in the cache can be stale from one.
      return;
  }
}

/**
 * Subscribes to `GET /api/events` for as long as the caller stays mounted.
 * Reconnection itself is `EventSource`'s own job — the browser retries a
 * dropped connection on its own — so this hook's job is to notice the gap
 * and revalidate every cache the moment the stream comes back, and to report
 * the connection state so the interface can show it (docs/07 "Editing").
 */
export function useLiveEvents(client: QueryClient): LiveState {
  const [state, setState] = useState<LiveState>("connecting");

  useEffect(() => {
    let everOpened = false;
    const source = new EventSource("/api/events");

    source.onopen = () => {
      if (everOpened) {
        // The connection was down and is back: whatever changed during the
        // gap produced no frame, so every cache is suspect, not just one.
        void client.invalidateQueries();
      }
      everOpened = true;
      setState("open");
    };

    source.onmessage = (message: MessageEvent<string>) => {
      let event: ChangeEvent;
      try {
        event = JSON.parse(message.data) as ChangeEvent;
      } catch {
        return; // A malformed frame is dropped, not a fatal error.
      }
      invalidateForEvent(client, event);
    };

    source.onerror = () => {
      // `EventSource` retries by itself; this only reflects that the link is
      // down right now, for the indicator below.
      setState("closed");
    };

    return () => source.close();
  }, [client]);

  return state;
}

const LABEL: Record<LiveState, string> = {
  open: "Live",
  connecting: "Connecting",
  closed: "Offline",
};

/**
 * The `live` indicator (specs/06-events.md T22, docs/07 "toolbar"): a dot and
 * a word, nothing else — the interface has no banner and no toast, so a
 * dropped connection shows here and nowhere louder.
 */
export function LiveIndicator({ state }: { state: LiveState }) {
  const live = state === "open";
  return (
    <span
      role="status"
      aria-label={`Live updates: ${LABEL[state]}`}
      data-testid="live-indicator"
      data-state={state}
      title={LABEL[state]}
      className="inline-flex items-center gap-1.5 font-mono text-label
                 uppercase text-tx-muted"
    >
      <span
        aria-hidden="true"
        className={`size-1.5 shrink-0 rounded-full ${
          live ? "bg-st-done" : state === "connecting" ? "bg-pr-medium" : "bg-pr-urgent"
        }`}
      />
      {LABEL[state]}
    </span>
  );
}

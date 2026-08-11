/* The run stream, `GET /api/runs/:run/stream` (T59, docs/09 "Streams").
 *
 * `GET /api/events` (src/app/events.tsx) carries *data* changes and is opened
 * once for the whole app. A run is not a data change: it announces itself on
 * its own feed, one frame per operation lifecycle step and one per run status
 * change (src/server/runs/streams.ts). So the Run tab opens a second stream,
 * for exactly the run it is showing, and closes it when it moves on.
 *
 * A frame carries the run and at most one operation — never the whole log —
 * so the cache is folded, not refetched: a run of forty operations does not
 * re-read forty rows because the forty-first started.
 *
 * The registry names its frames (`event: run`, `event: operation`), and a
 * named frame does not reach `EventSource.onmessage`; both names are listened
 * for by hand.
 */

import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { queryKeys } from "./queries";
import { applyRunFrame, type RunFrame } from "./run";
import type { RunView } from "../shared/runs.js";

export const RUN_FRAME_NAMES = ["run", "operation"] as const;

/**
 * Keeps the cached run current for as long as the caller is mounted. Passing
 * `null` opens nothing — the tab has no run to watch yet.
 */
export function useRunStream(runId: string | null): void {
  const client = useQueryClient();

  useEffect(() => {
    if (runId === null) return;
    // jsdom has no EventSource unless a test installs one, and neither does
    // a server-rendered pass; the tab still works, it just does not stream.
    if (typeof EventSource === "undefined") return;

    const source = new EventSource(`/api/runs/${encodeURIComponent(runId)}/stream`);

    const apply = (message: MessageEvent<string>): void => {
      let frame: RunFrame;
      try {
        frame = JSON.parse(message.data) as RunFrame;
      } catch {
        return; // A malformed frame is dropped, not a fatal error.
      }
      client.setQueryData<RunView>(queryKeys.run(runId), (current) =>
        applyRunFrame(current, frame),
      );
    };

    const listener = apply as EventListener;
    for (const name of RUN_FRAME_NAMES) source.addEventListener(name, listener);

    return () => {
      for (const name of RUN_FRAME_NAMES) source.removeEventListener(name, listener);
      source.close();
    };
  }, [runId, client]);
}

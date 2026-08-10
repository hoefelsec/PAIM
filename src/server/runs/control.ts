/**
 * Pause and cancel, from the side of the running agent (T56; docs/09-ai-run.md
 * "Cancel and Restore are different actions", docs/06 "Runs").
 *
 * The three controls of docs/09 are not three interrupts:
 *
 * | Pause  | "The run stops at the end of the current operation. It can resume." |
 * | Cancel | "The run stops. The changes stay." |
 * | Restore| A different action entirely (T57). |
 *
 * So a pause is a *request*, not a stop: the endpoint records it here and
 * returns, and the runner reads it at its next operation boundary — the
 * moment before it asks permission for the next tool, which is exactly the
 * end of the current operation. Nothing is interrupted mid-operation, and
 * the agent's context survives the wait because the run's own promise is
 * what parks (specs/09: "resume continues with context").
 *
 * A cancel is immediate: it aborts the run's signal, so a parked approval
 * (docs/10 §4) and the agent itself both come out of their wait, and it
 * makes every later boundary throw {@link RunCancelledError} so no further
 * operation is proposed.
 *
 * This module is only the rendezvous the two sides meet at, keyed by run id
 * — the same shape src/server/runs/approvals.ts has for approvals. What the
 * endpoints do with the run *record* lives in src/server/routes/runs.ts.
 */

/** Thrown at an operation boundary, and into a parked waiter, on cancel. */
export class RunCancelledError extends Error {
  constructor(readonly runId: string) {
    super(`Run ${runId} was cancelled`);
    this.name = "RunCancelledError";
  }
}

/** Thrown when the run is torn down for a reason that is not a user cancel. */
export class RunAbortedError extends Error {
  constructor(readonly runId: string) {
    super(`Run ${runId} was aborted`);
    this.name = "RunAbortedError";
  }
}

/** The runner's side of one run's controls, for as long as it drives it. */
export interface RunControlHandle {
  readonly runId: string;
  /**
   * Handed to the agent and to every wait inside the run. Aborted on
   * cancel, so nothing keeps working after the user said stop.
   */
  readonly signal: AbortSignal;
  /** Whether a pause is outstanding — the next boundary will stop. */
  isPaused(): boolean;
  isCancelled(): boolean;
  /**
   * The operation boundary. Resolves at once for a run nobody touched,
   * parks while a pause is outstanding, and rejects with
   * {@link RunCancelledError} when the run was cancelled.
   */
  boundary(): Promise<void>;
  /** Detaches this run when it ends. Called once, by the runner. */
  release(): void;
}

export interface RunControlRegistry {
  /**
   * Registers a run as controllable and returns the runner's handle. One
   * run is driven once: registering the same id twice is a programming
   * error, not a state the endpoints can reach.
   */
  register(runId: string, signal?: AbortSignal): RunControlHandle;
  /** Requests a pause. False when this run is not in flight. */
  pause(runId: string): boolean;
  /** Clears an outstanding pause. False when there was none. */
  resume(runId: string): boolean;
  /** Stops the run now. False when this run is not in flight. */
  cancel(runId: string): boolean;
  isPaused(runId: string): boolean;
  isCancelled(runId: string): boolean;
  /** Whether a runner is driving this run right now. */
  has(runId: string): boolean;
  /** Every run in flight, in the order they registered. */
  inFlight(): string[];
}

interface Waiter {
  resolve(): void;
  reject(error: Error): void;
}

interface Entry {
  paused: boolean;
  cancelled: boolean;
  controller: AbortController;
  waiters: Set<Waiter>;
  detach(): void;
}

export function createRunControlRegistry(): RunControlRegistry {
  const runs = new Map<string, Entry>();

  /** Settles everything parked at a boundary, then empties the set. */
  function drain(entry: Entry, error: Error | null): void {
    const waiting = [...entry.waiters];
    entry.waiters.clear();
    for (const waiter of waiting) {
      if (error === null) waiter.resolve();
      else waiter.reject(error);
    }
  }

  function boundary(runId: string): Promise<void> {
    const entry = runs.get(runId);
    // A released run has no controls left; the run is ending anyway.
    if (!entry) return Promise.resolve();
    if (entry.cancelled) return Promise.reject(new RunCancelledError(runId));
    if (entry.controller.signal.aborted) return Promise.reject(new RunAbortedError(runId));
    if (!entry.paused) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      entry.waiters.add({ resolve, reject });
    });
  }

  function register(runId: string, signal?: AbortSignal): RunControlHandle {
    if (runs.has(runId)) {
      throw new Error(`Run ${runId} is already registered with the control registry`);
    }

    const controller = new AbortController();
    const entry: Entry = {
      paused: false,
      cancelled: false,
      controller,
      waiters: new Set(),
      detach: () => {},
    };

    // A signal the caller already owns (the queue's, a test's) is folded in,
    // so one abort reaches everything the run waits on. It is not a cancel:
    // `cancelled` stays false, and the run ends `failed`, not `cancelled`.
    if (signal) {
      if (signal.aborted) {
        controller.abort();
      } else {
        const onAbort = (): void => {
          controller.abort();
          drain(entry, new RunAbortedError(runId));
        };
        signal.addEventListener("abort", onAbort, { once: true });
        entry.detach = () => signal.removeEventListener("abort", onAbort);
      }
    }

    runs.set(runId, entry);

    return {
      runId,
      signal: controller.signal,
      isPaused: () => entry.paused,
      isCancelled: () => entry.cancelled,
      boundary: () => boundary(runId),
      release() {
        entry.detach();
        entry.detach = () => {};
        runs.delete(runId);
        drain(entry, new RunAbortedError(runId));
      },
    };
  }

  return {
    register,
    pause(runId) {
      const entry = runs.get(runId);
      if (!entry || entry.cancelled) return false;
      entry.paused = true;
      return true;
    },
    resume(runId) {
      const entry = runs.get(runId);
      if (!entry || !entry.paused) return false;
      entry.paused = false;
      drain(entry, null);
      return true;
    },
    cancel(runId) {
      const entry = runs.get(runId);
      if (!entry) return false;
      entry.cancelled = true;
      entry.paused = false;
      entry.controller.abort();
      drain(entry, new RunCancelledError(runId));
      return true;
    },
    isPaused: (runId) => runs.get(runId)?.paused ?? false,
    isCancelled: (runId) => runs.get(runId)?.cancelled ?? false,
    has: (runId) => runs.has(runId),
    inFlight: () => [...runs.keys()],
  };
}

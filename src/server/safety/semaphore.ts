/**
 * Writer semaphore — the safety kernel's concurrency limiter (specs/08
 * "Concurrency semaphore", docs/10-execution-safety.md §6 "Concurrency").
 *
 * One number, `maxConcurrentRuns`, controls how many *writing* agents may
 * run at once in a single project's workspace. This is a correctness rule
 * (concurrent writers to the same filesystem corrupt each other's work),
 * not a performance knob — see docs/10 §6.
 *
 * - The semaphore is keyed per project: two projects with different
 *   workspaces never contend with each other.
 * - Waiters queue FIFO: whoever asked first is served first when a slot
 *   frees up.
 * - Capacity is supplied at acquisition time (the caller reads the
 *   project's current `maxConcurrentRuns`), so a capacity change takes
 *   effect for the next acquisition without needing to reconstruct
 *   anything — already-held slots and already-queued waiters are
 *   unaffected until it's their turn to be evaluated again.
 * - Release always happens, including on the run's error paths: callers
 *   should use `withWriterSlot`, which wraps `acquire`/`release` in a
 *   try/finally so a throwing or rejecting run still frees its slot.
 * - The epic scheduler never calls this — it does not write; only the
 *   agents it schedules do (docs/10 §6, specs/08 Scope).
 */

interface Waiter {
  capacity: number;
  resolve: (release: () => void) => void;
}

interface ProjectState {
  active: number;
  queue: Waiter[];
}

export interface WriterSemaphore {
  /**
   * Requests a writer slot for `projectKey`, given the project's current
   * `capacity` (its `maxConcurrentRuns`). Resolves with a `release`
   * function once a slot is held. If fewer than `capacity` slots are
   * active, resolves immediately; otherwise waits in FIFO order behind
   * earlier callers.
   *
   * `release` is idempotent-safe to call at most once per acquisition;
   * calling it frees the slot and hands it to the next eligible waiter,
   * if any.
   */
  acquire(projectKey: string, capacity: number): Promise<() => void>;

  /**
   * Acquires a slot, runs `fn`, and releases the slot in a `finally` —
   * guaranteeing release even if `fn` throws or its returned promise
   * rejects (specs/08: "guaranteed release on error paths").
   */
  run<T>(projectKey: string, capacity: number, fn: () => Promise<T>): Promise<T>;

  /** Current active-holder count for a project. Exposed for tests/inspection. */
  activeCount(projectKey: string): number;

  /** Current FIFO queue length for a project. Exposed for tests/inspection. */
  queueLength(projectKey: string): number;
}

export function createWriterSemaphore(): WriterSemaphore {
  const states = new Map<string, ProjectState>();

  function stateFor(projectKey: string): ProjectState {
    let state = states.get(projectKey);
    if (!state) {
      state = { active: 0, queue: [] };
      states.set(projectKey, state);
    }
    return state;
  }

  function makeRelease(projectKey: string): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      releaseSlot(projectKey);
    };
  }

  function releaseSlot(projectKey: string): void {
    const state = states.get(projectKey);
    if (!state) return;

    state.active = Math.max(0, state.active - 1);

    // FIFO: only the head of the queue can be promoted. If it still
    // doesn't fit under its recorded capacity, later waiters — even if
    // their own capacity would fit — wait too, preserving arrival order.
    while (state.queue.length > 0) {
      const head = state.queue[0]!;
      if (state.active >= head.capacity) break;
      state.queue.shift();
      state.active += 1;
      head.resolve(makeRelease(projectKey));
    }
  }

  function acquire(projectKey: string, capacity: number): Promise<() => void> {
    const state = stateFor(projectKey);

    if (state.queue.length === 0 && state.active < capacity) {
      state.active += 1;
      return Promise.resolve(makeRelease(projectKey));
    }

    return new Promise<() => void>((resolve) => {
      state.queue.push({ capacity, resolve });
    });
  }

  async function run<T>(projectKey: string, capacity: number, fn: () => Promise<T>): Promise<T> {
    const release = await acquire(projectKey, capacity);
    try {
      return await fn();
    } finally {
      release();
    }
  }

  function activeCount(projectKey: string): number {
    return states.get(projectKey)?.active ?? 0;
  }

  function queueLength(projectKey: string): number {
    return states.get(projectKey)?.queue.length ?? 0;
  }

  return { acquire, run, activeCount, queueLength };
}

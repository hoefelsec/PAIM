/**
 * The parking lot for operations that wait on a person (docs/10 §4 "An
 * approval has no time limit").
 *
 * When the policy says `ask`, the runner records the operation as
 * `proposed`, parks here, and stops. It does not poll, it does not expire,
 * and it does not guess: "the service does not cancel it and does not
 * approve it. The run holds its position, its context, and its concurrency
 * slot while it waits."
 *
 * The answer arrives from `POST /api/runs/:run/approve|deny`, which is the
 * run-control work's endpoint (specs/09, T56). This module is only the
 * rendezvous the two sides meet at, keyed by operation id.
 */

/** How a parked operation was answered. */
export type ApprovalAnswer = { approved: true } | { approved: false; reason: string };

/** Thrown into a parked waiter when its run is torn down unanswered. */
export class ApprovalAbandonedError extends Error {
  constructor(readonly operationId: string) {
    super(`Approval for operation ${operationId} was abandoned`);
    this.name = "ApprovalAbandonedError";
  }
}

export interface ApprovalRegistry {
  /**
   * Parks until someone answers. There is no timeout — the returned promise
   * settles only when {@link approve}, {@link deny}, or {@link abandon} is
   * called for this operation, or when `signal` aborts (which rejects with
   * {@link ApprovalAbandonedError}).
   */
  wait(operationId: string, signal?: AbortSignal): Promise<ApprovalAnswer>;
  /** Answers a parked operation. False when nothing is parked under that id. */
  approve(operationId: string): boolean;
  /** Answers a parked operation with a refusal the model will read. */
  deny(operationId: string, reason: string): boolean;
  /** Rejects a parked waiter — used when a run ends before its answer came. */
  abandon(operationId: string): boolean;
  isPending(operationId: string): boolean;
  /** Every operation currently parked, in the order they parked. */
  pending(): string[];
}

interface Waiter {
  settle(answer: ApprovalAnswer): void;
  fail(error: Error): void;
}

export function createApprovalRegistry(): ApprovalRegistry {
  const waiters = new Map<string, Waiter>();

  function wait(operationId: string, signal?: AbortSignal): Promise<ApprovalAnswer> {
    if (waiters.has(operationId)) {
      return Promise.reject(
        new Error(`Operation ${operationId} is already awaiting approval`),
      );
    }

    return new Promise<ApprovalAnswer>((resolve, reject) => {
      let done = false;
      let detach = (): void => {};

      const finish = (): void => {
        done = true;
        waiters.delete(operationId);
        detach();
      };

      const waiter: Waiter = {
        settle(answer) {
          if (done) return;
          finish();
          resolve(answer);
        },
        fail(error) {
          if (done) return;
          finish();
          reject(error);
        },
      };

      if (signal?.aborted) {
        reject(new ApprovalAbandonedError(operationId));
        return;
      }

      waiters.set(operationId, waiter);

      if (signal) {
        const onAbort = (): void => waiter.fail(new ApprovalAbandonedError(operationId));
        signal.addEventListener("abort", onAbort, { once: true });
        detach = () => signal.removeEventListener("abort", onAbort);
      }
    });
  }

  function answer(operationId: string, value: ApprovalAnswer): boolean {
    const waiter = waiters.get(operationId);
    if (!waiter) return false;
    waiter.settle(value);
    return true;
  }

  return {
    wait,
    approve: (operationId) => answer(operationId, { approved: true }),
    deny: (operationId, reason) => answer(operationId, { approved: false, reason }),
    abandon(operationId) {
      const waiter = waiters.get(operationId);
      if (!waiter) return false;
      waiter.fail(new ApprovalAbandonedError(operationId));
      return true;
    },
    isPending: (operationId) => waiters.has(operationId),
    pending: () => [...waiters.keys()],
  };
}

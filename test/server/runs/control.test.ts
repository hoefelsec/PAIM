/**
 * The run control registry (T56; src/server/runs/control.ts) — the
 * rendezvous behind `POST /api/runs/:run/pause|resume|cancel`.
 *
 * docs/09 "Cancel and Restore are different actions": pause stops the run at
 * the end of the current operation and can resume; cancel stops it. Here
 * that is a boundary promise: it resolves at once for a run nobody touched,
 * parks while a pause is outstanding, and rejects once the run is cancelled.
 */

import { describe, expect, it, vi } from "vitest";
import {
  createRunControlRegistry,
  RunAbortedError,
  RunCancelledError,
} from "../../../src/server/runs/control.js";

/** Whether a promise has settled, without awaiting it. */
async function settled(promise: Promise<unknown>): Promise<boolean> {
  const marker = Symbol("pending");
  const result = await Promise.race([
    promise.then(
      () => "resolved",
      () => "rejected",
    ),
    Promise.resolve(marker),
  ]);
  return result !== marker;
}

describe("createRunControlRegistry", () => {
  it("passes an untouched run straight through its boundary", async () => {
    const controls = createRunControlRegistry();
    const handle = controls.register("run-1");

    expect(controls.has("run-1")).toBe(true);
    expect(controls.inFlight()).toEqual(["run-1"]);
    expect(handle.isPaused()).toBe(false);
    expect(handle.isCancelled()).toBe(false);
    await expect(handle.boundary()).resolves.toBeUndefined();
  });

  it("parks the boundary while a pause is outstanding and lets resume through", async () => {
    const controls = createRunControlRegistry();
    const handle = controls.register("run-1");

    expect(controls.pause("run-1")).toBe(true);
    expect(handle.isPaused()).toBe(true);
    expect(controls.isPaused("run-1")).toBe(true);

    const parked = handle.boundary();
    // The run holds here: a pause has no deadline of its own.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(await settled(parked)).toBe(false);

    expect(controls.resume("run-1")).toBe(true);
    await expect(parked).resolves.toBeUndefined();
    expect(handle.isPaused()).toBe(false);
  });

  it("releases every waiter of one run on a single resume", async () => {
    const controls = createRunControlRegistry();
    const handle = controls.register("run-1");
    controls.pause("run-1");

    const first = handle.boundary();
    const second = handle.boundary();
    controls.resume("run-1");

    await expect(Promise.all([first, second])).resolves.toEqual([undefined, undefined]);
  });

  it("rejects the boundary of a cancelled run, then every later one", async () => {
    const controls = createRunControlRegistry();
    const handle = controls.register("run-1");
    controls.pause("run-1");
    const parked = handle.boundary();

    expect(controls.cancel("run-1")).toBe(true);

    await expect(parked).rejects.toBeInstanceOf(RunCancelledError);
    await expect(handle.boundary()).rejects.toBeInstanceOf(RunCancelledError);
    expect(handle.isCancelled()).toBe(true);
    // A cancel clears the pause: there is nothing left to resume into.
    expect(handle.isPaused()).toBe(false);
    expect(controls.resume("run-1")).toBe(false);
  });

  it("aborts the run's signal on cancel, and only then", () => {
    const controls = createRunControlRegistry();
    const handle = controls.register("run-1");
    const onAbort = vi.fn();
    handle.signal.addEventListener("abort", onAbort);

    controls.pause("run-1");
    expect(handle.signal.aborted).toBe(false);
    expect(onAbort).not.toHaveBeenCalled();

    controls.cancel("run-1");
    expect(handle.signal.aborted).toBe(true);
    expect(onAbort).toHaveBeenCalledTimes(1);
  });

  it("controls one run without touching another", async () => {
    const controls = createRunControlRegistry();
    const first = controls.register("run-1");
    const second = controls.register("run-2");

    controls.pause("run-1");
    controls.cancel("run-2");

    expect(first.isPaused()).toBe(true);
    expect(first.isCancelled()).toBe(false);
    expect(first.signal.aborted).toBe(false);
    expect(second.isCancelled()).toBe(true);
    await expect(second.boundary()).rejects.toBeInstanceOf(RunCancelledError);
  });

  it("answers false for a run that is not in flight", () => {
    const controls = createRunControlRegistry();
    expect(controls.pause("nobody")).toBe(false);
    expect(controls.resume("nobody")).toBe(false);
    expect(controls.cancel("nobody")).toBe(false);
    expect(controls.has("nobody")).toBe(false);
    expect(controls.isPaused("nobody")).toBe(false);
    expect(controls.isCancelled("nobody")).toBe(false);
  });

  it("drops the run on release, so a later control finds nothing", async () => {
    const controls = createRunControlRegistry();
    const handle = controls.register("run-1");

    handle.release();

    expect(controls.has("run-1")).toBe(false);
    expect(controls.inFlight()).toEqual([]);
    expect(controls.pause("run-1")).toBe(false);
    expect(controls.cancel("run-1")).toBe(false);
    // The released handle no longer blocks anything.
    await expect(handle.boundary()).resolves.toBeUndefined();
  });

  it("refuses to register the same run twice", () => {
    const controls = createRunControlRegistry();
    controls.register("run-1");
    expect(() => controls.register("run-1")).toThrow(/already registered/);
  });

  it("folds an outside signal in without calling it a cancel", async () => {
    const controls = createRunControlRegistry();
    const outside = new AbortController();
    const handle = controls.register("run-1", outside.signal);
    controls.pause("run-1");
    const parked = handle.boundary();

    outside.abort();

    await expect(parked).rejects.toBeInstanceOf(RunAbortedError);
    await expect(handle.boundary()).rejects.toBeInstanceOf(RunAbortedError);
    expect(handle.signal.aborted).toBe(true);
    // The user did not cancel this run; it was torn down.
    expect(handle.isCancelled()).toBe(false);
  });

  it("registers a run whose outside signal already aborted as aborted", async () => {
    const controls = createRunControlRegistry();
    const handle = controls.register("run-1", AbortSignal.abort());

    expect(handle.signal.aborted).toBe(true);
    await expect(handle.boundary()).rejects.toBeInstanceOf(RunAbortedError);
  });
});

/**
 * The approval parking lot (docs/10-execution-safety.md §4 "An approval has
 * no time limit").
 */

import { describe, expect, it } from "vitest";
import {
  ApprovalAbandonedError,
  createApprovalRegistry,
} from "../../../src/server/runs/approvals.js";

describe("createApprovalRegistry", () => {
  it("parks until someone approves", async () => {
    const registry = createApprovalRegistry();
    const parked = registry.wait("op-1");

    expect(registry.isPending("op-1")).toBe(true);
    expect(registry.pending()).toEqual(["op-1"]);

    // Nothing expires it: it is still parked after the event loop turns.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(registry.isPending("op-1")).toBe(true);

    expect(registry.approve("op-1")).toBe(true);
    await expect(parked).resolves.toEqual({ approved: true });
    expect(registry.pending()).toEqual([]);
  });

  it("carries the reason back on a denial", async () => {
    const registry = createApprovalRegistry();
    const parked = registry.wait("op-1");
    expect(registry.deny("op-1", "not on production")).toBe(true);
    await expect(parked).resolves.toEqual({ approved: false, reason: "not on production" });
  });

  it("reports that nothing is parked under an unknown id", () => {
    const registry = createApprovalRegistry();
    expect(registry.approve("nope")).toBe(false);
    expect(registry.deny("nope", "why")).toBe(false);
    expect(registry.abandon("nope")).toBe(false);
    expect(registry.isPending("nope")).toBe(false);
  });

  it("answers only once", async () => {
    const registry = createApprovalRegistry();
    const parked = registry.wait("op-1");
    expect(registry.approve("op-1")).toBe(true);
    expect(registry.approve("op-1")).toBe(false);
    expect(registry.deny("op-1", "late")).toBe(false);
    await expect(parked).resolves.toEqual({ approved: true });
  });

  it("keeps the parking order", async () => {
    const registry = createApprovalRegistry();
    const first = registry.wait("op-1");
    const second = registry.wait("op-2");
    expect(registry.pending()).toEqual(["op-1", "op-2"]);
    registry.approve("op-2");
    registry.approve("op-1");
    await Promise.all([first, second]);
    expect(registry.pending()).toEqual([]);
  });

  it("refuses to park the same operation twice", async () => {
    const registry = createApprovalRegistry();
    const first = registry.wait("op-1");
    await expect(registry.wait("op-1")).rejects.toThrow(/already awaiting/);
    registry.approve("op-1");
    await first;
  });

  it("abandons a waiter whose run is gone", async () => {
    const registry = createApprovalRegistry();
    const parked = registry.wait("op-1");
    expect(registry.abandon("op-1")).toBe(true);
    await expect(parked).rejects.toBeInstanceOf(ApprovalAbandonedError);
    expect(registry.pending()).toEqual([]);
  });

  it("abandons a waiter when its run aborts", async () => {
    const registry = createApprovalRegistry();
    const controller = new AbortController();
    const parked = registry.wait("op-1", controller.signal);
    controller.abort();
    await expect(parked).rejects.toBeInstanceOf(ApprovalAbandonedError);
    expect(registry.pending()).toEqual([]);
  });

  it("does not park at all when the signal has already aborted", async () => {
    const registry = createApprovalRegistry();
    const controller = new AbortController();
    controller.abort();
    await expect(registry.wait("op-1", controller.signal)).rejects.toBeInstanceOf(
      ApprovalAbandonedError,
    );
    expect(registry.pending()).toEqual([]);
  });
});

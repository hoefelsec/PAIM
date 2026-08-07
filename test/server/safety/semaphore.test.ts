import { describe, expect, it } from "vitest";

import { createWriterSemaphore } from "../../../src/server/safety/semaphore.js";

/** Resolves on the next microtask tick, letting queued promises settle. */
function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("writer semaphore — capacity 1", () => {
  it("a second acquire waits until the first releases", async () => {
    const sem = createWriterSemaphore();
    const order: string[] = [];

    const release1 = await sem.acquire("proj-a", 1);
    order.push("acquired-1");
    expect(sem.activeCount("proj-a")).toBe(1);

    let acquired2 = false;
    const acquire2 = sem.acquire("proj-a", 1).then((release2) => {
      acquired2 = true;
      order.push("acquired-2");
      return release2;
    });

    await tick();
    expect(acquired2).toBe(false);
    expect(sem.queueLength("proj-a")).toBe(1);

    release1();
    const release2 = await acquire2;
    expect(acquired2).toBe(true);
    expect(order).toEqual(["acquired-1", "acquired-2"]);
    expect(sem.activeCount("proj-a")).toBe(1);

    release2();
    expect(sem.activeCount("proj-a")).toBe(0);
  });

  it("release is safe to call more than once and only frees one slot", async () => {
    const sem = createWriterSemaphore();
    const release1 = await sem.acquire("proj-idem", 1);
    release1();
    release1();
    expect(sem.activeCount("proj-idem")).toBe(0);

    const release2 = await sem.acquire("proj-idem", 1);
    expect(sem.activeCount("proj-idem")).toBe(1);
    release2();
  });

  it("guarantees release on error paths via run()", async () => {
    const sem = createWriterSemaphore();

    await expect(
      sem.run("proj-err", 1, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    // The slot must have been released despite the throw, so a fresh
    // acquisition proceeds immediately rather than queuing forever.
    expect(sem.activeCount("proj-err")).toBe(0);
    const release = await sem.acquire("proj-err", 1);
    expect(sem.activeCount("proj-err")).toBe(1);
    release();
  });

  it("releases on a rejected promise returned by fn", async () => {
    const sem = createWriterSemaphore();

    await expect(
      sem.run("proj-reject", 1, () => Promise.reject(new Error("nope"))),
    ).rejects.toThrow("nope");

    expect(sem.activeCount("proj-reject")).toBe(0);
  });

  it("queued waiters are served in FIFO order under induced failures", async () => {
    const sem = createWriterSemaphore();
    const finishOrder: string[] = [];

    const runOne = (label: string, shouldFail: boolean) =>
      sem.run("proj-fifo", 1, async () => {
        finishOrder.push(`start-${label}`);
        await tick();
        if (shouldFail) throw new Error(`fail-${label}`);
        return label;
      });

    const p1 = runOne("A", true).catch(() => "A-failed");
    await tick(); // let A acquire and start before B/C queue up
    const p2 = runOne("B", false);
    const p3 = runOne("C", false);

    const results = await Promise.all([p1, p2, p3]);
    expect(results).toEqual(["A-failed", "B", "C"]);
    expect(finishOrder).toEqual(["start-A", "start-B", "start-C"]);
    expect(sem.activeCount("proj-fifo")).toBe(0);
  });
});

describe("writer semaphore — capacity 2", () => {
  it("allows two concurrent holders and queues a third", async () => {
    const sem = createWriterSemaphore();

    const release1 = await sem.acquire("proj-two", 2);
    const release2 = await sem.acquire("proj-two", 2);
    expect(sem.activeCount("proj-two")).toBe(2);

    let acquired3 = false;
    const acquire3 = sem.acquire("proj-two", 2).then((release3) => {
      acquired3 = true;
      return release3;
    });

    await tick();
    expect(acquired3).toBe(false);
    expect(sem.queueLength("proj-two")).toBe(1);

    release1();
    const release3 = await acquire3;
    expect(acquired3).toBe(true);
    expect(sem.activeCount("proj-two")).toBe(2);

    release2();
    release3();
    expect(sem.activeCount("proj-two")).toBe(0);
  });

  it("induced failure in one of two concurrent runs still frees its slot", async () => {
    const sem = createWriterSemaphore();

    const failing = sem.run("proj-two-err", 2, async () => {
      throw new Error("boom");
    });
    const succeeding = sem.run("proj-two-err", 2, async () => {
      await tick();
      return "ok";
    });

    await expect(failing).rejects.toThrow("boom");
    await expect(succeeding).resolves.toBe("ok");
    expect(sem.activeCount("proj-two-err")).toBe(0);
  });
});

describe("writer semaphore — capacity change takes effect for new acquisitions", () => {
  it("a lower capacity does not evict an already-active holder, but blocks a new one until release", async () => {
    const sem = createWriterSemaphore();

    // Two holders acquired while capacity was effectively 2.
    const release1 = await sem.acquire("proj-cap", 2);
    const release2 = await sem.acquire("proj-cap", 2);
    expect(sem.activeCount("proj-cap")).toBe(2);

    // Capacity drops to 1 for the next acquisition: it must queue, not
    // evict either existing holder.
    let acquired3 = false;
    const acquire3 = sem.acquire("proj-cap", 1).then((release3) => {
      acquired3 = true;
      return release3;
    });
    await tick();
    expect(acquired3).toBe(false);
    expect(sem.activeCount("proj-cap")).toBe(2);

    release1();
    await tick();
    // Still under the new capacity(1) budget together with the third
    // waiter? active is now 1 (release1 freed a slot) which is not < 1,
    // so the third waiter still queues until release2 also frees its slot.
    expect(acquired3).toBe(false);

    release2();
    const release3 = await acquire3;
    expect(acquired3).toBe(true);
    expect(sem.activeCount("proj-cap")).toBe(1);
    release3();
  });

  it("a raised capacity lets a new acquisition proceed immediately alongside an existing holder", async () => {
    const sem = createWriterSemaphore();

    const release1 = await sem.acquire("proj-raise", 1);
    expect(sem.activeCount("proj-raise")).toBe(1);

    // Capacity raised to 2 for this new acquisition: it should not queue.
    const release2 = await sem.acquire("proj-raise", 2);
    expect(sem.activeCount("proj-raise")).toBe(2);
    expect(sem.queueLength("proj-raise")).toBe(0);

    release1();
    release2();
    expect(sem.activeCount("proj-raise")).toBe(0);
  });
});

describe("writer semaphore — project isolation", () => {
  it("different project keys never contend with each other", async () => {
    const sem = createWriterSemaphore();

    const releaseA = await sem.acquire("proj-x", 1);
    const releaseB = await sem.acquire("proj-y", 1);

    expect(sem.activeCount("proj-x")).toBe(1);
    expect(sem.activeCount("proj-y")).toBe(1);
    expect(sem.queueLength("proj-x")).toBe(0);
    expect(sem.queueLength("proj-y")).toBe(0);

    releaseA();
    releaseB();
  });
});

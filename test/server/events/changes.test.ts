/**
 * The change bus (specs/06-events.md): the choke point every write announces
 * itself through, and its transaction behaviour — a statement that rolls
 * back changed no record, so it must produce no event.
 */

import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  changeListenerCount,
  emitChange,
  onChange,
  transaction,
} from "../../../src/server/events/changes.js";
import type { ChangeEvent } from "../../../src/shared/events.js";

let db: Database.Database;

beforeEach(() => {
  db = new Database(":memory:");
  db.exec("CREATE TABLE t (id TEXT PRIMARY KEY)");
});

afterEach(() => {
  db.close();
});

function taskEvent(id: string): ChangeEvent {
  return { type: "task", id, projectId: "p1", change: "updated" };
}

function collect(database: Database.Database): { events: ChangeEvent[]; stop: () => void } {
  const events: ChangeEvent[] = [];
  const stop = onChange(database, (event) => events.push(event));
  return { events, stop };
}

describe("subscription", () => {
  it("delivers an event to every listener and stops on unsubscribe", () => {
    const one = collect(db);
    const two = collect(db);

    emitChange(db, taskEvent("a"));
    one.stop();
    emitChange(db, taskEvent("b"));

    expect(one.events.map((e) => e.id)).toEqual(["a"]);
    expect(two.events.map((e) => e.id)).toEqual(["a", "b"]);
    two.stop();
    expect(changeListenerCount(db)).toBe(0);
  });

  it("keeps the buses of two databases apart", () => {
    const other = new Database(":memory:");
    try {
      const here = collect(db);
      const there = collect(other);

      emitChange(db, taskEvent("a"));

      expect(here.events).toHaveLength(1);
      expect(there.events).toHaveLength(0);
      here.stop();
      there.stop();
    } finally {
      other.close();
    }
  });
});

describe("transactions", () => {
  it("holds events until the transaction commits, then releases them in order", () => {
    const seen = collect(db);
    let insideCount = -1;

    const write = transaction(db, () => {
      db.prepare("INSERT INTO t (id) VALUES ('a')").run();
      emitChange(db, taskEvent("a"));
      emitChange(db, taskEvent("b"));
      insideCount = seen.events.length;
    });
    write();

    expect(insideCount).toBe(0);
    expect(seen.events.map((e) => e.id)).toEqual(["a", "b"]);
    seen.stop();
  });

  it("emits nothing for a transaction that rolled back", () => {
    const seen = collect(db);

    const write = transaction(db, () => {
      db.prepare("INSERT INTO t (id) VALUES ('a')").run();
      emitChange(db, taskEvent("a"));
      throw new Error("no");
    });

    expect(() => write()).toThrow("no");
    expect(seen.events).toEqual([]);
    expect(db.prepare("SELECT COUNT(*) AS n FROM t").get()).toEqual({ n: 0 });
    seen.stop();
  });

  it("drops only the events of the nested savepoint that failed", () => {
    const seen = collect(db);

    const outer = transaction(db, () => {
      const first = transaction(db, () => {
        emitChange(db, taskEvent("kept"));
      });
      const second = transaction(db, () => {
        emitChange(db, taskEvent("rolled-back"));
        throw new Error("nope");
      });

      first();
      expect(() => second()).toThrow("nope");
    });
    outer();

    expect(seen.events.map((e) => e.id)).toEqual(["kept"]);
    seen.stop();
  });

  it("emits immediately outside a transaction", () => {
    const seen = collect(db);
    emitChange(db, taskEvent("a"));
    expect(seen.events).toHaveLength(1);
    seen.stop();
  });

  it("survives a listener that unsubscribes itself while it runs", () => {
    const seen: string[] = [];
    const stop = onChange(db, (event) => {
      seen.push(event.id);
      stop();
    });
    const other = collect(db);

    emitChange(db, taskEvent("a"));
    emitChange(db, taskEvent("b"));

    expect(seen).toEqual(["a"]);
    expect(other.events).toHaveLength(2);
    other.stop();
  });
});

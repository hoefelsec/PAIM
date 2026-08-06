import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase } from "../../../src/server/db/index.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "paim-db-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("openDatabase", () => {
  it("creates the parent directory if it doesn't exist yet", () => {
    const dbPath = join(dir, "nested", "sub", "paim.db");
    expect(existsSync(join(dir, "nested"))).toBe(false);

    const db = openDatabase(dbPath);

    expect(existsSync(dbPath)).toBe(true);
    db.close();
  });

  it("enables WAL journal mode", () => {
    const db = openDatabase(join(dir, "paim.db"));

    expect(db.pragma("journal_mode", { simple: true })).toBe("wal");

    db.close();
  });

  it("enables foreign key enforcement", () => {
    const db = openDatabase(join(dir, "paim.db"));

    expect(db.pragma("foreign_keys", { simple: true })).toBe(1);

    db.close();
  });

  it("applies migration 001, creating the migrations table", () => {
    const db = openDatabase(join(dir, "paim.db"));

    const row = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'migrations'")
      .get();
    expect(row).toEqual({ name: "migrations" });

    const applied = db.prepare("SELECT name FROM migrations").all() as Array<{ name: string }>;
    expect(applied).toEqual([{ name: "001_create_migrations_table.sql" }]);

    db.close();
  });

  it("is safe to open the same file twice in a row (idempotent bootstrap)", () => {
    const dbPath = join(dir, "paim.db");

    const db1 = openDatabase(dbPath);
    db1.close();

    const db2 = openDatabase(dbPath);
    const applied = db2.prepare("SELECT COUNT(*) as n FROM migrations").get() as { n: number };
    expect(applied.n).toBe(1);
    db2.close();
  });
});

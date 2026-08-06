import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadMigrationFiles, runMigrations } from "../../../src/server/db/migrate.js";
import { ApiError } from "../../../src/server/errors.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "paim-migrations-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function writeMigration(fileName: string, sql: string): void {
  writeFileSync(join(dir, fileName), sql, "utf-8");
}

describe("loadMigrationFiles", () => {
  it("returns files sorted by their numeric prefix", () => {
    writeMigration("002_second.sql", "SELECT 1;");
    writeMigration("001_first.sql", "SELECT 1;");

    const files = loadMigrationFiles(dir);

    expect(files.map((f) => f.name)).toEqual(["001_first.sql", "002_second.sql"]);
  });

  it("aborts on a numbering gap", () => {
    writeMigration("001_first.sql", "SELECT 1;");
    writeMigration("003_third.sql", "SELECT 1;");

    expect(() => loadMigrationFiles(dir)).toThrow(ApiError);
    try {
      loadMigrationFiles(dir);
      expect.fail("expected loadMigrationFiles to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).code).toBe("MIGRATION_GAP");
    }
  });

  it("rejects files that don't follow the NNN_name.sql convention", () => {
    writeMigration("first.sql", "SELECT 1;");

    expect(() => loadMigrationFiles(dir)).toThrow(ApiError);
  });
});

describe("runMigrations", () => {
  it("applies pending migrations in order and records them", () => {
    writeMigration(
      "001_create_migrations_table.sql",
      "CREATE TABLE IF NOT EXISTS migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, appliedAt TEXT NOT NULL);",
    );
    writeMigration("002_create_widgets.sql", "CREATE TABLE widgets (id INTEGER PRIMARY KEY, label TEXT);");

    const db = new Database(":memory:");
    const applied = runMigrations(db, dir);

    expect(applied.map((f) => f.name)).toEqual(["001_create_migrations_table.sql", "002_create_widgets.sql"]);

    const rows = db.prepare("SELECT name FROM migrations ORDER BY id").all() as Array<{ name: string }>;
    expect(rows.map((r) => r.name)).toEqual(["001_create_migrations_table.sql", "002_create_widgets.sql"]);

    // The widgets table really exists and is usable.
    db.prepare("INSERT INTO widgets (label) VALUES (?)").run("gizmo");
    expect(db.prepare("SELECT label FROM widgets").get()).toEqual({ label: "gizmo" });

    db.close();
  });

  it("is idempotent: re-running against an already-migrated db applies nothing new", () => {
    writeMigration(
      "001_create_migrations_table.sql",
      "CREATE TABLE IF NOT EXISTS migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, appliedAt TEXT NOT NULL);",
    );
    writeMigration("002_create_widgets.sql", "CREATE TABLE widgets (id INTEGER PRIMARY KEY, label TEXT);");

    const db = new Database(":memory:");

    const firstRun = runMigrations(db, dir);
    expect(firstRun).toHaveLength(2);

    const secondRun = runMigrations(db, dir);
    expect(secondRun).toHaveLength(0);

    const rows = db.prepare("SELECT COUNT(*) as n FROM migrations").get() as { n: number };
    expect(rows.n).toBe(2);

    db.close();
  });

  it("is idempotent across process restarts (a fresh db handle on the same file)", () => {
    writeMigration(
      "001_create_migrations_table.sql",
      "CREATE TABLE IF NOT EXISTS migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, appliedAt TEXT NOT NULL);",
    );

    const filePath = join(dir, "restart.db");
    const db1 = new Database(filePath);
    expect(runMigrations(db1, dir)).toHaveLength(1);
    db1.close();

    const db2 = new Database(filePath);
    expect(runMigrations(db2, dir)).toHaveLength(0);
    const rows = db2.prepare("SELECT COUNT(*) as n FROM migrations").get() as { n: number };
    expect(rows.n).toBe(1);
    db2.close();
  });

  it("aborts on a numbering gap without applying any migration", () => {
    writeMigration(
      "001_create_migrations_table.sql",
      "CREATE TABLE IF NOT EXISTS migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, appliedAt TEXT NOT NULL);",
    );
    writeMigration("003_create_widgets.sql", "CREATE TABLE widgets (id INTEGER PRIMARY KEY);");

    const db = new Database(":memory:");

    expect(() => runMigrations(db, dir)).toThrow(ApiError);

    // Nothing should have been applied: the migrations table shouldn't
    // even exist yet.
    const row = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'migrations'")
      .get();
    expect(row).toBeUndefined();

    db.close();
  });
});

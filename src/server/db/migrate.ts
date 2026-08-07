import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type Database from "better-sqlite3";
import { ApiError } from "../errors.js";

/**
 * A single numbered migration file discovered on disk.
 */
export interface MigrationFile {
  number: number;
  name: string;
  path: string;
}

const MIGRATION_FILE_RE = /^(\d+)_.+\.sql$/;

/**
 * Reads and validates the migrations directory: every `.sql` file must be
 * named `NNN_description.sql`, and the numbers must form a gap-free
 * sequence starting at 1. Throws before returning anything if either rule
 * is broken, so a bad migrations directory never partially applies.
 */
export function loadMigrationFiles(dir: string): MigrationFile[] {
  const entries = readdirSync(dir).filter((f) => f.endsWith(".sql"));
  const files: MigrationFile[] = [];

  for (const entry of entries) {
    const match = MIGRATION_FILE_RE.exec(entry);
    if (!match || !match[1]) {
      throw new ApiError(
        "MIGRATION_INVALID_NAME",
        500,
        { file: entry },
        `Migration file "${entry}" does not match the "NNN_name.sql" naming convention`,
      );
    }
    files.push({ number: Number(match[1]), name: entry, path: join(dir, entry) });
  }

  files.sort((a, b) => a.number - b.number);

  for (let i = 0; i < files.length; i++) {
    const file = files[i]!;
    const expected = i + 1;
    if (file.number !== expected) {
      throw new ApiError(
        "MIGRATION_GAP",
        500,
        { expected, found: file.number, file: file.name },
        `Migration numbering gap: expected migration ${expected} but found ` +
          `${file.number} ("${file.name}"). Migrations must be numbered sequentially with no gaps.`,
      );
    }
  }

  return files;
}

function migrationsTableExists(db: Database.Database): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'migrations'")
    .get();
  return row !== undefined;
}

function alreadyApplied(db: Database.Database): Set<string> {
  if (!migrationsTableExists(db)) return new Set();
  const rows = db.prepare("SELECT name FROM migrations").all() as Array<{ name: string }>;
  return new Set(rows.map((r) => r.name));
}

/**
 * Applies every pending migration in `dir` to `db`, in numeric order, each
 * inside its own transaction that also records the migration's name in the
 * `migrations` table (created by migration 001). Safe to call repeatedly:
 * migrations already recorded are skipped. Throws (via `loadMigrationFiles`)
 * without applying anything if the directory has a naming or numbering
 * problem.
 *
 * Returns the migrations that were newly applied by this call.
 */
export function runMigrations(db: Database.Database, dir: string): MigrationFile[] {
  const files = loadMigrationFiles(dir);
  const applied = alreadyApplied(db);
  const appliedNow: MigrationFile[] = [];

  for (const file of files) {
    if (applied.has(file.name)) continue;

    const sql = readFileSync(file.path, "utf-8");
    const applyOne = db.transaction(() => {
      db.exec(sql);
      db.prepare("INSERT INTO migrations (name, appliedAt) VALUES (?, ?)").run(
        file.name,
        new Date().toISOString(),
      );
    });
    applyOne();
    appliedNow.push(file);
  }

  return appliedNow;
}

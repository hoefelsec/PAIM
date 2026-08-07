import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { runMigrations } from "./migrate.js";

/** `data/paim.db` at the repo root — see specs/00-foundation.md. */
export const DEFAULT_DB_PATH = fileURLToPath(new URL("../../../data/paim.db", import.meta.url));

const MIGRATIONS_DIR = fileURLToPath(new URL("./migrations", import.meta.url));

/**
 * Opens (creating if needed) the SQLite database at `path`, sets the
 * pragmas that make it survive a hard kill, and applies any pending
 * migrations. Creates the parent directory (`data/` by default) if it
 * doesn't exist yet.
 */
export function openDatabase(path: string = DEFAULT_DB_PATH): Database.Database {
  mkdirSync(dirname(path), { recursive: true });

  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  runMigrations(db, MIGRATIONS_DIR);

  return db;
}

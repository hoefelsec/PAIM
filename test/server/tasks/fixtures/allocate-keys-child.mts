// Fixture process for the "no duplicate keys under real cross-connection
// concurrency" test. Opens the given database from a *second* connection
// (run via `tsx`, so it can import the real `nextTaskKey` implementation
// rather than a reimplementation that could silently drift from it) and
// calls `nextTaskKey` `count` times for `projectId`, deliberately
// unwrapped (no `db.transaction()` around each call) — exactly the
// reviewer's repro for the UPSERT-then-SELECT race, and exactly what
// exercises `nextTaskKey`'s own atomicity rather than a caller's
// transaction masking it. Prints the allocated keys as a JSON array on
// stdout when done, so the parent test can check the combined set (this
// process's keys plus its own) for duplicates.
import Database from "better-sqlite3";
import { nextTaskKey } from "../../../../src/server/tasks/keys.js";

const [, , dbPath, projectId, countArg] = process.argv;
const count = Number(countArg);

const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.pragma("busy_timeout = 5000");

const types: Array<string | undefined> = ["feature", "bug", "chore", "spike", "debt", undefined];

const keys: string[] = [];
for (let i = 0; i < count; i++) {
  const type = types[i % types.length];
  keys.push(nextTaskKey(db, projectId as string, type));
}

db.close();
process.stdout.write(JSON.stringify(keys));

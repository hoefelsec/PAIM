// Fixture process for the "kill -9 mid-transaction" crash test. Opens the
// given database in WAL mode, opens a transaction, writes a row, then signals
// readiness and idles forever so the parent test can SIGKILL it while the
// transaction is still open (uncommitted).
import Database from "better-sqlite3";

const dbPath = process.argv[2];

const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec("CREATE TABLE IF NOT EXISTS crash_test (id INTEGER PRIMARY KEY, value TEXT NOT NULL)");
db.exec("BEGIN IMMEDIATE");
db.prepare("INSERT INTO crash_test (value) VALUES (?)").run("mid-transaction");

// Tell the parent it's safe to send SIGKILL now.
process.stdout.write("READY\n");

// Keep the event loop alive; the parent kills us, we never exit cleanly.
setInterval(() => {}, 1000);

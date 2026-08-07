-- Per-project task key counters (docs/02 "Task keys", T11).
--
-- The key is the type prefix plus a counter, but the counter is one
-- sequence for the *whole project* — keys never collide across prefixes
-- even though they share a running count. One row per project; the
-- counter is incremented inside the same transaction as the task insert
-- it names, so a rolled-back insert also rolls back the increment.
-- ON DELETE CASCADE: deleting a project (src/server/routes/projects.ts)
-- must not leave an orphaned counter row behind, or fail with a raw FK
-- constraint error.
CREATE TABLE task_counters (
  projectId TEXT    PRIMARY KEY REFERENCES projects (id) ON DELETE CASCADE,
  counter   INTEGER NOT NULL DEFAULT 0
);

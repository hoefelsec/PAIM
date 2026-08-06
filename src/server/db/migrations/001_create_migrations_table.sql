-- Tracks which migrations have been applied. The runner also consults this
-- table (via sqlite_master) to decide what is pending, so this statement
-- must stay idempotent.
CREATE TABLE IF NOT EXISTS migrations (
  id        INTEGER PRIMARY KEY,
  name      TEXT NOT NULL UNIQUE,
  appliedAt TEXT NOT NULL
);

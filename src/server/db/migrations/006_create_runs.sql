-- Runs and their operations. Every field of docs/09-ai-run.md "Records".
--
-- The columns a reader queries on (the task, the project, the parent run,
-- the status, the timestamps) are real columns; `restorePoint`, whose shape
-- depends on the capture method and which nothing filters on, is one JSON
-- text column, following the convention of 002_create_projects.sql and
-- 003_create_tasks.sql. `usage` is three columns rather than JSON because
-- the caps work sums them across runs (docs/11 "Caps"); the record presents
-- them as one nested object.
--
-- `risk` is deliberately absent from `operations`: docs/09 derives it from
-- `kind`, so storing it would let a row disagree with itself. It is
-- computed on read — see riskForKind() in src/shared/runs.ts.
--
-- Both foreign keys cascade. A hard-deleted task and a force-deleted
-- project remove their rows outright (src/server/db/tasks.ts,
-- src/server/db/projects.ts); the runs of a task that no longer exists
-- belong to nobody, and a run row left behind would abort those deletes
-- with `foreign_keys = ON`.
CREATE TABLE runs (
  id            TEXT    PRIMARY KEY,
  taskId        TEXT    NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  projectId     TEXT    NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  -- single | orchestrated (docs/09 "Orchestration for an epic").
  kind          TEXT    NOT NULL DEFAULT 'single',
  -- Set on the children of an orchestrated run (docs/09).
  parentRunId   TEXT    REFERENCES runs (id) ON DELETE CASCADE,
  -- manual | schedule | orchestrator. `trigger` is a SQL keyword, so the
  -- column is quoted everywhere it appears (as `order` is on tasks).
  "trigger"     TEXT    NOT NULL DEFAULT 'manual',
  -- One of the nine statuses of docs/09 "Records".
  status        TEXT    NOT NULL DEFAULT 'queued',
  -- The capture of docs/09 "Restore"; null until the run captures one.
  restorePoint  TEXT,
  inputTokens   INTEGER NOT NULL DEFAULT 0,
  outputTokens  INTEGER NOT NULL DEFAULT 0,
  costUsd       REAL    NOT NULL DEFAULT 0,
  -- `service_stopped` for a run a stop of the process interrupted (docs/09
  -- "Service restart"); null on every run that ended on its own terms.
  failureReason TEXT,
  createdAt     TEXT    NOT NULL,
  startedAt     TEXT,
  endedAt       TEXT
);

-- The runs of one task, newest first, is the list endpoint; the activity
-- feed reads the runs of a project the same way (docs/06 "Activity").
CREATE INDEX runs_task_idx ON runs (taskId, createdAt);
CREATE INDEX runs_project_idx ON runs (projectId, createdAt);
CREATE INDEX runs_status_idx ON runs (status);
CREATE INDEX runs_parent_idx ON runs (parentRunId);

CREATE TABLE operations (
  id        TEXT    PRIMARY KEY,
  runId     TEXT    NOT NULL REFERENCES runs (id) ON DELETE CASCADE,
  -- The position in the run's log, assigned by the storage layer: two
  -- operations recorded in the same millisecond still read back in order.
  seq       INTEGER NOT NULL,
  -- read | glob | grep | write | edit | bash — the built-in tools.
  kind      TEXT    NOT NULL,
  summary   TEXT    NOT NULL DEFAULT '',
  -- proposed | approved | denied | running | done | failed.
  status    TEXT    NOT NULL DEFAULT 'proposed',
  -- write and edit.
  diff      TEXT,
  -- bash.
  stdout    TEXT,
  exitCode  INTEGER,
  createdAt TEXT    NOT NULL,
  updatedAt TEXT    NOT NULL
);

CREATE UNIQUE INDEX operations_run_seq_idx ON operations (runId, seq);

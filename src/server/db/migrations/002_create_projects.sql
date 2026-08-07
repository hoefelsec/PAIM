-- Projects. Every field of docs/02-data-model.md "Project" except `version`,
-- which is read from the workspace and never stored.
--
-- Structured values (statuses, fieldSchema, regressionTests, safety,
-- composeModel, modelRouting, allowedModels, usageCaps) are JSON text
-- columns. Booleans are 0/1 integers. Timestamps are ISO-8601 strings.
CREATE TABLE projects (
  id                 TEXT    PRIMARY KEY,
  slug               TEXT    NOT NULL UNIQUE,
  name               TEXT    NOT NULL,
  description        TEXT    NOT NULL DEFAULT '',
  icon               TEXT,
  color              TEXT,
  status             TEXT    NOT NULL DEFAULT 'active',
  type               TEXT    NOT NULL DEFAULT 'generic',
  workspacePath      TEXT,
  autoCommit         INTEGER NOT NULL DEFAULT 0,
  autoPush           INTEGER NOT NULL DEFAULT 0,
  statuses           TEXT    NOT NULL,
  fieldSchema        TEXT    NOT NULL DEFAULT '[]',
  testFramework      TEXT,
  regressionTests    TEXT    NOT NULL DEFAULT '[]',
  safety             TEXT    NOT NULL,
  composeModel       TEXT    NOT NULL,
  modelRouting       TEXT    NOT NULL,
  allowedModels      TEXT    NOT NULL DEFAULT '[]',
  usageCaps          TEXT    NOT NULL,
  -- docs/12 "Concurrency": one number, default 1.
  maxConcurrentRuns  INTEGER NOT NULL DEFAULT 1,
  -- docs/06 "The trash": the default is 30 days.
  trashRetentionDays INTEGER NOT NULL DEFAULT 30,
  createdAt          TEXT    NOT NULL,
  updatedAt          TEXT    NOT NULL,
  archivedAt         TEXT
);

-- The default list filters on status; the slug is the API's address.
CREATE INDEX projects_status_idx ON projects (status);

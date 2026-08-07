-- Tasks. Every field of docs/02-data-model.md "Task".
--
-- Core fields that the query surface filters and sorts on (docs/03 "List
-- query params") are real columns: key, projectId, title, status, priority,
-- size, kind, labels, assignee, parentId, order, deletedAt, and the
-- timestamps. Structured values that have no query surface of their own
-- (fields, dependsOn, questions, designOptions, tests, reviews, safety,
-- schedule) are JSON text columns, following the convention of
-- 002_create_projects.sql. Booleans are 0/1 integers.
--
-- `order` is a SQL keyword, so it is quoted everywhere it appears.
--
-- Key generation (the type-prefix counter) is T11's work; this migration
-- only gives the column a place to live. Epic invariants, status gates,
-- and staleness triggers are later specs' work; this migration only stores
-- the fields they read and write.
CREATE TABLE tasks (
  id                TEXT    PRIMARY KEY,
  key               TEXT    NOT NULL,
  projectId         TEXT    NOT NULL REFERENCES projects (id),
  title             TEXT    NOT NULL,
  description       TEXT    NOT NULL DEFAULT '',
  status            TEXT    NOT NULL,
  priority          TEXT    NOT NULL DEFAULT 'none',
  size              TEXT    NOT NULL,
  -- docs/02 "Epic": derived from `size === 'Epic'`, never written directly.
  kind              TEXT    NOT NULL DEFAULT 'task',
  labels            TEXT    NOT NULL DEFAULT '[]',
  assignee          TEXT,
  parentId          TEXT    REFERENCES tasks (id),
  "order"           REAL    NOT NULL DEFAULT 0,
  fields            TEXT    NOT NULL DEFAULT '{}',
  model             TEXT,
  effort            TEXT,
  -- null means the project's safety policy applies (docs/02).
  safety            TEXT,
  -- epics only; null on a plain task (docs/02).
  childManualReview INTEGER,
  schedule          TEXT,
  dependsOn         TEXT    NOT NULL DEFAULT '[]',
  questions         TEXT    NOT NULL DEFAULT '[]',
  designOptions     TEXT    NOT NULL DEFAULT '[]',
  tests             TEXT    NOT NULL DEFAULT '[]',
  reviews           TEXT    NOT NULL DEFAULT '[]',
  sourcePrompt      TEXT    NOT NULL DEFAULT '',
  evaluatedAt       TEXT,
  staleReason       TEXT,
  -- docs/06 "The trash": soft delete.
  deletedAt         TEXT,
  createdAt         TEXT    NOT NULL,
  updatedAt         TEXT    NOT NULL,
  closedAt          TEXT
);

-- Keys are permanent and per-project; the counter (T11) never collides
-- across prefixes, so the pair is unique.
CREATE UNIQUE INDEX tasks_project_key_idx ON tasks (projectId, key);

-- The query surface (specs/03-tasks.md) filters on all of these.
CREATE INDEX tasks_project_idx ON tasks (projectId);
CREATE INDEX tasks_status_idx ON tasks (status);
CREATE INDEX tasks_priority_idx ON tasks (priority);
CREATE INDEX tasks_parent_idx ON tasks (parentId);
CREATE INDEX tasks_assignee_idx ON tasks (assignee);
CREATE INDEX tasks_deleted_idx ON tasks (deletedAt);

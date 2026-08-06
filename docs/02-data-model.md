# 02 — Data model

## Project

A project holds tasks. The slug identifies the project in all API paths.

```
id             uuid
slug           "paim"      unique, in URLs, permanent after creation
name           "PAIM"      shown to the user, editable
description    text, markdown
icon           one emoji or one icon name
color          one of 8 identity colours (see 13)
status         active | archived
type           node | python | go | rust | generic
version        read from the workspace, not stored (see below)
workspacePath  absolute path, or null
autoCommit     boolean
autoPush       boolean
statuses       string[]            which statuses this project uses (see 04)
fieldSchema    FieldDef[]          custom fields (see 03)
testFramework  jest | vitest | pytest | go | cargo | custom   (see 12)
regressionTests TestDef[]          tests that every task must pass (see 04)
safety         SafetyPolicy        permissions for runs (see 10)
composeModel   { model, effort }   the model that writes tasks (see 08)
modelRouting   RoutingConfig       the run model and effort per task (see 11)
allowedModels  string[]            models this project may use, for both of the above
usageCaps      { fiveHour, weekly, fable }   token budgets (see 11)
maxConcurrentRuns  integer, default 1   agents that write to this workspace (see 10)
trashRetentionDays integer, default 30  (see 06)
createdAt / updatedAt / archivedAt
```

The service reads `version` from the workspace and caches the value. It reads
the source again when the modification time of the source file changes. The
source depends on `type`:

| Type | Source of the version |
|---|---|
| `node` | `package.json` |
| `python` | `pyproject.toml` |
| `go` | `go.mod` |
| `rust` | `Cargo.toml` |
| `generic` | `git describe` |

If the service cannot find a version, it shows no version.

An archived project stays readable through the API. The interface hides it from
the default lists.

## Task

```
id          uuid
key         "FEAT-14"             the type prefix plus a counter (see "Task keys")
projectId   uuid
title       string                required
description text, markdown
status      string                one of the project's statuses (see 04)
priority    none | low | medium | high | urgent
size        XS | S | M | L | XL | Epic
kind        task | epic           derived from size; see "Epic" below
labels      string[]
assignee    string                free text; the service has no user table
parentId    uuid, or null         the epic that contains this task
order       float                 manual sort position
fields      { key: value }        values for the custom fields (see 03)
model       string, or null       null means the service selects it (see 11)
effort      low | medium | high | xhigh | max, or null
safety      SafetyPolicy, or null null means the project's policy applies
childManualReview  boolean, or null   epics only; children pass manual_review (see 09)
schedule    Schedule, or null     see 09
dependsOn   uuid[]                see 05
questions   Question[]            see 04
designOptions DesignOption[]      see 04
tests       TestRun[]             see 04
reviews     Review[]              see 04
sourcePrompt  string              the original text from the user (see 05)
evaluatedAt   timestamp
staleReason   time | dependency | answers | project_change | null
createdAt / updatedAt / closedAt
```

`title` is the only required field.

## Task keys

The key is the type prefix plus a counter.

- The prefix comes from the task's `type` value at creation. `feature` gives
  `FEAT`. `bug` gives `BUG`. See [03 — Custom fields](03-custom-fields.md).
- A task without a `type` value uses the prefix `TASK`.
- The counter is one sequence for the whole project. Keys do not collide
  across prefixes.
- The key is permanent. A later change of `type` does not change the key.

## Size

`size` has six values: `XS`, `S`, `M`, `L`, `XL`, and `Epic`.

`size` is a core field. It cannot be a custom field, because the value `Epic`
changes the type of the record. The table, the orchestrator, and the run
pipeline all need this field.

## Epic

An epic is a task. It is not a separate type of record.

- `kind` is `epic` if and only if `size` is `Epic`.
- The service derives `kind`. The user cannot set `kind` directly.
- Child tasks point to the epic with `parentId`.

This rule prevents two errors: an epic with the size `XL`, and a task with the
size `Epic` that is not an epic.

To make a task an epic, set its size to `Epic`. The service refuses to change
the size away from `Epic` while the epic has children.

### Rules for epics

- **One level.** A child task cannot be an epic.
- **Status.** The user sets the status of an epic. The service makes one
  automatic change: when all children are resolved, the epic run ends and the
  epic moves to the next enabled status after `executing`, for example
  `testing`. The epic then passes its own gates in the normal way. If a child
  re-opens, the epic returns to `executing`.
- **A cancelled child is resolved.** A cancelled child does not block the epic. A
  cancellation is a decision, not unfinished work.
- **Progress.** The epic reports the count of resolved children, for example
  `3/7 done`. When children are cancelled, it reports both counts, for example
  `5/7 done, 2 cancelled`. This count is separate from the status.
- **An epic with no children is valid.** An epic often exists before its
  children. The progress shows `0/0`. The service does **not** move an empty
  epic to `done`. The condition "all children are resolved" is true for zero
  children, and that result is wrong.
- **Children are normal tasks.** They appear in the table. They match filters.
  The user can run one child alone. See [09 — AI run](09-ai-run.md).
- **Children skip `open_questions` and `design`.** The epic carries the
  questions and the design decisions for all of its children. A child task
  enters the pipeline at `ready`. See
  [04 — Status pipeline](04-status-pipeline.md).

## Comment

Planned for release 1.5. See [14 — Scope and operations](14-scope-and-operations.md).

```
id / taskId / body (markdown) / createdAt
```

## Writes have no author

The service records the time of a change. It does not record the identity of the
writer.

- Tasks have `createdAt`, `updatedAt`, and `closedAt`. They have no author field.
- `assignee` is not an author. The user sets `assignee`. The service does not
  derive it from the source of a request.
- The API gives the same result for a request from the interface and a request
  from a script.

The service has one principal. An author field would have no reader.

Run records are different. A run records the operations, the differences in
files, and the output. This is a record of events, not a record of identity. See
[09 — AI run](09-ai-run.md).

## Related documents

- [03 — Custom fields](03-custom-fields.md)
- [04 — Status pipeline](04-status-pipeline.md)
- [05 — Dependencies](05-dependencies.md)

# 12 — Project settings

Route: `/p/:project/settings`. The left rail holds the list of sections.

| Section | Content |
|---|---|
| General | Project type, workspace path, documents folder, icon, colour |
| Git | Automatic commit, automatic push, message template |
| Pipeline | Which statuses this project uses |
| Tests | The regression test suite |
| Concurrency | Runs at one time, epic worker agents |
| Safety | The deny list, the mode, the ask list |
| Custom fields | The field editor |
| Models and routing | Permitted models, the routing map |
| Usage limits | The three caps |
| Schedules | All scheduled tasks in this project |
| Danger zone | The trash, archive, delete, reset the schema |

## General

**Project type** has five values: `node`, `python`, `go`, `rust`, `generic`.

The type does two things:

1. It tells the service where to read the version. See
   [02 — Data model](02-data-model.md).
2. It gives a first ask list for that ecosystem.

**Workspace path** is an absolute path. Runs and documents use only this
directory. A project without a workspace path cannot run tasks and cannot show
documents.

**Documents folder** is `docs/` inside the workspace path. The settings screen
reports whether the folder exists and how many files it holds.

## Git

**Automatic commit** commits the changes of a successful run. The commit is
local. The action is reversible.

**Message template** builds the commit message, for example
`task({key}): {title}`.

**Automatic push** sends the commits to the remote.

Automatic push has a warning style in the interface. The two actions are
different in kind:

| Action | Effect |
|---|---|
| Automatic commit | Local. Reversible. Nothing leaves the machine. |
| Automatic push | The commits go to the remote. Other people and CI systems see them. The action is difficult to reverse. |

Automatic push is off by default. The user cannot enable it without automatic
commit.

## Pipeline

The project selects which statuses it uses. The order is fixed. See
[04 — Status pipeline](04-status-pipeline.md).

`open_questions`, `design`, `ready`, `executing`, and `done` are required. The
interface marks them. A task skips `open_questions` and `design` when it does
not need them. See [04 — Status pipeline](04-status-pipeline.md).

## Tests

The regression suite runs for every task that enters `testing`.

**Test framework** is a project setting. The tool manages the project, so it
knows the framework.

```
testFramework   jest | vitest | pytest | go | cargo | custom
```

The framework controls how the service reads the results:

- A known framework: the service reads the structured report. The tests table
  shows one row for each test, with a name and a duration.
- `custom`: the service reads the exit code and the raw output. The tests table
  shows one row for each `TestDef`.

Release 1 parses the structured report of `vitest` only. The other known
frameworks use the `custom` path until release 1.5. See
[14 — Scope and operations](14-scope-and-operations.md).

```
TestDef {
  id
  name        "api/cursor-pagination"
  command     "npm test -- tasks/pagination"
  timeoutMs
}
```

Claude writes the task-specific tests during a run. The user can edit them. See
[04 — Status pipeline](04-status-pipeline.md).

## Concurrency

```
maxConcurrentRuns    1
```

One number, default 1. It counts all agents that write to this workspace,
including the child agents of an epic. The epic orchestrator does not count. It
is a scheduler and does not write. See
[10 — Execution safety](10-execution-safety.md).

The settings text states the reason: every agent writes to the same filesystem.

## Safety

The deny list, then the three modes, then the ask list. See
[10 — Execution safety](10-execution-safety.md).

The deny list appears above the three modes, because it is not one of them. It
applies in all modes. The text states that a task cannot override it.

## Custom fields

The field editor. Each row has two switches: **Column** and **Facet**. See
[03 — Custom fields](03-custom-fields.md).

Core fields appear first. They have a different style and the user cannot remove
them.

## Models and routing

`allowedModels` limits the models. `modelRouting` maps a field to a model and an
effort. See [11 — Models and limits](11-models-and-limits.md).

## Usage limits

Three token budgets, one for each window. See
[11 — Models and limits](11-models-and-limits.md).

The interface hides the Fable cap when `allowedModels` excludes
`claude-fable-5`.

## Danger zone

The section shows the count of tasks in the trash. A deleted task stays in the
trash for `trashRetentionDays`. The default is 30 days. After that period the
service deletes the task permanently.

The section also holds Archive project, Delete project, and Reset schema.

---

# Project documents

A **Docs** control is in the sidebar, below the workspace switcher and above the
search box. It opens the documents of the project.

The documents are **the contents of `docs/` inside the workspace path**.

The service does not import or copy the files. The files on disk are the wiki.
The user edits them in an editor and commits them with the code. The service
renders the current content.

A workspace without a `docs/` folder shows the control in a disabled state with
the text "No docs/ folder in this workspace".

## Routes

```
/p/:project/docs            The tree, and docs/README.md if it exists.
/p/:project/docs/*path      One rendered file.
```

## Rules

- The service renders Markdown. It supports tables, task lists, and fenced code
  blocks with syntax colour.
- The service renders images: `png`, `jpg`, `gif`, `webp`, `svg`.
- Other file types appear in the tree. The service offers them as a download.
- **The rail shows the file tree** in place of the filter facets.
- Relative links resolve inside the tree. `[the API](./api.md)` navigates inside
  the application. `![](./diagram.png)` renders in the page.
- The service renders Markdown with the design tokens, not with browser
  defaults. See [13 — Design language](13-design-language.md).
- **The service confines every path** to `workspacePath/docs/`. It uses the same
  check as a run. See [10 — Execution safety](10-execution-safety.md).
- The service serves documents as read-only. It never writes into `docs/`.

## Related documents

- [03 — Custom fields](03-custom-fields.md)
- [04 — Status pipeline](04-status-pipeline.md)
- [10 — Execution safety](10-execution-safety.md)

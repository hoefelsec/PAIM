# 07 — User interface

## Routes

```
/                          The project grid. All active projects.
/p/:project                The task table for one workspace.
/p/:project?status=…       Filter state. It is in the URL and it is temporary.
/p/:project/v/:view        A saved view.
/p/:project/new            The AI composer.
/p/:project/t/:key         The task view. Default tab: Overview.
/p/:project/t/:key/run     The task view. Tab: Run.
/p/:project/docs           The project documents.
/p/:project/docs/*path     One rendered document or image.
/p/:project/settings       Project settings.
/search                    Search across workspaces.
```

The root path shows the project grid. It does not redirect to the last
workspace. One URL always answers "which projects exist?".

## One workspace at a time

A project is a workspace. The user selects one project. That selection scopes
the whole interface: the table, the filters, and the keyboard shortcuts.

The user changes the workspace from the switcher in the top-left corner. The
switcher shows the project icon, the project name, and the count of open tasks.

The switcher menu contains:

- The active projects, with the count of open tasks for each.
- One row for the archived projects.
- Project settings, New project, and All projects.

## Layout

```
┌──────────────┬──────────────────────────────────────────────┐
│ ◈ Task Mgr ⌄ │ v0.4.2 · 28 · 17 open   5h ▓▓▒ Wk ▓▓▓▒ F ▓  │ stats band
│   17 open    ├──────────────────────────────────────────────┤
├──────────────┤ Open work ⌄ │ 8 of 28 · Sort · Group · Save  │ toolbar
│ ▤ Docs    12 ├──────────────────────────────────────────────┤
├──────────────┤ KEY  TITLE            PRIO TYPE DIFF SIZE     │
│ ⌕ Search   / │ ▾ Executing 3                                 │
│ ▾ STATUS     │ TM-4  Table view…      ▮▮  ☆   ●●●○  M        │
│   ☑ Ready  5 │ TM-3  Field schema…    ▮▮  ☆   ●●●●  L        │
│ ▾ TYPE       │                                               │
│ Clear all  2 │                                               │
├──────────────┴──────────────────────────────────────────────┤
│ ▴ Activity   4 running · 1 needs you · 1 held · 2 queued    │ dock
└─────────────────────────────────────────────────────────────┘
```

## The left rail

The rail holds different content on different screens. The rail always answers
"what can I navigate inside this screen?".

| Screen | Content of the rail |
|---|---|
| Task table | Filter facets |
| Project documents | The file tree of `docs/` |
| Project settings | The list of settings sections |
| Composer, task view | A link back to the task list |
| Project grid | No rail. The grid uses the full width. |

### Filter facets

The service builds the facets from the project's schema. Core facets are
`status`, `priority`, `size`, `labels`, and `assignee`. Custom facets are the
`select` fields with `showAsFacet`. See
[03 — Custom fields](03-custom-fields.md).

Each facet head shows its source: `core`, `pipeline`, or `schema`.

### The rule for filters and presentation

- The rail controls **which tasks are in the set**.
- The toolbar controls **how the set appears**.

No control appears in both places.

## The table

The table is the only view. There is no board and no list view.

- Rows are 33 pixels high. There is one density.
- The table is the default view because field sets differ per project. A table
  shows custom values side by side.

### Columns

`Key`, `Title`, `Prio`, `Type`, `Diff`, `Size`, `Updated`. Custom fields with
`showInTable` add columns.

### Icons instead of text

`priority`, `type`, and `difficulty` are icons. The name appears when the
pointer is over the icon. The column head names the dimension, so the row does
not repeat it.

Two scales use different shapes:

- **Priority** grows in bar **height**.
- **Difficulty** fills in dot **count**. Empty steps are rings. Filled steps are
  discs.

**Type** is not a scale. Each value has a different silhouette.

### Epics in the table

An epic row has a triangle control and the count `3/7 done`. The children appear
as indented rows under the epic. They use the same columns.

To expand an epic changes the view state. It is not navigation.

## The stats band

The band is at the top of the main pane. It appears on all workspace screens.

- **Left:** the project version, the total count of tasks, the count of open
  tasks, and the count of closed tasks.
- **Right:** three usage meters. Each meter has a cap marker. See
  [11 — Models and limits](11-models-and-limits.md).

The band is one row of about 44 pixels. It expands to show the reset times and
to move the cap markers.

The meters are the only warning. The service shows no banner and no toast when
a cap is reached.

## Saved views

Filters do not persist. The user changes the rail, changes workspace, and
returns. The rail is then empty.

Filter state lives in the URL query string. Therefore a filtered list is a link
that the user can share, and the browser Back control works.

To keep a filter set, use **Save view** in the toolbar, beside Sort and Group.

```
SavedView {
  id, projectId, name, order
  filters   { status: [], priority: [], fields: { … } }
  sort      "-updatedAt"
  groupBy   "status"
  columns   string[]
}
```

- A saved view holds the filters, the sort, the group, and the columns.
- The view selector is at the left end of the toolbar.
- When the live state differs from the selected view, the view name shows a dot
  and the Save view control changes to the accent colour.

## Sort

Sort has the normal options and one AI option.

**Suggested** orders the tasks by their effect on each other. Work that changes
a later task comes first. This order prevents duplicate work.

- The order is a snapshot. The service computes it when the user asks.
- When the task set changes, the sort control shows that the order is old. The
  service does not reorder the table without a command.
- Each position has one line of reason. The user can read why a task is at that
  position.
- Suggested order sorts. It does not filter and it does not hide.

## The task view

The task view is a full screen with tabs. It is not a panel.

```
Overview · Questions · Design · Run · Tests · Review
```

The tab order is the pipeline order. Therefore the tab row also shows progress.

A tab appears only when the project's pipeline includes that stage. A project
without `testing` has no Tests tab.

The right column holds the properties: status, priority, size, type,
difficulty, custom fields, model, dependencies, and schedule.

The **Review** tab has three sub-tabs:

| Sub-tab | Content |
|---|---|
| AI review | The verdict, the reason, and the views that Claude opened. |
| Code review | The difference of all files that the task changed, across all runs. |
| Manual review | The summary, the list of checks, and the entry point. |

Code review is separate from the Run tab. The Run tab answers "what happened, in
order". Code review answers "what is the state of the files now".

## Selection and bulk actions

The user selects rows with the checkbox in the first column. A bar appears above
the dock. The bar disappears on `Esc`.

The bar has three actions:

| Action | Result |
|---|---|
| Delete | A confirmation shows the count. The tasks go to the trash. |
| Run *n* separately | The service queues each task as an independent run. It does not create an epic. |
| Merge into epic | Claude drafts an epic for the selected tasks. See [08](08-ai-compose.md). |

The label says "separately" because to run three tasks is not the same as to
create an epic.

## The activity dock

The dock is at the bottom of the window. It uses the full width, under the
sidebar. The dock shows **all runs in all projects**.

Each row shows: the project colour, the task key, the title, the model and
effort, the progress, the elapsed time, and two controls.

### Progress

- After the agent declares a plan, the bar shows completed operations of planned
  operations, for example `4/6`.
- Before the agent declares a plan, the row shows an indeterminate animation and
  the word `planning`. The service does not show a percentage that it cannot
  compute.

### Controls

- **Pause** stops the run at the end of the current operation. It never stops in
  the middle of an operation. A paused run keeps its position and its context.
- **Cancel** opens a confirmation. The confirmation lists the files that the run
  already changed. It offers three actions: *Keep running*, *Cancel and keep the
  changes*, and *Cancel and restore*. See [09 — AI run](09-ai-run.md).

### Orchestrated runs

An epic run appears as one row. The child runs appear as indented rows under it.

The dock collapses to one row of about 30 pixels.

## Editing

- **Edit in place.** Click a value, change it, and click outside to save. There
  are no modal forms and no Save control.
- **Optimistic update.** The interface shows the change at once. It reconciles
  with the response. A rejected write makes the row flash and then returns to
  the previous value.
- **Server-Sent Events** keep the interface current. Other programs write to the
  same store, so the interface must not show old data.

## Keyboard

| Key | Action |
|---|---|
| `⌘K` | Command palette |
| `⌘P` | Change workspace |
| `C` | New task |
| `/` | Search |
| `J` / `K` | Move between rows |
| `E` | Edit |
| `R` | Run the task |
| `⌘Enter` | Submit |
| `Esc` | Close, or clear the selection |

## Related documents

- [13 — Design language](13-design-language.md)
- [09 — AI run](09-ai-run.md)
- [12 — Project settings](12-project-settings.md)

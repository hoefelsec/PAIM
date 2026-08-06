# 16 — UI: dock, settings, project docs

**Builds on:** 13, 14 (dock also consumes 09/10 streams).
**Source docs:** [07](../docs/07-user-interface.md), [12](../docs/12-project-settings.md), [13](../docs/13-design-language.md).

## Goal

The three remaining surfaces: the global activity dock, the settings
screens, and the rendered project documentation.

## Scope

- **Activity dock**: full window width under the sidebar, all runs in all
  projects, collapsed ~30 px row with tallies (running / needs you / held /
  queued). Rows: project colour tile, key, title, model · effort (epic rows
  show the scheduler, no model), progress (`done/planned` after a plan;
  indeterminate `planning` before), elapsed, Pause + Cancel. Child runs
  indent under the parent. Cancel dialog lists changed files and offers
  Keep running / Cancel & keep / Cancel & restore, naming what restore
  cannot undo. Held rows say why and when they resume.
- **Project settings** at `/p/:project/settings`, rail = section nav
  (docs/12 table): General (type, workspace path with found/not-found
  probe, docs folder state), Git (auto-commit, template, auto-push with
  warning styling + dependency on auto-commit), Pipeline (catalogue with
  required stages locked — open_questions, design, ready, executing, done),
  Tests (framework select, regression suite, vitest-only note), Concurrency
  (writer count + scheduler-doesn't-count copy), Safety (deny list above
  the three modes, ask list, glob hints, "not a boundary" copy),
  Custom fields (field editor: two toggles per row, pool-locked `type`
  options, soft-remove with held-values note), Models & routing
  (allowedModels, routing field + map), Usage limits (three token budgets,
  Fable hidden when excluded), Schedules (all schedules + history), Danger
  zone (trash count, archive, delete, reset schema).
- **Project docs** at `/p/:project/docs[/*path]`: rail becomes the file
  tree of `workspacePath/docs/`; markdown rendered with the design tokens
  (tables, task lists, fenced code with syntax colour); images inline;
  relative links navigate in-app; other file types download; read-only;
  paths confined via spec 08; disabled state when no `docs/` folder.
  Server side: `GET /api/projects/:project/docs` (tree) and `/docs/*path`
  (rendered file or asset).

## Acceptance criteria

- [ ] A run in another project appears in the dock without switching
      workspace; pausing it from the dock works.
- [ ] Progress shows `planning` before a plan exists — never a fabricated
      percentage.
- [ ] Enabling auto-push with auto-commit off is impossible in the UI and
      rejected by the API.
- [ ] The pipeline section cannot uncheck `design`; hovering the lock
      explains why.
- [ ] `[api](./api.md)` in a doc navigates in-app; `../../../etc/passwd`
      in a doc URL is refused by the server.
- [ ] Deleting a project walks through the danger-zone confirmation and
      returns to the grid.

## Tests

Dock state transitions from a scripted activity stream; settings forms
round-trip every project field; docs path confinement (server test);
markdown rendering snapshot with tokens.

## Out of scope

Comments, activity log, attachments (release 1.5 — docs/14).

# 01 — Projects

**Builds on:** 00.
**Source docs:** [02](../docs/02-data-model.md), [06](../docs/06-rest-api.md), [12](../docs/12-project-settings.md).

## Goal

Project records with the full settings surface stored (even where later specs
consume it), slug-addressed routes, archive/delete, and the cached workspace
version reader.

## Scope

- `projects` table with all fields from docs/02: slug, name, description,
  icon, color, status, type, workspacePath, autoCommit, autoPush, statuses,
  fieldSchema, testFramework, regressionTests, safety, modelRouting,
  allowedModels, usageCaps, maxConcurrentRuns, trashRetentionDays,
  timestamps. JSON columns for structured values; defaults per docs
  (`maxConcurrentRuns` 1, `trashRetentionDays` 30, safety mode `ask_all`).
- Endpoints:
  ```
  GET    /api/projects            ?status=active|archived|all (default active)
  POST   /api/projects
  GET    /api/projects/:project
  POST   /api/projects/:project   partial update
  DELETE /api/projects/:project   ?force=true required if the project has tasks
  ```
- Slug rules: unique, URL-safe, permanent — an update that changes `slug`
  fails `422 SLUG_IMMUTABLE`.
- Statuses field validation: must be a subset of the catalogue and include
  the five required statuses ([docs/04](../docs/04-status-pipeline.md));
  order is the catalogue's, not the caller's.
- Version reader: per project type, read the source file
  (package.json / pyproject.toml / go.mod / Cargo.toml / `git describe`),
  cache by mtime, return null when absent. Exposed as `version` on project
  reads; never stored.
- Archive: sets `status=archived`, `archivedAt`. Archived projects stay
  readable; list hides them by default.
- Delete: refuses with `409 PROJECT_HAS_TASKS` unless `?force=true`.

## Acceptance criteria

- [ ] Creating a project with only `name` succeeds; slug is derived and
      returned; all settings have their documented defaults.
- [ ] `statuses` missing `executing` → `422 STATUSES_INVALID`.
- [ ] Version for a `node` project reflects package.json and updates after
      the file's mtime changes, without a restart.
- [ ] `git describe` is executed at most once per mtime change (cached).
- [ ] Deleting a project with tasks requires `force=true`; without it the
      error names the task count in `details`.

## Tests

Slug immutability; status-set validation; version cache (mtime bump); archive
visibility; force-delete; JSON round-trip of every settings field.

## Out of scope

Field-schema semantics (02), cap enforcement (13), safety enforcement (08),
the settings UI (16).

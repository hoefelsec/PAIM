# PAIM — task registry

Every identifiable implementation task, ordered by priority. **The main
priority is an MVP that can manage its own development tasks** — everything
in the `urgent` tier serves that goal; once T25 is done, this registry moves
into PAIM itself and this file freezes.

## How to execute a task

- Take one task. Do not start it before every uuid in its `dependsOn` list
  is done.
- Read the files under `refs` before writing code. The task text is the
  scope; the refs are the detail. If they conflict, `docs/` wins.
- The task is complete only when its **Done** line is verifiably true and
  `npm run typecheck` plus the test suite pass.
- Do not build anything a later task owns.

Field semantics match PAIM's own vocabulary so this list can be imported as
tasks later: `priority` ∈ urgent | high | medium | low; `size` ∈ XS | S | M |
L | XL; `dependsOn` lists task uuids.

Conventions that apply to every task (layout, stack, ports, envelopes,
definition of done): [specs/README.md](README.md).

---

## Priority: urgent — MVP, self-hosting

### T01 — Server skeleton: app factory, envelopes, errors, health
- uuid: `249c1e55-91fc-4e9e-a21e-fadd2578225a`
- priority: urgent · size: S · dependsOn: —
- refs: [specs/00-foundation.md](00-foundation.md) · [docs/06-rest-api.md](../docs/06-rest-api.md)

Create `src/server/app.ts` exporting `createApp(): FastifyInstance` (no
`listen` inside), and `src/server/index.ts` that listens. Implement the list
envelope `{data, meta:{total,cursor,hasMore}}`, the error envelope
`{error:{code,message,details}}`, an `ApiError(code, status, details)` class
mapped by a global error handler (unknown errors → `500 INTERNAL`, no stack
in the body), and `GET /api/health` → `{data:{ok:true,version}}` with the
version from package.json.
**Done:** `app.inject()` tests pass for health, a thrown ApiError, and an
unknown error; unknown `/api/*` returns the 404 envelope.

### T02 — SQLite bootstrap and migration runner
- uuid: `a4f91b58-4987-4d1c-97bb-f6eb86dfb28e`
- priority: urgent · size: S · dependsOn: [`249c1e55-91fc-4e9e-a21e-fadd2578225a` T01]
- refs: [specs/00-foundation.md](00-foundation.md) · [docs/14-scope-and-operations.md](../docs/14-scope-and-operations.md)

Add `better-sqlite3`. Open `data/paim.db` (create `data/` if missing) with
`journal_mode=WAL` and `foreign_keys=ON`. Implement a migration runner that
applies numbered `.sql` files from `src/server/db/migrations/` in order,
records them in a `migrations` table, is idempotent on restart, and aborts on
a numbering gap. Migration 001 creates the `migrations` table.
**Done:** runner tests pass (applies once, idempotent, gap abort); a test
that `kill -9`s a child process mid-transaction leaves the DB openable.

### T03 — Loopback bind, Host check, static serving
- uuid: `e7312f7d-bb64-496f-83db-e704d295192a`
- priority: urgent · size: S · dependsOn: [`249c1e55-91fc-4e9e-a21e-fadd2578225a` T01]
- refs: [specs/00-foundation.md](00-foundation.md) · [docs/15-open-questions.md](../docs/15-open-questions.md) Q3

Bind the listener to `127.0.0.1:4400`. Reject any request whose `Host`
header is not `localhost:4400` or `127.0.0.1:4400` with
`403 HOST_NOT_ALLOWED`. Serve `dist/` at `/` with SPA fallback for non-`/api`
paths; `/api/*` never falls back to the SPA.
**Done:** tests cover the Host rejection, the SPA fallback, and that
`/api/nope` returns the JSON 404 envelope.

### T04 — npm scripts: start, dev, test
- uuid: `ac8d4d33-1140-456c-b58a-a4d936b50a75`
- priority: urgent · size: S · dependsOn: [`e7312f7d-bb64-496f-83db-e704d295192a` T03]
- refs: [specs/00-foundation.md](00-foundation.md)

Wire `npm start` = build client (`vite build`) then run the server on 4400;
`npm run dev` = server on 4400 (tsx watch) + existing Vite dev server on 4401
with `/api` proxied to 4400; `npm test` = vitest. Add `data/` and `dist/` to
`.gitignore`.
**Done:** `npm start` from a fresh clone serves API and client on one port;
`npm run dev` hot-reloads the client while `/api/health` answers through the
proxy.

### T05 — Projects: table, CRUD, slug, archive, delete
- uuid: `821445a3-faf3-4911-adce-5d4e2d7261ea`
- priority: urgent · size: M · dependsOn: [`a4f91b58-4987-4d1c-97bb-f6eb86dfb28e` T02]
- refs: [specs/01-projects.md](01-projects.md) · [docs/02-data-model.md](../docs/02-data-model.md) · [docs/06-rest-api.md](../docs/06-rest-api.md)

Migration for `projects` with every field of docs/02 (JSON columns for
statuses, fieldSchema, regressionTests, safety, modelRouting, allowedModels,
usageCaps) and documented defaults (`maxConcurrentRuns` 1,
`trashRetentionDays` 30, safety mode `ask_all`). Endpoints: list
(`?status=active|archived|all`, default active), create (name required, slug
derived, URL-safe, unique), read, partial update (slug change →
`422 SLUG_IMMUTABLE`), delete (`409 PROJECT_HAS_TASKS` without
`?force=true`), archive via status update. Validate `statuses` as a subset
of the docs/04 catalogue containing the five required statuses; store in
catalogue order.
**Done:** every listed behaviour has a passing `inject` test, including JSON
round-trip of each settings field.

### T06 — Workspace version reader with mtime cache
- uuid: `29f84139-2513-49a6-906c-91b1812735b9`
- priority: urgent · size: S · dependsOn: [`821445a3-faf3-4911-adce-5d4e2d7261ea` T05]
- refs: [specs/01-projects.md](01-projects.md) · [docs/02-data-model.md](../docs/02-data-model.md)

Per project `type`, read the version from package.json / pyproject.toml /
go.mod / Cargo.toml / `git describe` (generic). Cache per project keyed by
the source file's mtime; re-read only when the mtime changes; return null
when unavailable. Expose as `version` on project reads; never store it.
**Done:** tests show a bumped file mtime changes the value without restart
and that the underlying read runs at most once per mtime.

### T07 — Custom fields: FieldDef storage, schema endpoints, change rules
- uuid: `58363ae9-966c-4166-ab56-f611181efb0f`
- priority: urgent · size: M · dependsOn: [`821445a3-faf3-4911-adce-5d4e2d7261ea` T05]
- refs: [specs/02-custom-fields.md](02-custom-fields.md) · [docs/03-custom-fields.md](../docs/03-custom-fields.md)

Implement the FieldDef shape (key snake_case + permanent, label, type,
options, required, default, order, showInTable, showAsFacet, description)
inside `projects.fieldSchema`, with release-1 types `text, long_text,
number, checkbox, date, select, multi_select, url`. Endpoints
`GET/POST /api/projects/:project/schema`. Enforce the five change rules of
docs/03: add always allowed; remove hides (internal `hidden:true`), never
deletes values; type change → `422 FIELD_TYPE_IMMUTABLE`; unknown key on a
write → `400 FIELD_UNKNOWN` unless `?allowUnknownFields=true`, which
auto-creates a hidden text FieldDef; `required` produces `warnings`, never a
rejection.
**Done:** one passing test per rule, plus hidden-field round-trip
(remove → value persists → re-add surfaces it).

### T08 — Zod validator cache per project
- uuid: `77315ecb-afb7-46a3-9044-8155426ebdd2`
- priority: urgent · size: S · dependsOn: [`58363ae9-966c-4166-ab56-f611181efb0f` T07]
- refs: [specs/02-custom-fields.md](02-custom-fields.md) · [docs/03-custom-fields.md](../docs/03-custom-fields.md)

Build one Zod schema per project from its fieldSchema, compile lazily, cache
by project id, and invalidate on schema write and on project delete (a
recreated slug must not inherit the old schema). Export
`getValidator(projectId)` for task writes (T12) and AI extraction (T36).
**Done:** cache tests — same object until invalidation, invalidation on both
triggers, independent validation for two projects.

### T09 — The `type` pool: options, prefixes, validation
- uuid: `616bf95b-1dd7-49e2-9041-32ecf5fbe679`
- priority: urgent · size: XS · dependsOn: [`58363ae9-966c-4166-ab56-f611181efb0f` T07]
- refs: [specs/02-custom-fields.md](02-custom-fields.md) · [docs/03-custom-fields.md](../docs/03-custom-fields.md) · [docs/02-data-model.md](../docs/02-data-model.md)

Export the pool constant from `src/shared/`:
`feature→FEAT, bug→BUG, chore→CHORE, spike→SPIKE, debt→DEBT`, plus the
`TASK` fallback prefix. Reject a `type` FieldDef whose options are not a
subset of the pool with `422 TYPE_OPTION_UNKNOWN`.
**Done:** pool exported and consumed by schema validation; rejection test
passes.

### T10 — Tasks table and shared types
- uuid: `2df1080d-7eea-4c10-89c2-70cef3964033`
- priority: urgent · size: S · dependsOn: [`821445a3-faf3-4911-adce-5d4e2d7261ea` T05]
- refs: [specs/03-tasks.md](03-tasks.md) · [docs/02-data-model.md](../docs/02-data-model.md)

Migration for `tasks`: core fields as indexed columns (key, projectId,
title, status, priority, size, kind, labels, assignee, parentId, order,
deletedAt, timestamps), JSON columns for `fields`, `dependsOn`, `questions`,
`designOptions`, `tests`, `reviews`, plus model, effort, safety,
childManualReview, schedule, sourcePrompt, evaluatedAt, staleReason,
closedAt. Define the shared `Task` type in `src/shared/types.ts` used by
server and client.
**Done:** migration applies; shared type compiles on both sides; an insert
and read round-trips every field.

### T11 — Task keys: type prefix plus per-project counter
- uuid: `dee81fc4-69bd-4883-bb42-2f7ca943e17c`
- priority: urgent · size: S · dependsOn: [`616bf95b-1dd7-49e2-9041-32ecf5fbe679` T09, `2df1080d-7eea-4c10-89c2-70cef3964033` T10]
- refs: [specs/03-tasks.md](03-tasks.md) · [docs/02-data-model.md](../docs/02-data-model.md) "Task keys"

On task creation, derive the key prefix from the task's `type` value via the
T09 pool (`feature` → `FEAT-n`); no type → `TASK-n`. One counter per project
stored in its own table and incremented inside the insert transaction. Keys
are permanent: a later `type` change never renames.
**Done:** tests for each prefix, the fallback, permanence after type change,
and no duplicate keys under 50 concurrent creates.

### T12 — Task create/read/update/delete
- uuid: `6617f223-2595-4624-ae09-bc667b5a1ad2`
- priority: urgent · size: M · dependsOn: [`77315ecb-afb7-46a3-9044-8155426ebdd2` T08, `dee81fc4-69bd-4883-bb42-2f7ca943e17c` T11]
- refs: [specs/03-tasks.md](03-tasks.md) · [docs/06-rest-api.md](../docs/06-rest-api.md)

Endpoints: `POST /api/projects/:project/tasks` (title is the only required
field; `fields` validated via T08), `GET/POST/PATCH/DELETE
/api/projects/:project/tasks/:key` where `:key` accepts key or UUID. Updates
shallow-merge core fields and `fields`; `null` clears a key; `If-Match:
<updatedAt>` gives compare-and-swap (`409 IF_MATCH_FAILED`); without it last
write wins. `DELETE ?hard=true` bypasses the trash and removes the row.
Initial status: first status of the project's pipeline (`backlog` if
enabled, else `ready`) — compose overrides this later (T36).
**Done:** tests for create-minimal, merge/clear semantics, If-Match success
and conflict, key-or-uuid addressing, hard delete.

### T13 — Task list: filters, sort, cursor pagination
- uuid: `e215dd6e-5b15-44a2-88e6-8023e13dd259`
- priority: urgent · size: M · dependsOn: [`6617f223-2595-4624-ae09-bc667b5a1ad2` T12]
- refs: [specs/03-tasks.md](03-tasks.md) · [docs/06-rest-api.md](../docs/06-rest-api.md)

`GET /api/projects/:project/tasks` with the full query surface of docs/06:
`status` (csv), `open=true` (category todo|in_progress), `priority`, `label`,
`assignee`, `parent`, `size`, `field.<key>` (JSON path), `q` (substring on
title+description for now), `updatedSince`, `sort` (csv, `-` prefix for
descending, default `-updatedAt`), `limit` (default 50) + opaque `cursor`.
Return the list envelope with `total`.
**Done:** table-driven test covering every parameter and a stable two-page
cursor walk; p99 < 30 ms over 1 000 seeded tasks in a perf test.

### T14 — Trash: soft delete, restore, retention sweep
- uuid: `a44cc364-1fb2-4c1a-8d9a-aa2f4e357075`
- priority: urgent · size: S · dependsOn: [`6617f223-2595-4624-ae09-bc667b5a1ad2` T12]
- refs: [specs/03-tasks.md](03-tasks.md) · [docs/06-rest-api.md](../docs/06-rest-api.md) "The trash"

Plain `DELETE` sets `deletedAt`; trashed tasks vanish from all lists and
reads. `GET /api/projects/:project/trash` lists them;
`POST /api/projects/:project/trash/:key` restores intact with the same key.
A sweep on startup and every 24 h purges rows older than the project's
`trashRetentionDays`.
**Done:** lifecycle test (delete → invisible → restore intact) and a
clock-mocked sweep test.

### T15 — Epic invariants
- uuid: `7bb5c50e-e9d5-4795-a8bf-0013a5a998bc`
- priority: urgent · size: S · dependsOn: [`6617f223-2595-4624-ae09-bc667b5a1ad2` T12]
- refs: [specs/03-tasks.md](03-tasks.md) · [docs/02-data-model.md](../docs/02-data-model.md) "Epic"

Derive `kind` from `size === 'Epic'`; reject direct `kind` writes. Enforce:
a child (`parentId` set) cannot have size Epic (`422 EPIC_NESTING`);
changing size away from Epic while children exist →
`422 EPIC_HAS_CHILDREN`; `parentId` must reference an epic in the same
project. Compute epic progress (`n/m done, k cancelled`) on task reads.
**Done:** one test per invariant plus progress counts including cancelled
children.

### T16 — Bulk update endpoint
- uuid: `e5a70aaa-e7ce-4a84-bedf-ed26e49c6c6e`
- priority: urgent · size: XS · dependsOn: [`6617f223-2595-4624-ae09-bc667b5a1ad2` T12]
- refs: [specs/03-tasks.md](03-tasks.md) · [docs/06-rest-api.md](../docs/06-rest-api.md)

`POST /api/projects/:project/tasks/bulk { ids[], patch{} }` applies the T12
merge semantics to each task in one transaction; the response reports
per-task success or error code.
**Done:** test patching 3 tasks where 1 fails validation — the other 2
succeed and the response says which.

### T17 — SSE utility and /api/events
- uuid: `5d5197cb-eb23-4fb2-860c-ae3372fc7726`
- priority: urgent · size: M · dependsOn: [`6617f223-2595-4624-ae09-bc667b5a1ad2` T12]
- refs: [specs/06-events.md](06-events.md) · [docs/06-rest-api.md](../docs/06-rest-api.md) "The events stream"

Build the SSE helper (connection registry, 25 s heartbeat comment, JSON
`data:` frames, cleanup on disconnect) and `GET /api/events` emitting
`{type: task|project|schema|view, id, projectId, change:
created|updated|deleted}` from a single choke point in the storage layer —
one event per changed record, bulk included.
**Done:** fan-out test (multiple clients, same event), one-event-per-write
coverage across all existing mutating endpoints, registry leak test.

### T18 — UI shell: router, layout, workspace switcher, project grid
- uuid: `fa1e89ad-6e84-4e84-ab20-bd5c21103082`
- priority: urgent · size: M · dependsOn: [`ac8d4d33-1140-456c-b58a-a4d936b50a75` T04, `821445a3-faf3-4911-adce-5d4e2d7261ea` T05]
- refs: [specs/14-ui-shell-and-table.md](14-ui-shell-and-table.md) · [docs/07-user-interface.md](../docs/07-user-interface.md) · [docs/13-design-language.md](../docs/13-design-language.md) · design/mockups.html

Replace the gallery entry point with the app: routes `/` (project grid, no
rail, never redirects), `/p/:project` (shell: sidebar with switcher + rail
slot, main pane, dock placeholder). Workspace switcher menu: active projects
with open counts, archived row, Project settings / New project / All
projects entries. Project grid cards per the mockup (tile, name,
description, progress meter, open count). Add TanStack Query wired to the
API. Use only `src/styles/tokens.css` values; reuse `src/ui/` primitives.
**Done:** navigating grid → project → back works; switching projects
re-scopes the URL; visual check against mockups.html "All projects" and
shell frame.

### T19 — UI task table
- uuid: `4fe0345b-462f-45ef-932e-f1ebb3704b6e`
- priority: urgent · size: L · dependsOn: [`e215dd6e-5b15-44a2-88e6-8023e13dd259` T13, `7bb5c50e-e9d5-4795-a8bf-0013a5a998bc` T15, `fa1e89ad-6e84-4e84-ab20-bd5c21103082` T18]
- refs: [specs/14-ui-shell-and-table.md](14-ui-shell-and-table.md) · [docs/07-user-interface.md](../docs/07-user-interface.md) "The table" · [docs/13-design-language.md](../docs/13-design-language.md) "Icons and shapes"

The table at `/p/:project`: 33 px rows; columns Key · Title · Prio · Type ·
Size · Updated plus `showInTable` custom fields; group-by-status rows.
Glyphs from `src/ui/shapes.tsx`: priority bars (height), size dots (XS–XL =
1–5 filled of 5, rings for empty, Epic pill), type silhouettes from the T09
pool; value name on hover; monospace keys. Epic rows: disclosure triangle,
`n/m done` count, children indented in place (view state, not navigation).
**Done:** renders 1 000 seeded tasks smoothly; glyph unit tests; epic
expand/collapse keeps scroll position; matches mockups.html "Table · epic".

### T20 — UI facet rail
- uuid: `30b27596-ac08-40f3-941c-0b72fd35c953`
- priority: urgent · size: M · dependsOn: [`4fe0345b-462f-45ef-932e-f1ebb3704b6e` T19]
- refs: [specs/14-ui-shell-and-table.md](14-ui-shell-and-table.md) · [docs/07-user-interface.md](../docs/07-user-interface.md) "The left rail"

Generate facets from the project: Status (from its pipeline), Priority,
Size, Labels, Assignee (core) plus every `select`/`multi_select` field with
`showAsFacet` (schema). Facet heads show the source label (`core` /
`pipeline` / `schema`) and live counts. Checking facets updates the URL
query string — filter state lives only there; the rail filters the set, the
toolbar presents it. A "Clear all" footer with the active count.
**Done:** a project with a `layer` facet shows it, one without doesn't;
URL round-trip test (paste URL → same filters); back button restores the
previous filter state.

### T21 — UI inline editing with optimistic updates
- uuid: `448cea08-2b07-40a4-a3b8-1a0c9535f4ce`
- priority: urgent · size: M · dependsOn: [`4fe0345b-462f-45ef-932e-f1ebb3704b6e` T19]
- refs: [specs/14-ui-shell-and-table.md](14-ui-shell-and-table.md) · [docs/07-user-interface.md](../docs/07-user-interface.md) "Editing"

Click a cell value to edit in place (select menus for enum-like fields, text
inputs otherwise); blur or Enter saves; Esc cancels. Apply optimistically,
reconcile with the response; on rejection flash the row clay and revert
(docs/13 motion). No modal forms, no Save button anywhere.
**Done:** component tests for save/cancel and the rejected-write revert
(server returns 4xx), including an If-Match conflict.

### T22 — UI live updates over /api/events
- uuid: `5b7600ea-9db9-4fcc-aef9-b9c8d7fc3568`
- priority: urgent · size: S · dependsOn: [`5d5197cb-eb23-4fb2-860c-ae3372fc7726` T17, `4fe0345b-462f-45ef-932e-f1ebb3704b6e` T19]
- refs: [specs/06-events.md](06-events.md) · [docs/07-user-interface.md](../docs/07-user-interface.md) "Editing"

Subscribe once to `/api/events`; on an event, invalidate the matching
TanStack Query keys (task lists and single tasks by project). Reconnect with
full revalidation after connection loss. Show a small `live` indicator in
the toolbar reflecting connection state.
**Done:** a task created via `curl` appears in an open table without refresh
(browser-mode test); indicator flips when the server drops.

### T23 — UI quick create (interim)
- uuid: `a4ddcd9a-b570-404d-b6ee-2a1c185764b8`
- priority: urgent · size: S · dependsOn: [`6617f223-2595-4624-ae09-bc667b5a1ad2` T12, `fa1e89ad-6e84-4e84-ab20-bd5c21103082` T18]
- refs: [docs/07-user-interface.md](../docs/07-user-interface.md) "Keyboard"

Interim task creation so the MVP is usable before the AI composer exists:
`C` (and a New task button) opens a single title input; Enter POSTs
`{title}` and focuses the new row. **This is a stopgap** — T41 (composer)
replaces this surface at `/p/:project/new`; keep the component isolated so
deleting it is trivial. Note the deviation from docs/08 ("the service has no
form") in a code comment referencing this task.
**Done:** create-via-keyboard works end to end; component is self-contained.

### T24 — UI task view: Overview tab and properties column
- uuid: `285b3e63-1e2e-4ca9-bc8b-b3a6a6747023`
- priority: urgent · size: M · dependsOn: [`448cea08-2b07-40a4-a3b8-1a0c9535f4ce` T21]
- refs: [specs/15-ui-task-view-and-composer.md](15-ui-task-view-and-composer.md) · [docs/07-user-interface.md](../docs/07-user-interface.md) "The task view"

Full-screen task view at `/p/:project/t/:key`: crumb, title, status pill,
tab row (render only Overview until later tasks add tabs). Overview shows
the markdown description and the `sourcePrompt` block when present. The
right properties column (status, priority, size, type, custom fields,
labels, assignee) reuses T21 in-place editing. Rail becomes a back link.
**Done:** deep link loads full page; every property edits and persists;
matches the mockup's task-view frame minus later tabs.

### T25 — Dogfood milestone: PAIM manages PAIM
- uuid: `86c32317-55db-466c-bc7b-229a7325539d`
- priority: urgent · size: S · dependsOn: [`e5a70aaa-e7ce-4a84-bedf-ed26e49c6c6e` T16, `5b7600ea-9db9-4fcc-aef9-b9c8d7fc3568` T22, `a4ddcd9a-b570-404d-b6ee-2a1c185764b8` T23, `285b3e63-1e2e-4ca9-bc8b-b3a6a6747023` T24]
- refs: this file · [docs/01-overview.md](../docs/01-overview.md)

Write `scripts/import-tasks.ts`: create the `paim` project (type node,
workspacePath = this repo, fieldSchema with the `type` field), parse this
TASKS.md, and POST every task with its uuid stored in `fields.registryUuid`,
priority, size, and `dependsOn` resolved to the created task ids. From this
point, remaining work is tracked in PAIM and this file is frozen (append a
notice at the top when done).
**Done:** running the script yields all registry tasks visible and editable
in the running UI; each task's dependencies resolve to real tasks.

---

## Priority: high — complete tracking product

### T26 — Pipeline engine: catalogue, transitions, failure loop
- uuid: `645528dc-5e03-4458-9104-bd34af61c052`
- priority: high · size: M · dependsOn: [`6617f223-2595-4624-ae09-bc667b5a1ad2` T12]
- refs: [specs/04-status-pipeline.md](04-status-pipeline.md) · [docs/04-status-pipeline.md](../docs/04-status-pipeline.md)

Shared catalogue constant (ten statuses, fixed order, categories, required
five). Transition engine: `advance(task)` to the next enabled status when
its gate permits, `fail(task, reason)` always back to `executing` storing
the reason for the next run's brief. Restrict manual status writes through
the task API to legal moves (no gate skipping — `422 GATE_REQUIRED`;
`cancelled` from anywhere; re-open from `done`).
**Done:** legal/illegal transition matrix test passes; stored failure reason
retrievable on the task.

### T27 — Questions: record and answers endpoint
- uuid: `8602347b-b0be-4c34-b59a-cc98e26c8c0a`
- priority: high · size: S · dependsOn: [`645528dc-5e03-4458-9104-bd34af61c052` T26]
- refs: [specs/04-status-pipeline.md](04-status-pipeline.md) · [docs/04-status-pipeline.md](../docs/04-status-pipeline.md) §1

Store `Question {id, text, kind text|choice, options, answer, answeredAt}`.
`POST /api/projects/:project/tasks/:key/answers {answers:[{questionId,
answer}]}` records answers; when the last open question is answered the task
moves to `ready` and `staleReason` becomes `answers`. Re-evaluation stays
manual. Tasks in `open_questions` expose no run affordance.
**Done:** partial answers keep the status; the last answer flips it and sets
the marker without rewriting any other field.

### T28 — Design and manual-review gate endpoints, mockup storage
- uuid: `773d3dbf-657e-4745-a53b-136cbf70378e`
- priority: high · size: M · dependsOn: [`645528dc-5e03-4458-9104-bd34af61c052` T26]
- refs: [specs/04-status-pipeline.md](04-status-pipeline.md) · [docs/04-status-pipeline.md](../docs/04-status-pipeline.md) §2 §5

Store `DesignOption {id, title, rationale, mockupPath, chosen}` and the
manual `Review {kind:'manual', summary, whatToCheck, entryPoint, verdict,
note, at}`. Endpoints: `POST …/:key/design-reply {optionId}|{text}` records
the reply and keeps the task in `design` (resolution is Claude's call —
T40); `POST …/:key/review {verdict, note}` valid only in `manual_review` —
approved advances, rejected fails back with the note as reason. Mockup HTML
files live under `data/mockups/<taskId>/` and are served read-only at
`GET …/:key/mockups/:optionId` with path confinement.
**Done:** endpoint tests incl. wrong-status rejection and a `..` mockup path
refusal.

### T29 — Epic pipeline rules
- uuid: `3e64b121-ffd8-433a-b2e0-709cfb89f3ea`
- priority: high · size: S · dependsOn: [`7bb5c50e-e9d5-4795-a8bf-0013a5a998bc` T15, `645528dc-5e03-4458-9104-bd34af61c052` T26]
- refs: [docs/02-data-model.md](../docs/02-data-model.md) "Rules for epics" · [docs/04-status-pipeline.md](../docs/04-status-pipeline.md)

When all children of a non-empty epic are resolved (done or cancelled), move
the epic from `executing` to the next enabled status; a re-opened child
pulls it back to `executing`; empty epics never auto-move. Children are
created at `ready` and never enter `open_questions` or `design`.
**Done:** tests for auto-advance (incl. a cancelled child counting as
resolved), re-open, empty epic, and child status floor.

### T30 — dependsOn validation
- uuid: `096e07fc-1d1e-4d4c-b7c6-add5f40e0b48`
- priority: high · size: S · dependsOn: [`6617f223-2595-4624-ae09-bc667b5a1ad2` T12]
- refs: [specs/05-dependencies-and-reevaluation.md](05-dependencies-and-reevaluation.md) · [docs/05-dependencies.md](../docs/05-dependencies.md)

Validate `dependsOn` on write: same project only
(`422 DEPENDENCY_CROSS_PROJECT`), no self-reference, no cycles
(`422 DEPENDENCY_CYCLE`). Export `unmetDependencies(task)` returning the
blocking tasks, for the run queue (T55) and the UI.
**Done:** cycle closed at the final write is rejected; helper accuracy
tests.

### T31 — Staleness engine
- uuid: `d4645360-e45d-4046-b89f-0d178c32b71f`
- priority: high · size: S · dependsOn: [`645528dc-5e03-4458-9104-bd34af61c052` T26, `096e07fc-1d1e-4d4c-b7c6-add5f40e0b48` T30]
- refs: [specs/05-dependencies-and-reevaluation.md](05-dependencies-and-reevaluation.md) · [docs/05-dependencies.md](../docs/05-dependencies.md)

Set `staleReason` per docs/05: `time` (14 days past `evaluatedAt`),
`dependency` (a dependency reached done), `project_change` (10+ project
tasks reached done since `evaluatedAt`); `answers` comes from T27. Evaluate
lazily on task read plus a daily sweep. Both thresholds live in one config
module (tuning values — docs/15).
**Done:** one test per condition; thresholds referenced from config only
(no literals at call sites).

### T32 — Re-evaluate endpoint with stub evaluator
- uuid: `639e1dd2-a473-4859-a2a1-863a855665e8`
- priority: high · size: S · dependsOn: [`d4645360-e45d-4046-b89f-0d178c32b71f` T31]
- refs: [specs/05-dependencies-and-reevaluation.md](05-dependencies-and-reevaluation.md) · [docs/05-dependencies.md](../docs/05-dependencies.md)

`POST /api/projects/:project/tasks/:key/re-evaluate` calls a `Reevaluator`
interface (stub implementation returning an unchanged draft until T39) and
returns a draft `{description, size, priority, fields, dependsOn,
noLongerNeeded}`. It never writes the task except stamping `evaluatedAt` and
clearing `staleReason`. Applying the draft is the caller's separate update.
**Done:** endpoint test proves task-body immutability plus marker reset.

### T33 — Saved views API
- uuid: `e366fa30-7754-4a8f-abdd-53f98f33654e`
- priority: high · size: S · dependsOn: [`e215dd6e-5b15-44a2-88e6-8023e13dd259` T13]
- refs: [specs/03-tasks.md](03-tasks.md) · [docs/07-user-interface.md](../docs/07-user-interface.md) "Saved views"

`SavedView {id, projectId, name, order, filters, sort, groupBy, columns}`
with `GET/POST /api/projects/:project/views` and
`PATCH/DELETE /api/projects/:project/views/:view`. Emit `view` events (T17).
**Done:** CRUD round-trip test; events observed.

### T34 — Cross-project list and full-text search
- uuid: `bbfddf87-d21f-42ac-8af4-2902f0c0194c`
- priority: high · size: M · dependsOn: [`e215dd6e-5b15-44a2-88e6-8023e13dd259` T13]
- refs: [specs/03-tasks.md](03-tasks.md) · [docs/06-rest-api.md](../docs/06-rest-api.md) "Cross-project"

`GET /api/tasks?project=a,b&…` reusing the T13 filter surface across
projects, and `GET /api/search?q=…` over title + description using SQLite
FTS5 (contentless or external-content table kept in sync by triggers).
Upgrade T13's `q` to use FTS too.
**Done:** multi-project filter test; FTS finds stemmed/partial matches and
stays consistent after updates and deletes.

### T35 — Anthropic client module
- uuid: `20c56ebf-8de6-4cb1-b0a1-dfb64ed56367`
- priority: high · size: S · dependsOn: [`249c1e55-91fc-4e9e-a21e-fadd2578225a` T01]
- refs: [specs/07-ai-compose.md](07-ai-compose.md) · [docs/09-ai-run.md](../docs/09-ai-run.md) "Credentials"

Wrap `@anthropic-ai/sdk`: credentials from the environment only
(`ANTHROPIC_API_KEY` or the `ant auth` profile — the SDK resolves them); no
stored key, no key field anywhere. On startup log "no Anthropic credentials
found" when absent and expose `aiAvailable()`; AI endpoints return
`503 AI_UNAVAILABLE` when false. Provide `parse(model, system, user,
zodSchema)` using `messages.parse()` + `zodOutputFormat` with
`cache_control` on the system block.
**Done:** unit tests with a mocked SDK; unavailable path returns 503 and
non-AI routes are unaffected.

### T36 — Compose endpoint
- uuid: `eb66d1ad-cb8b-4997-9584-8f430dd5da68`
- priority: high · size: M · dependsOn: [`77315ecb-afb7-46a3-9044-8155426ebdd2` T08, `8602347b-b0be-4c34-b59a-cc98e26c8c0a` T27, `096e07fc-1d1e-4d4c-b7c6-add5f40e0b48` T30, `20c56ebf-8de6-4cb1-b0a1-dfb64ed56367` T35]
- refs: [specs/07-ai-compose.md](07-ai-compose.md) · [docs/08-ai-compose.md](../docs/08-ai-compose.md)

`POST /api/projects/:project/tasks/compose {text}` → `{draft, questions,
warnings}`. Extraction schema generated from fieldSchema (same source as
T08); open tasks provided as context so the draft can propose `dependsOn`;
draft includes task tests. Uninferable values stay empty and are named in
`warnings` — never guessed. `?commit=true` creates the task directly. First
status per docs/08: questions → `open_questions`; needs-design → `design`;
else `ready`. Stamp `sourcePrompt` and `evaluatedAt`. Model
`claude-opus-5`.
**Done:** mocked-client tests for schema-driven prompt content, warnings,
first-status matrix, and commit flag.

### T37 — Merge tasks into an epic
- uuid: `5b8f27c5-124e-4e49-a6af-0531db7a0063`
- priority: high · size: S · dependsOn: [`7bb5c50e-e9d5-4795-a8bf-0013a5a998bc` T15, `eb66d1ad-cb8b-4997-9584-8f430dd5da68` T36]
- refs: [docs/08-ai-compose.md](../docs/08-ai-compose.md) §2

`POST /api/projects/:project/tasks/merge-epic {taskIds}` → epic draft:
title, shared-goal description, `size: Epic`, priority = highest child,
select fields = common value or empty; response includes the re-parent
list. Nothing is written until the client applies the draft via normal
endpoints. Reject ids that are epics or already children
(`422 MERGE_INVALID`).
**Done:** field-rule tests (priority max, agreement/empty); no side effects
on the draft call.

### T38 — Suggested order
- uuid: `459be56c-e337-4d23-888e-ff3f54f4e093`
- priority: high · size: S · dependsOn: [`e215dd6e-5b15-44a2-88e6-8023e13dd259` T13, `20c56ebf-8de6-4cb1-b0a1-dfb64ed56367` T35]
- refs: [docs/08-ai-compose.md](../docs/08-ai-compose.md) §3

`POST /api/projects/:project/suggest-order` → `{order:[keys],
rationale:[{key, because}], computedAt}` over the open tasks. Snapshot only:
the service stores nothing and never reorders the table.
**Done:** mocked test verifying every open task appears exactly once with a
reason line and a timestamp.

### T39 — Real re-evaluator
- uuid: `17b20cd5-92dd-4c41-bec6-b7c6fb2e0c8a`
- priority: high · size: S · dependsOn: [`639e1dd2-a473-4859-a2a1-863a855665e8` T32, `20c56ebf-8de6-4cb1-b0a1-dfb64ed56367` T35]
- refs: [docs/05-dependencies.md](../docs/05-dependencies.md) "Re-evaluation"

Implement the `Reevaluator` behind T32: read `sourcePrompt` plus the
current project state (open tasks, done-since-evaluation summary) and return
the draft including `noLongerNeeded`. Same extraction-schema mechanism as
T36.
**Done:** mocked tests for a changed-size draft and a `noLongerNeeded`
verdict; endpoint contract from T32 unchanged.

### T40 — Design-gate resolution
- uuid: `7a6fee4d-e590-4267-8ecc-938e55f90b08`
- priority: high · size: S · dependsOn: [`773d3dbf-657e-4745-a53b-136cbf70378e` T28, `20c56ebf-8de6-4cb1-b0a1-dfb64ed56367` T35]
- refs: [docs/04-status-pipeline.md](../docs/04-status-pipeline.md) §2

After each design reply (T28), ask the model whether the direction is now
unambiguous: response is either `resolved` — task advances to `ready` — or a
follow-up question appended to the task's design thread; the task stays in
`design`. A selection is input, not automatically an answer.
**Done:** mocked both branches; task only leaves `design` on `resolved`.

### T41 — UI composer
- uuid: `fa45376b-a86d-4b41-a391-ff3ad75a4fa4`
- priority: high · size: M · dependsOn: [`fa1e89ad-6e84-4e84-ab20-bd5c21103082` T18, `eb66d1ad-cb8b-4997-9584-8f430dd5da68` T36]
- refs: [specs/15-ui-task-view-and-composer.md](15-ui-task-view-and-composer.md) · [docs/08-ai-compose.md](../docs/08-ai-compose.md) · design/mockups.html "New task · AI"

`/p/:project/new`: textbox (`⌘Enter` composes), draft card with every
inferred value editable in place, empty values marked with the reason,
warnings strip, Create / Create & run (disabled until runs exist) / Discard,
footer with model · latency · token counts. Focused surface: switcher stays,
rail is a back link. **Remove T23's quick-create component**; `C` now routes
here.
**Done:** full compose→edit→create flow against a mocked API; T23 component
deleted.

### T42 — UI saved views and sort menu
- uuid: `37c9ca02-cad2-4a7d-a006-6728d131126f`
- priority: high · size: M · dependsOn: [`4fe0345b-462f-45ef-932e-f1ebb3704b6e` T19, `e366fa30-7754-4a8f-abdd-53f98f33654e` T33, `459be56c-e337-4d23-888e-ff3f54f4e093` T38]
- refs: [docs/07-user-interface.md](../docs/07-user-interface.md) "Saved views" "Sort"

View selector at the toolbar's left end (`/p/:project/v/:view` routes);
Save view promotes live state; divergence shows the dot and accents the
control. Sort menu with normal options plus **Suggested**: fetch once, show
the one-line reason per row position, mark the chip stale when the task set
changes, never auto-reorder.
**Done:** view lifecycle in the browser; suggested order stale-marking
test.

### T43 — UI selection and bulk bar
- uuid: `b55a1480-f50c-4c9b-8f8e-5ce8ff5b9619`
- priority: high · size: S · dependsOn: [`e5a70aaa-e7ce-4a84-bedf-ed26e49c6c6e` T16, `4fe0345b-462f-45ef-932e-f1ebb3704b6e` T19, `5b8f27c5-124e-4e49-a6af-0531db7a0063` T37]
- refs: [docs/07-user-interface.md](../docs/07-user-interface.md) "Selection and bulk actions"

Checkbox column selection; floating bar above the dock slot (Esc clears):
Delete (confirmation with count → trash), "Run n separately" (disabled with
a tooltip until T55), "Merge into epic" (opens the T37 draft: proposed epic
+ re-parent list, apply on confirm).
**Done:** delete and merge flows work end to end; Esc clears; disabled run
action explains itself.

### T44 — UI Questions tab
- uuid: `358e8607-e18a-49df-98b5-3c416674523e`
- priority: high · size: S · dependsOn: [`285b3e63-1e2e-4ca9-bc8b-b3a6a6747023` T24, `8602347b-b0be-4c34-b59a-cc98e26c8c0a` T27]
- refs: [docs/07-user-interface.md](../docs/07-user-interface.md) · design/mockups.html "Open questions"

Questions tab (renders only when the pipeline includes the stage — build the
tab-gating mechanism here for all later tabs): question list with choice
chips or free-text input, answered state with timestamp; no Run control in
this status; alert badge on the tab for open questions.
**Done:** answering the last question updates status + stale banner live;
tab hidden when stage disabled.

### T45 — UI Design tab
- uuid: `9701fec7-9db7-446b-976c-04afcf6f0c88`
- priority: high · size: M · dependsOn: [`285b3e63-1e2e-4ca9-bc8b-b3a6a6747023` T24, `773d3dbf-657e-4745-a53b-136cbf70378e` T28, `7a6fee4d-e590-4267-8ecc-938e55f90b08` T40]
- refs: [docs/04-status-pipeline.md](../docs/04-status-pipeline.md) §2 · design/mockups.html "Design"

Option cards: title, rationale, cost line, mockup rendered from
`mockupPath` in a **sandboxed** iframe (`sandbox` attr, no scripts), Choose
control, chosen state; free-text reply box. Replies post to T28; the tab
reflects resolved/follow-up outcomes from T40.
**Done:** mockup renders sandboxed (script-escape test); choose and reply
flows update live.

### T46 — UI Manual review tab
- uuid: `6bcc5b27-3945-46a1-875a-0d25e6d5605c`
- priority: high · size: S · dependsOn: [`285b3e63-1e2e-4ca9-bc8b-b3a6a6747023` T24, `773d3dbf-657e-4745-a53b-136cbf70378e` T28]
- refs: [docs/04-status-pipeline.md](../docs/04-status-pipeline.md) §5 · design/mockups.html "Review · AI"

Review tab with sub-tab scaffolding (AI review and Code review slots arrive
with T71): Manual review sub-tab shows summary, the falsifiable checklist,
the entry point (button for URL, copyable command otherwise), Approve and
Reject-with-reason.
**Done:** approve advances, reject returns the task to `executing` with the
note visible on the task; sub-tab bar renders with placeholders hidden.

### T47 — UI search screen and command palette
- uuid: `1337c4d7-7a9e-4dfe-8a0e-c436c484868b`
- priority: high · size: M · dependsOn: [`fa1e89ad-6e84-4e84-ab20-bd5c21103082` T18, `bbfddf87-d21f-42ac-8af4-2902f0c0194c` T34]
- refs: [docs/07-user-interface.md](../docs/07-user-interface.md) "Routes" "Keyboard"

`/search` across workspaces backed by `GET /api/search`, and the `⌘K`
command palette (cmdk) with: go to task, switch workspace (`⌘P` opens it
pre-filtered), new task, open settings/docs. Complete the keyboard map
(`/`, `J/K`, `E`, `R` stub, `Esc`) as a single registry module.
**Done:** palette navigates to a task by fuzzy key/title; search page lists
cross-project hits; keyboard map has one source of truth.

### T48 — UI project settings: General, Pipeline, Custom fields
- uuid: `a62963fc-1582-4177-b51e-f53fccb0d069`
- priority: high · size: L · dependsOn: [`fa1e89ad-6e84-4e84-ab20-bd5c21103082` T18, `58363ae9-966c-4166-ab56-f611181efb0f` T07, `645528dc-5e03-4458-9104-bd34af61c052` T26]
- refs: [specs/16-ui-dock-settings-docs.md](16-ui-dock-settings-docs.md) · [docs/12-project-settings.md](../docs/12-project-settings.md) · design/mockups.html "Project settings" "Field editor"

`/p/:project/settings` with the rail as section nav. Build three sections:
**General** (type select, workspace path with found/not-found probe
endpoint, docs-folder state, icon, colour), **Pipeline** (catalogue
checklist in fixed order; open_questions, design, ready, executing, done
locked as required with explanatory copy), **Custom fields** (core fields
styled and unremovable; custom rows with Column/Facet toggles; `type`
options limited to the T09 pool; soft-remove showing held-value counts; add
field). Later sections land with their features (T73–T75).
**Done:** each section round-trips its fields against the API; required
stages cannot be unchecked.

### T49 — UI stats band (identity half)
- uuid: `de93a57c-d9b3-4b6a-b45f-8e5ca4baf911`
- priority: high · size: S · dependsOn: [`29f84139-2513-49a6-906c-91b1812735b9` T06, `fa1e89ad-6e84-4e84-ab20-bd5c21103082` T18]
- refs: [docs/07-user-interface.md](../docs/07-user-interface.md) "The stats band"

The band on all workspace screens: left side only for now — live version
from the project read, total / open / closed counts. Reserve the right side
for the T74 meters (empty until then). One ~44 px row.
**Done:** counts update live via events; version reflects the workspace
file.

---

## Priority: medium — execution engine

### T50 — Safety: path confinement
- uuid: `a0d7f35a-2510-4f33-9869-591e9ab40570`
- priority: medium · size: S · dependsOn: [`249c1e55-91fc-4e9e-a21e-fadd2578225a` T01]
- refs: [specs/08-execution-safety.md](08-execution-safety.md) · [docs/10-execution-safety.md](../docs/10-execution-safety.md) §1

One pure function: canonicalize a candidate path (resolve `..` and
symlinks) and verify containment in a root. Refuse `..` escapes, symlinks
leaving the root, absolute paths outside. Used later by runs, docs
rendering, mockups, restore. Not configurable.
**Done:** property-style tests incl. symlink chains and prefix-collision
roots (`/a/b` vs `/a/bb`).

### T51 — Safety: pattern matcher and policy decision
- uuid: `bc2894a7-05dc-4a70-ba37-e1380c7d4109`
- priority: medium · size: S · dependsOn: [`821445a3-faf3-4911-adce-5d4e2d7261ea` T05]
- refs: [specs/08-execution-safety.md](08-execution-safety.md) · [docs/10-execution-safety.md](../docs/10-execution-safety.md) §2–§4

Glob matching (picomatch) of an entry against (a) the normalized bash
command — trimmed, repeated whitespace collapsed — and (b) the file-op
target path; either match applies; case-sensitive.
`decide(op, policy) → deny|ask|allow`: deny list first (never overridable),
then mode (`allow_all` / `ask_all` / `ask_listed`+askList). Per-task
override replaces the mode only. Seed default ask lists per project type.
**Done:** ≥15-case matcher table (incl. `git push*` vs double-space command,
`*.env` path) and the full mode × membership decision matrix.

### T52 — Safety: writer semaphore
- uuid: `c192586c-1b66-421d-a9e8-2cb4c328666a`
- priority: medium · size: S · dependsOn: [`821445a3-faf3-4911-adce-5d4e2d7261ea` T05]
- refs: [specs/08-execution-safety.md](08-execution-safety.md) · [docs/10-execution-safety.md](../docs/10-execution-safety.md) §5

Per-project async semaphore of capacity `maxConcurrentRuns` counting only
writing agents, with a FIFO wait queue and guaranteed release on error
paths. The epic scheduler never acquires it.
**Done:** concurrency tests with capacity 1 and 2 including induced
failures; capacity change takes effect for new acquisitions.

### T53 — Run records and read endpoints
- uuid: `2b741c73-33e0-4183-b739-a80f32670465`
- priority: medium · size: M · dependsOn: [`a4f91b58-4987-4d1c-97bb-f6eb86dfb28e` T02, `645528dc-5e03-4458-9104-bd34af61c052` T26]
- refs: [specs/09-ai-run.md](09-ai-run.md) · [docs/09-ai-run.md](../docs/09-ai-run.md) "Records"

Migrations and shared types for `Run` (kind, parentRunId, trigger, the nine
statuses, restorePoint, usage, timestamps) and `Operation` (kind, risk
derived from kind, summary, status, diff, stdout, exitCode). Read
endpoints: `GET /api/projects/:project/tasks/:key/runs`, `GET
/api/runs/:run` (with operations).
**Done:** round-trip tests; risk derivation (read/glob/grep→safe,
write/edit→write, bash→exec) unit-tested.

### T54 — Runner: Agent SDK integration
- uuid: `148c2f8c-0f56-4a7b-bb2e-f1d163f0a4a1`
- priority: medium · size: L · dependsOn: [`20c56ebf-8de6-4cb1-b0a1-dfb64ed56367` T35, `a0d7f35a-2510-4f33-9869-591e9ab40570` T50, `bc2894a7-05dc-4a70-ba37-e1380c7d4109` T51, `2b741c73-33e0-4183-b739-a80f32670465` T53]
- refs: [specs/09-ai-run.md](09-ai-run.md) · [docs/09-ai-run.md](../docs/09-ai-run.md) · [docs/10-execution-safety.md](../docs/10-execution-safety.md)

Execute a task with `@anthropic-ai/claude-agent-sdk` (built-in tools, cwd =
workspacePath, all paths confined via T50). `canUseTool` delegates to T51:
allow → proceed; deny → return the refusal + reason to the model and record
the operation `denied` (the run continues); ask → record `proposed`, park
without timeout until T56 answers. Record every operation with diff/stdout/
exitCode; capture usage (tokens, costUsd) from result messages. Wrap the
runner behind a `FakeAgent` interface so tests script transcripts without
the SDK.
**Done:** fake-agent tests for allow/deny-continue/ask-park and operation
recording; one live smoke test gated on credentials.

### T55 — Run queue, start rules, model routing
- uuid: `ac0b640b-721d-4223-a4a0-6a94013d1620`
- priority: medium · size: M · dependsOn: [`096e07fc-1d1e-4d4c-b7c6-add5f40e0b48` T30, `c192586c-1b66-421d-a9e8-2cb4c328666a` T52, `2b741c73-33e0-4183-b739-a80f32670465` T53]
- refs: [specs/09-ai-run.md](09-ai-run.md) · [docs/11-models-and-limits.md](../docs/11-models-and-limits.md) · [docs/05-dependencies.md](../docs/05-dependencies.md)

`POST /api/projects/:project/tasks/:key/runs` enqueues (`queued`); a
project without `workspacePath` → `422 NO_WORKSPACE`. Start requires the
T52 semaphore and no unmet dependencies — queuing with unmet deps is
allowed, starting is not (`409 DEPENDENCY_NOT_MET` naming the blocker).
Resolve model/effort: task override → project `modelRouting` (field `size`
or a custom select, through `map`) → `fallback`; enforce `allowedModels`
(`422 MODEL_NOT_ALLOWED`). Task → `executing` on start.
**Done:** routing matrix tests; queue/start separation; dependency block at
start time.

### T56 — Run control endpoints
- uuid: `afe36eee-da2a-4fd8-94d9-f0b1d4608de8`
- priority: medium · size: M · dependsOn: [`148c2f8c-0f56-4a7b-bb2e-f1d163f0a4a1` T54]
- refs: [docs/06-rest-api.md](../docs/06-rest-api.md) "Runs" · [docs/09-ai-run.md](../docs/09-ai-run.md)

`POST /api/runs/:run/approve {operationIds}`, `/deny {operationId, reason}`
(refusal goes to the model, run continues), `/pause` (stops at the end of
the current operation, never mid-operation; context preserved), `/resume`,
`/cancel {restore:boolean}` (restore wiring lands in T57 — until then
`restore:true` on a run without a restore point → `422`).
**Done:** fake-agent tests: approve resumes a parked op; pause boundary
honored; deny-then-adapt sequence recorded like the docs/09 example.

### T57 — Restore points and restore
- uuid: `9794f133-712c-416a-9835-28eb0b7ead87`
- priority: medium · size: L · dependsOn: [`148c2f8c-0f56-4a7b-bb2e-f1d163f0a4a1` T54]
- refs: [specs/09-ai-run.md](09-ai-run.md) · [docs/09-ai-run.md](../docs/09-ai-run.md) "Restore"

Before a run's first write: git workspace → record HEAD + `git stash
create` (working tree untouched); otherwise per-file byte snapshots and a
created-paths list under `data/restore/<runId>/`. `POST
/api/runs/:run/restore` reverts writes/edits, deletes created files, and
undoes this run's automatic commits; available until the task reaches
`done`. Capture failure (oversized file, unreadable tree) → run proceeds,
restore disabled with a stored reason. Flag operations restore cannot
revert (bash side effects) on the operation record.
**Done:** byte-identical restore in both modes (temp git repo and plain
dir); capture-failure path; post-done unavailability.

### T58 — Git integration: auto-commit and auto-push
- uuid: `c343bbb6-8311-4cea-b681-eb08d2b7ffe1`
- priority: medium · size: S · dependsOn: [`148c2f8c-0f56-4a7b-bb2e-f1d163f0a4a1` T54]
- refs: [docs/12-project-settings.md](../docs/12-project-settings.md) "Git"

On run success with `autoCommit`: stage the run's changes and commit with
the message template (`task({key}): {title}` placeholders). `autoPush` only
when autoCommit is on (API rejects enabling it otherwise —
`422 PUSH_REQUIRES_COMMIT`); push failure marks the post-step failed
without failing the run's work.
**Done:** temp-repo tests for template rendering, the dependency rule, and
push-failure isolation.

### T59 — Run and activity streams
- uuid: `3184a12f-ea8a-4be6-95da-f806dd55b225`
- priority: medium · size: S · dependsOn: [`5d5197cb-eb23-4fb2-860c-ae3372fc7726` T17, `2b741c73-33e0-4183-b739-a80f32670465` T53]
- refs: [docs/06-rest-api.md](../docs/06-rest-api.md) "Activity and usage" · [docs/07-user-interface.md](../docs/07-user-interface.md) "Progress"

`GET /api/runs/:run/stream` (operation lifecycle + run status events) and
`GET /api/activity` + `GET /api/activity/stream` (all runs, all projects) on
the T17 SSE utility. Progress data: planned vs completed counts once the
agent declares a plan; `planning` marker before — never a fabricated
percentage.
**Done:** event-order test from a scripted run; activity reflects runs in
two projects.

### T60 — Crash recovery on boot
- uuid: `eab5ae66-968c-4b5f-af27-36a849287c26`
- priority: medium · size: S · dependsOn: [`2b741c73-33e0-4183-b739-a80f32670465` T53]
- refs: [docs/09-ai-run.md](../docs/09-ai-run.md) "Service restart"

On startup, move every run in `planning|awaiting_approval|executing|paused|
held_budget` to `failed` with reason `service_stopped`; leave `queued` runs
queued. Workspace changes stay; restore points remain usable.
**Done:** seed non-terminal runs, boot the app factory, assert statuses and
restore availability.

### T61 — Pipeline hookup: runs drive statuses
- uuid: `7f385028-028d-4d6f-8466-9314298d3033`
- priority: medium · size: S · dependsOn: [`645528dc-5e03-4458-9104-bd34af61c052` T26, `148c2f8c-0f56-4a7b-bb2e-f1d163f0a4a1` T54, `ac0b640b-721d-4223-a4a0-6a94013d1620` T55]
- refs: [docs/04-status-pipeline.md](../docs/04-status-pipeline.md)

Close the loop: run start → task `executing`; run success → `advance()`
into the next enabled gate (testing/ai_review/manual_review/done); run
failure/cancel → task stays `executing` with the failure recorded. The
stored gate-failure reason from T26 is injected into the next run's brief.
**Done:** end-to-end fake-agent test walking executing → (gates) → done and
a failure loop carrying the reason into the next run's prompt.

### T62 — AI review gate
- uuid: `251dd458-4c3e-4d4e-bff3-91f5965e6784`
- priority: medium · size: M · dependsOn: [`20c56ebf-8de6-4cb1-b0a1-dfb64ed56367` T35, `7f385028-028d-4d6f-8466-9314298d3033` T61]
- refs: [docs/04-status-pipeline.md](../docs/04-status-pipeline.md) §4

When a task enters `ai_review`: build the evidence (task description, the
cumulative diff across the task's runs, latest test output), ask
`claude-opus-5` for `Review {kind:'ai', verdict, reason, at}`. Approved →
advance; rejected → fail back with the reason as the next brief. Expose the
cumulative diff as `GET /api/projects/:project/tasks/:key/diff` (also used
by the Code review UI). No computer use — that is release 1.5.
**Done:** mocked verdict both ways; diff endpoint aggregates multiple runs
correctly.

### T63 — Testing gate
- uuid: `a2ff6e3e-4e8a-4bbc-a7c5-0fbfd2a0cc62`
- priority: medium · size: M · dependsOn: [`bc2894a7-05dc-4a70-ba37-e1380c7d4109` T51, `7f385028-028d-4d6f-8466-9314298d3033` T61]
- refs: [specs/12-testing-gate.md](12-testing-gate.md) · [docs/04-status-pipeline.md](../docs/04-status-pipeline.md) §3 · [docs/12-project-settings.md](../docs/12-project-settings.md) "Tests"

On entering `testing`, run the project's `regressionTests` plus the task's
tests (TestDef: name, command, timeoutMs) in the workspace. Every command
passes T51 `decide()` (deny → failed TestRun with reason; ask → gate waits
for approval). Parse vitest via `--reporter=json` into one TestRun per test;
every other framework uses the exit-code path in release 1. Any fail →
`fail()` with the failing output attached; all pass → advance. Add
`POST …/:key/tests/run` for re-runs.
**Done:** fixture vitest + shell projects both parse; deny and timeout
paths; the executing→testing→executing loop test.

### T64 — Usage metering and windows
- uuid: `f7ae4235-5798-4453-8ee2-67a39c1194b4`
- priority: medium · size: M · dependsOn: [`2b741c73-33e0-4183-b739-a80f32670465` T53]
- refs: [specs/13-usage-and-caps.md](13-usage-and-caps.md) · [docs/11-models-and-limits.md](../docs/11-models-and-limits.md)

Aggregate run `usage` per project per window. Windows: 5-hour (opens at the
first run after the previous window ends, closes 5 h later — state
persisted across restarts), weekly (Monday 00:00 service-local), Fable
(`claude-fable-5` tokens within the weekly window). `GET /api/usage`
returns spend per project per window with window boundaries. **Never read
any Anthropic account endpoint** (docs/15 Q1).
**Done:** clock-mocked window math incl. restart persistence and the
opens-at-first-run rule; the module imports no HTTP client (asserted).

### T65 — Caps: budgets and enforcement
- uuid: `1abfd3fc-81b7-4b2c-896c-93a3c1e98a88`
- priority: medium · size: M · dependsOn: [`afe36eee-da2a-4fd8-94d9-f0b1d4608de8` T56, `f7ae4235-5798-4453-8ee2-67a39c1194b4` T64]
- refs: [specs/13-usage-and-caps.md](13-usage-and-caps.md) · [docs/11-models-and-limits.md](../docs/11-models-and-limits.md) "Caps"

`GET/PUT /api/projects/:project/caps {fiveHour, weekly, fable}` — token
budgets, absent = unlimited. Enforcement: new run over a cap →
`409 BUDGET_CAP_REACHED` (window + end time; `?ignoreCaps=true` bypasses);
a running run crossing a cap pauses at the operation boundary →
`held_budget`; held runs auto-resume when the window ends; the Fable cap
blocks only tasks routed to `claude-fable-5`. No banner or toast anywhere.
**Done:** trip-at-start, trip-mid-run at a boundary, auto-resume
(clock-mocked), Fable-only gating, bypass flag.

### T66 — Epic orchestrator: scheduler
- uuid: `9e611181-f608-43d7-9cd7-8fd4acd5ae52`
- priority: medium · size: M · dependsOn: [`3e64b121-ffd8-433a-b2e0-709cfb89f3ea` T29, `096e07fc-1d1e-4d4c-b7c6-add5f40e0b48` T30, `ac0b640b-721d-4223-a4a0-6a94013d1620` T55, `7f385028-028d-4d6f-8466-9314298d3033` T61]
- refs: [specs/10-orchestration.md](10-orchestration.md) · [docs/09-ai-run.md](../docs/09-ai-run.md) "Orchestration"

Running an epic creates a parent Run (`kind:'orchestrated'`) and drives
children as child runs (`parentRunId`, `trigger:'orchestrator'`) in
topological `dependsOn` order (ties: FIFO by `order`). A dependent child
starts only when its dependency task is `done` (full pipeline). The
scheduler is service code — no model, no tokens, never acquires the T52
semaphore (each child agent does). When all children are resolved the
parent run succeeds and T29 advances the epic. Running one child alone
stays a plain single run.
**Done:** A←B sequence under cap 1; cap 2 runs independents concurrently;
zero usage on the parent run.

### T67 — Orchestrator policies
- uuid: `610b9557-0152-4de4-b9f4-6a7d75caf12c`
- priority: medium · size: S · dependsOn: [`9e611181-f608-43d7-9cd7-8fd4acd5ae52` T66]
- refs: [specs/10-orchestration.md](10-orchestration.md) · [docs/09-ai-run.md](../docs/09-ai-run.md)

Add: `childManualReview` on the epic (false → children skip that gate; the
epic always passes its own enabled gates); safety = stricter of epic and
child (mode order allow_all < ask_listed < ask_all; deny lists union);
cancel = stop starting, cancel running children, completed stay complete,
epic returns to its pre-run status; deadlock guard — a child whose
dependencies can never complete parks the orchestrator with a reported
state on the parent run.
**Done:** one test per policy including the strictness matrix and the
deadlock report.

### T68 — Schedules
- uuid: `ab2bccb3-5b34-4d51-b7ec-572986213874`
- priority: medium · size: M · dependsOn: [`ac0b640b-721d-4223-a4a0-6a94013d1620` T55]
- refs: [specs/11-schedules.md](11-schedules.md) · [docs/09-ai-run.md](../docs/09-ai-run.md) "Scheduled runs"

`Schedule {type once|cron, at, expression, timezone, enabled, lastRunAt,
nextRunAt}` on the task; `croner` for evaluation.
`GET /api/projects/:project/schedules`, `PUT/DELETE …/:key/schedule`,
`GET …/:key/schedule/history`. Firing enqueues a normal run
(`trigger:'schedule'`) under the same policies and caps. Skip a firing when
the task already has a queued or in-progress run, recording
`{firedAt, skippedReason}`. `once` disables itself after firing. Missed
firings during downtime are not replayed.
**Done:** clock-mocked skip accumulation, timezone math
(America/Sao_Paulo), once-then-disable, no replay after restart.

### T69 — UI Run tab
- uuid: `4f9beca4-41a4-4f66-8dfd-a2363de474e4`
- priority: medium · size: L · dependsOn: [`285b3e63-1e2e-4ca9-bc8b-b3a6a6747023` T24, `afe36eee-da2a-4fd8-94d9-f0b1d4608de8` T56, `9794f133-712c-416a-9835-28eb0b7ead87` T57, `3184a12f-ea8a-4be6-95da-f806dd55b225` T59]
- refs: [docs/07-user-interface.md](../docs/07-user-interface.md) · [docs/13-design-language.md](../docs/13-design-language.md) "Operation risk colours" · design/mockups.html "Task run"

Run tab streaming the operation log: rows coloured by risk (safe neutral,
write accent, exec clay), inline diffs, bash output blocks, denied rows
struck through with the reason and the model's adaptation, pending rows
with Approve/Deny controls, run state bar with workspace path, Restore
control (or its stored unavailable-reason), irreversible-operation flags on
their rows, runfoot (model · duration · tokens · cost). Enable the `R`
shortcut and "Create & run" (T41).
**Done:** scripted stream renders every operation state; approve from the
tab resumes; restore confirmation reverts (integration against a temp
workspace).

### T70 — UI Tests tab
- uuid: `8a958cbc-1bfb-42d3-a80e-f6a1bc41035a`
- priority: medium · size: S · dependsOn: [`285b3e63-1e2e-4ca9-bc8b-b3a6a6747023` T24, `a2ff6e3e-4e8a-4bbc-a7c5-0fbfd2a0cc62` T63]
- refs: design/mockups.html "Tests" · [docs/04-status-pipeline.md](../docs/04-status-pipeline.md) §3

Summary line (passed/failed/skipped · duration · age), table of TestRuns
(name, kind pill, result, time), failing-output block styled as the next
run's brief, Re-run control calling T63's endpoint. Alert badge on the tab
when the latest run failed.
**Done:** renders both parser shapes (vitest rows, custom exit-code rows);
re-run updates live.

### T71 — UI Review: AI and Code review sub-tabs
- uuid: `3b429fcc-9ed0-4ff1-81c5-d835f44fcf89`
- priority: medium · size: M · dependsOn: [`251dd458-4c3e-4d4e-bff3-91f5965e6784` T62, `4f9beca4-41a4-4f66-8dfd-a2363de474e4` T69]
- refs: [docs/07-user-interface.md](../docs/07-user-interface.md) "The task view" · design/mockups.html "Review · code"

Complete T46's sub-tab bar: **AI review** (verdict card with reason, model,
age; rejected state shows it was sent back as the brief) and **Code
review** (the T62 cumulative diff, collapsible per file with +/− stats,
unified view). Code review answers "what is the state of the files now" —
distinct from the Run tab's chronological log.
**Done:** verdict states render; per-file diff from a multi-run task
matches the endpoint.

### T72 — UI activity dock
- uuid: `a4b63a8a-effa-4d47-a885-9d5ea23fc34d`
- priority: medium · size: L · dependsOn: [`afe36eee-da2a-4fd8-94d9-f0b1d4608de8` T56, `3184a12f-ea8a-4be6-95da-f806dd55b225` T59]
- refs: [docs/07-user-interface.md](../docs/07-user-interface.md) "The activity dock" · design/mockups.html "Activity dock"

Full-width dock under the sidebar on every screen, all runs in all
projects. Collapsed ~30 px row with tallies (running / needs you / held /
queued); expanded rows: project tile, key, title, model · effort (epic rows
show `scheduler`, no model), progress (`n/m` after a plan, indeterminate
`planning` before), elapsed, Pause, Cancel. Child runs indent under the
parent; queued section with positions; held rows say why and when they
resume. Cancel dialog: lists changed files, offers Keep running / Cancel &
keep / Cancel & restore, names what restore cannot undo.
**Done:** scripted activity stream drives every row state; cancel dialog
actions call the right endpoints.

### T73 — UI settings: Git, Concurrency, Safety, Models & routing
- uuid: `50a897cb-2152-442f-b843-540d2172b7b3`
- priority: medium · size: M · dependsOn: [`a62963fc-1582-4177-b51e-f53fccb0d069` T48, `bc2894a7-05dc-4a70-ba37-e1380c7d4109` T51, `ac0b640b-721d-4223-a4a0-6a94013d1620` T55]
- refs: [docs/12-project-settings.md](../docs/12-project-settings.md) · design/mockups.html "Project settings"

Four more sections: **Git** (auto-commit toggle, message template,
auto-push with warning styling and the auto-commit dependency), **Concurrency**
(writer count with the shared-filesystem and scheduler-doesn't-count copy),
**Safety** (deny list above the three modes with no-override copy, mode
radios, ask list, glob pattern hints), **Models & routing** (allowedModels,
routing field selector — size or custom selects — and the per-value map
with fallback).
**Done:** each control round-trips; auto-push without auto-commit is
impossible in UI and rejected by API.

### T74 — UI usage meters and caps settings
- uuid: `0fe8ba23-8462-47cb-a2d3-25891fb720a1`
- priority: medium · size: S · dependsOn: [`de93a57c-d9b3-4b6a-b45f-8e5ca4baf911` T49, `1abfd3fc-81b7-4b2c-896c-93a3c1e98a88` T65]
- refs: [docs/11-models-and-limits.md](../docs/11-models-and-limits.md) · [docs/07-user-interface.md](../docs/07-user-interface.md) "The stats band"

Fill the stats band's right side: three meters showing project spend vs cap
(`spend / budget · window end`), blocked styling when over, Fable meter
hidden when `allowedModels` excludes `claude-fable-5`; band expands for
details. Settings section **Usage limits** edits the three budgets. The
meters are the only warning surface — no banner, no toast.
**Done:** meter states (under / over / hidden) from mocked usage; budgets
round-trip.

### T75 — UI schedules
- uuid: `7884cda1-a1ea-46b2-a76b-4620a9482e61`
- priority: medium · size: S · dependsOn: [`a62963fc-1582-4177-b51e-f53fccb0d069` T48, `ab2bccb3-5b34-4d51-b7ec-572986213874` T68]
- refs: [docs/12-project-settings.md](../docs/12-project-settings.md) · [docs/09-ai-run.md](../docs/09-ai-run.md) "Scheduled runs"

Schedule editor on the task properties column (once/cron, expression,
timezone, enabled) and the settings **Schedules** section listing all
scheduled tasks with next/last fire and the skip history.
**Done:** create/edit/disable from the UI; history renders skips with
reasons.

---

## Priority: low — docs surface, packaging, release

### T76 — Project docs API
- uuid: `4d65c3bd-34dc-4e68-8318-8e4f2689ef22`
- priority: low · size: M · dependsOn: [`821445a3-faf3-4911-adce-5d4e2d7261ea` T05, `a0d7f35a-2510-4f33-9869-591e9ab40570` T50]
- refs: [docs/12-project-settings.md](../docs/12-project-settings.md) "Project documents"

`GET /api/projects/:project/docs` (file tree of `workspacePath/docs/`) and
`GET /api/projects/:project/docs/*path` (markdown source or binary asset;
markdown rendered client-side). Read-only; every path confined via T50;
image types served inline, other types as downloads; no `docs/` folder →
a distinguishable empty state, not an error.
**Done:** tree and file round-trip; `../` traversal refused; asset MIME
correctness.

### T77 — UI project docs screen
- uuid: `8f9fc43a-a908-425c-8f05-e040ccac2b4f`
- priority: low · size: M · dependsOn: [`fa1e89ad-6e84-4e84-ab20-bd5c21103082` T18, `4d65c3bd-34dc-4e68-8318-8e4f2689ef22` T76]
- refs: [docs/12-project-settings.md](../docs/12-project-settings.md) · design/mockups.html "Project docs"

`/p/:project/docs[/*path]`: rail becomes the file tree; markdown rendered
with the design tokens (tables, task lists, fenced code with syntax
colour); images inline; relative links navigate in-app; sidebar Docs
control with file count, disabled state with "No docs/ folder in this
workspace".
**Done:** `[api](./api.md)` navigates in-app; rendering snapshot uses
tokens; disabled state shows.

### T78 — UI danger zone and trash
- uuid: `5bedb3e8-905f-4848-aa3e-90658ccbfc14`
- priority: low · size: S · dependsOn: [`a44cc364-1fb2-4c1a-8d9a-aa2f4e357075` T14, `a62963fc-1582-4177-b51e-f53fccb0d069` T48]
- refs: [docs/12-project-settings.md](../docs/12-project-settings.md) "Danger zone"

Settings Danger zone: trash count with a browse-and-restore list, Archive
project, Delete project (typed confirmation, force path when tasks exist),
Reset schema (confirmation explains hidden-field consequences).
**Done:** each action round-trips with its confirmation; restore from
trash visible in the table live.

### T79 — OpenAPI description
- uuid: `1ddd1dcb-d1ae-4752-8046-510060295c25`
- priority: low · size: M · dependsOn: [`afe36eee-da2a-4fd8-94d9-f0b1d4608de8` T56, `a2ff6e3e-4e8a-4bbc-a7c5-0fbfd2a0cc62` T63, `1abfd3fc-81b7-4b2c-896c-93a3c1e98a88` T65, `ab2bccb3-5b34-4d51-b7ec-572986213874` T68, `4d65c3bd-34dc-4e68-8318-8e4f2689ef22` T76]
- refs: [specs/17-packaging.md](17-packaging.md) · [docs/14-scope-and-operations.md](../docs/14-scope-and-operations.md)

Generate an OpenAPI document from the route Zod schemas, serve at
`GET /api/openapi.json`, and add a test asserting every registered route
appears in it (fails when someone adds an undocumented endpoint).
**Done:** the document lints clean; the coverage test passes.

### T80 — Seed data
- uuid: `9c7e05be-be17-424a-80b4-7c41ea01bccb`
- priority: low · size: S · dependsOn: [`eb66d1ad-cb8b-4997-9584-8f430dd5da68` T36, `ac0b640b-721d-4223-a4a0-6a94013d1620` T55]
- refs: [specs/17-packaging.md](17-packaging.md) · design/mockups.html

`npm run seed`: a demo project matching the mockups — `type` and `layer`
fields, an epic with children, tasks across every status, a synthetic run
history with diffs, one schedule, caps set. Idempotent (re-running resets
the demo project only).
**Done:** fresh clone → install → seed → start shows a populated product.

### T81 — Operational verification suite
- uuid: `83a70df1-997c-48d4-8791-243ada1b201c`
- priority: low · size: M · dependsOn: [`e215dd6e-5b15-44a2-88e6-8023e13dd259` T13, `eab5ae66-968c-4b5f-af27-36a849287c26` T60]
- refs: [docs/14-scope-and-operations.md](../docs/14-scope-and-operations.md) "Operational requirements"

Automate the docs/14 requirements as a CI-runnable suite: start < 1 s; list
p99 < 30 ms at 1 000 tasks; `kill -9` crash safety against the full schema;
all data under `data/`; no API endpoint awaits a run (static check on route
handlers + a runtime assertion).
**Done:** the suite runs green locally via one npm script.

### T82 — CI matrix and release conformance
- uuid: `7cc5eab3-9a13-4666-b55d-41bebed646c3`
- priority: low · size: M · dependsOn: [`1ddd1dcb-d1ae-4752-8046-510060295c25` T79, `83a70df1-997c-48d4-8791-243ada1b201c` T81]
- refs: [specs/17-packaging.md](17-packaging.md) · [docs/14-scope-and-operations.md](../docs/14-scope-and-operations.md) · [docs/15-open-questions.md](../docs/15-open-questions.md)

CI on macOS and Linux running typecheck, tests, the T81 suite, and the T79
coverage check. Add the open-question guard tests: nothing imports an
Anthropic account-usage endpoint; the server binds loopback with the Host
check. Commit the docs/14 release-1 checklist with every line checked or
explicitly deferred.
**Done:** green CI on both platforms; the checklist file exists and is
complete.

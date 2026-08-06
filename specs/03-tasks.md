# 03 — Tasks

**Builds on:** 02.
**Source docs:** [02](../docs/02-data-model.md), [06](../docs/06-rest-api.md).

## Goal

Task CRUD with type-prefixed keys, the query surface, epic invariants at the
data level, trash, bulk, saved views, and cross-project search.

## Scope

- `tasks` table: core fields as real indexed columns (key, projectId, title,
  status, priority, size, kind, labels, assignee, parentId, order,
  timestamps); `fields` and other structured values as JSON columns
  (docs/14 storage detail). All record fields from docs/02, including
  `sourcePrompt`, `evaluatedAt`, `staleReason`, `childManualReview`,
  `dependsOn`, `questions`, `designOptions`, `tests`, `reviews`.
- **Keys** (docs/02 "Task keys"): prefix from the `type` value at creation
  via the pool constant of spec 02; no type → `TASK`; one counter per
  project (its own table, incremented in the insert transaction); permanent —
  later `type` changes never rename.
- **Epic invariants** (docs/02): `kind` derived from `size === 'Epic'` and
  not writable; a child cannot be an epic (`422 EPIC_NESTING`); size change
  away from `Epic` with children → `422 EPIC_HAS_CHILDREN`; `parentId` must
  point at an epic in the same project.
- Endpoints:
  ```
  GET    /api/projects/:project/tasks       list
  POST   /api/projects/:project/tasks       create (title required)
  GET    /api/projects/:project/tasks/:key  :key = task key or UUID
  POST   /api/projects/:project/tasks/:key  partial update (PATCH alias)
  DELETE /api/projects/:project/tasks/:key  ?hard=true skips the trash
  GET    /api/projects/:project/trash
  POST   /api/projects/:project/trash/:key  restore
  POST   /api/projects/:project/tasks/bulk  { ids[], patch{} }
  GET    /api/tasks                         ?project=a,b&…
  GET    /api/search?q=…                    title + description, FTS
  ```
- List query params per docs/06: status, open, priority, label, assignee,
  parent, size, `field.<key>`, `q`, `updatedSince`, `sort` (multi,
  `-` prefix), cursor pagination (`limit`, `cursor`).
- Update semantics: shallow merge on core fields and on `fields`; `null`
  clears a key; `If-Match: <updatedAt>` compare-and-swap →
  `409 IF_MATCH_FAILED` on mismatch; without the header last write wins.
- Trash: soft delete with `deletedAt`; purge rows older than
  `trashRetentionDays` (sweep on start and daily).
- Saved views CRUD (`SavedView` per docs/07):
  ```
  GET/POST /api/projects/:project/views
  PATCH/DELETE /api/projects/:project/views/:view
  ```

## Acceptance criteria

- [ ] Creating a `bug` yields `BUG-n`; a task with no type yields `TASK-n`;
      counters never collide across prefixes (single sequence).
- [ ] Changing `type` after creation leaves the key unchanged.
- [ ] `field.layer=backend&status=ready&sort=-updatedAt` filters and sorts
      correctly with cursor pagination stable across pages.
- [ ] `If-Match` with a stale timestamp → `409`; the task is unchanged.
- [ ] Hard delete skips the trash; soft-deleted tasks appear only under
      `/trash` and restore intact, same key.
- [ ] p99 list latency for 1 000 tasks < 30 ms (measured in a perf test).

## Tests

Key generation (per-type, fallback, permanence, concurrency-safe counter);
epic invariants; every query param; merge/clear/If-Match semantics; trash
lifecycle incl. retention sweep; saved-view round-trip; FTS search.

## Out of scope

Status gates (04), staleness triggers (05), SSE emission (06), any UI.

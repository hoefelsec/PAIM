# 06 — Events

**Builds on:** 03. Parallel with 04/05.
**Source docs:** [06](../docs/06-rest-api.md), [07](../docs/07-user-interface.md).

## Goal

The SSE backbone: one data-change stream plus the shared infrastructure the
run and activity streams (spec 09) will reuse.

## Scope

- SSE utility: connection registry, heartbeat comment every 25 s, JSON
  `data:` payloads, `Last-Event-ID` accepted but replay not required
  (clients revalidate via TanStack Query on reconnect).
- `GET /api/events`: one stream of all data changes. Event payload:
  `{ type: 'task'|'project'|'schema'|'view', id, projectId, change:
  'created'|'updated'|'deleted' }`. Emitted from the storage layer (single
  choke point), not from individual route handlers.
- Emission coverage: every write path from specs 01–05 emits exactly one
  event per changed record (bulk = one event per task).

## Acceptance criteria

- [ ] Creating a task over the API produces one `task/created` event on an
      open `/api/events` connection within 100 ms.
- [ ] A bulk patch of 3 tasks yields exactly 3 events.
- [ ] Schema writes emit `schema/updated`; project delete emits
      `project/deleted` plus nothing per already-trashed task.
- [ ] 100 concurrent SSE clients receive the same event (fan-out test).
- [ ] A dropped connection is cleaned from the registry (no leak after
      disconnect).

## Tests

Fan-out, heartbeat timing, one-event-per-write coverage across all mutating
endpoints (table-driven), registry cleanup.

## Out of scope

Run streams and activity streams (09) — they reuse this utility.

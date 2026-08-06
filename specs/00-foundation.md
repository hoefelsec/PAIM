# 00 — Foundation

**Builds on:** nothing.
**Source docs:** [01](../docs/01-overview.md), [06](../docs/06-rest-api.md), [14](../docs/14-scope-and-operations.md).

## Goal

One Fastify process that serves `/api` and the built client on
`127.0.0.1:4400`, backed by one SQLite file that survives `kill -9`.
Everything later mounts into this skeleton.

## Scope

- Fastify app factory (`createApp()`) separate from the listener, so tests
  can `app.inject()` without a port.
- SQLite bootstrap: open `data/paim.db`, `journal_mode = WAL`,
  `foreign_keys = ON`. A migration runner: numbered SQL files in
  `src/server/db/migrations/`, applied in order, recorded in a
  `migrations` table.
- Response envelopes as reusable helpers:
  lists `{ data, meta: { total, cursor, hasMore } }`,
  errors `{ error: { code, message, details } }`.
- Central error mapping: thrown `ApiError(code, status, details)` renders the
  error envelope; unknown errors render `500 INTERNAL` without a stack trace
  in the body.
- Static serving of `dist/` at `/`, with SPA fallback for client routes.
  `/api/*` never falls back.
- Bind to `127.0.0.1` only. Reject requests whose `Host` header is not
  `localhost:4400` or `127.0.0.1:4400` with `403 HOST_NOT_ALLOWED`
  (docs/15 question 3, option A — the cheap half we can take now).
- `GET /api/health` → `{ data: { ok: true, version } }` (service version from
  package.json).
- npm scripts: `start` (build client + run server), `dev` (server + vite
  proxy), `test` (vitest).

## Data

```sql
CREATE TABLE migrations (
  id        INTEGER PRIMARY KEY,
  name      TEXT NOT NULL UNIQUE,
  appliedAt TEXT NOT NULL
);
```

## Acceptance criteria

- [ ] `npm start` serves the client at `/` and the API at `/api` on one port.
- [ ] Cold start to first successful `/api/health` response is under 1 s.
- [ ] `kill -9` during a write leaves the database openable and consistent
      (WAL verified by test that crashes a child process mid-transaction).
- [ ] A request with `Host: evil.example` gets `403 HOST_NOT_ALLOWED`.
- [ ] All data lives under `data/` — copying that one folder is a backup.
- [ ] Unknown `/api/*` path → `404` with the error envelope, never the SPA.

## Tests

- Envelope helpers: list meta, error shape, stable codes.
- Migration runner: applies once, is idempotent on restart, aborts on gap.
- Host-header rejection; loopback bind (config value asserted).
- SPA fallback vs `/api` 404 separation.

## Out of scope

Any domain table (projects, tasks), SSE, authentication beyond the Host
check, Docker.

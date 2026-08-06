# PAIM — implementation specs (SDD)

This folder turns the product specification in [`docs/`](../docs/) into
implementation-ready work units. `docs/` says **what the product is and why**;
`specs/` says **what to build, in what order, and when it is done**.

## How to execute a spec

1. Read the spec top to bottom, then read the `docs/` files it cites.
2. Implement only what the spec's **Scope** lists. Its **Out of scope**
   section is binding — do not build ahead.
3. Write the tests listed under **Tests**. All of them must pass.
4. Walk the **Acceptance criteria** and verify each one against the running
   code, not against the diff.
5. Stop. One spec per branch or task; do not chain into the next spec.

If a spec contradicts `docs/`, `docs/` wins — fix the spec in the same change
and note it. If a decision is missing from both, add an item to
[`docs/15-open-questions.md`](../docs/15-open-questions.md) and stop.

The full work breakdown — every task with a uuid, priority, size, and
dependency list, ordered for an MVP that manages its own development — is in
[TASKS.md](TASKS.md).

## Build order

Each spec lists what it builds on. The safe sequence is numeric order;
specs marked ∥ can be built in parallel once their dependencies exist.

| # | Spec | Depends on |
|---|------|-----------|
| 00 | [Foundation](00-foundation.md) | — |
| 01 | [Projects](01-projects.md) | 00 |
| 02 | [Custom fields](02-custom-fields.md) | 01 |
| 03 | [Tasks](03-tasks.md) | 02 |
| 04 | [Status pipeline](04-status-pipeline.md) | 03 |
| 05 | [Dependencies & re-evaluation](05-dependencies-and-reevaluation.md) ∥ | 03 |
| 06 | [Events](06-events.md) ∥ | 03 |
| 07 | [AI compose](07-ai-compose.md) | 04, 05 |
| 08 | [Execution safety](08-execution-safety.md) | 01 |
| 09 | [AI run](09-ai-run.md) | 04, 08 |
| 10 | [Epic orchestration](10-orchestration.md) | 09 |
| 11 | [Schedules](11-schedules.md) ∥ | 09 |
| 12 | [Testing gate](12-testing-gate.md) | 09 |
| 13 | [Usage & caps](13-usage-and-caps.md) | 09 |
| 14 | [UI: shell & table](14-ui-shell-and-table.md) | 03, 06 |
| 15 | [UI: task view & composer](15-ui-task-view-and-composer.md) | 07, 09, 14 |
| 16 | [UI: dock, settings, docs](16-ui-dock-settings-docs.md) | 13, 14 |
| 17 | [Packaging & release check](17-packaging.md) | all |

## Conventions (apply to every spec)

**Layout.** The repo already holds a Vite + React + Tailwind client scaffold
(`src/ui/`, `src/gallery/`, design tokens in `src/styles/tokens.css`). Add:

```
src/server/        Fastify app, routes, services
src/server/db/     SQLite access, migrations
src/shared/        types shared by server and client (Task, FieldDef, Run, …)
test/              vitest suites, mirroring src/server structure
data/              runtime data (gitignored): paim.db, restore points
```

**Stack** (from [docs/14](../docs/14-scope-and-operations.md)): Fastify,
`better-sqlite3` (WAL mode), Zod, `@anthropic-ai/sdk` (compose),
`@anthropic-ai/claude-agent-sdk` (runs), React + TanStack Query + Radix +
cmdk (client). Tests: vitest with `app.inject()` — no live HTTP in unit tests.

**Ports and processes.** Production: `npm start` serves the API, the built
client, and all SSE streams on `127.0.0.1:4400`. Development: the server runs
on 4400; Vite dev server on 4401 proxies `/api` to 4400.

**Definition of done, every spec:**

- `npm run typecheck` and the whole test suite pass.
- New endpoints follow the envelopes and status codes of
  [docs/06](../docs/06-rest-api.md); every error has a stable `code`.
- No endpoint blocks on a run; runs are the only slow operation
  ([docs/14](../docs/14-scope-and-operations.md)).
- Glossary terms only ([docs/README](../docs/README.md)): task, run,
  operation — never ticket, job, step.

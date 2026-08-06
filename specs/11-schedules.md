# 11 — Schedules

**Builds on:** 09. Parallel with 10/12/13.
**Source docs:** [09](../docs/09-ai-run.md) (scheduled runs), [06](../docs/06-rest-api.md).

## Goal

Per-task schedules that enqueue normal runs, with the one-pending-run rule
and a visible skip history.

## Scope

- `Schedule` on the task per docs/09: `type once|cron`, `at`, `expression`,
  `timezone`, `enabled`, `lastRunAt`, `nextRunAt`. Cron evaluation via
  `croner` with the schedule's timezone.
- Endpoints:
  ```
  GET    /api/projects/:project/schedules
  PUT    /api/projects/:project/tasks/:key/schedule
  DELETE /api/projects/:project/tasks/:key/schedule
  ```
  plus `GET /api/projects/:project/tasks/:key/schedule/history`.
- Firing enqueues a run with `trigger: 'schedule'` obeying the same safety
  policy and caps as any run.
- **One pending run per task**: a firing is skipped when the task already
  has a queued or in-progress run; the skip is recorded
  (`firedAt`, `skippedReason`) and readable via the history endpoint.
- Missed firings while the service was down are not replayed; the next
  `nextRunAt` is computed from now.
- `once` schedules disable themselves after firing.

## Acceptance criteria

- [ ] A cron `* * * * *` task whose run takes 3 minutes accumulates skip
      records, never a queue of copies.
- [ ] Timezone honoured: a `America/Sao_Paulo` 20:00 schedule fires at
      23:00 UTC (clock-mocked test).
- [ ] Disabled schedule never fires; re-enabling recomputes `nextRunAt`.
- [ ] Service restart: no replay of missed firings; `nextRunAt` is future.

## Tests

Clock-mocked firing, skip rule, once-then-disable, timezone math, restart
behaviour, history contents.

## Out of scope

Recurring tasks that create new tasks (explicitly not planned — docs/14).

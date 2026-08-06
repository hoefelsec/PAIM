# 13 — Usage & caps

**Builds on:** 09.
**Source docs:** [11](../docs/11-models-and-limits.md), [15](../docs/15-open-questions.md) Q1–Q2.

## Goal

Self-metered usage windows and per-project token budgets that block, pause,
and auto-resume runs. Built only on the service's own run records —
account-level Anthropic data is an open question and must not be touched.

## Scope

- Metering source: `usage` on run records (spec 09). Aggregation per
  project per window.
- Windows (docs/11): **5-hour** — opens at the first run after the previous
  window ends, closes 5 h later; **weekly** — Monday 00:00 service-local;
  **Fable** — `claude-fable-5` tokens inside the weekly window. Window
  state persisted so restarts do not reset it.
- Caps: token budgets per project,
  `GET/PUT /api/projects/:project/caps` `{ fiveHour, weekly, fable }`;
  absent cap = unlimited. `GET /api/usage` returns spend per project per
  window plus window boundaries.
- Enforcement:
  - starting a run over a cap → `409 BUDGET_CAP_REACHED` with window and
    end time; `?ignoreCaps=true` bypasses;
  - a running run crossing a cap pauses at the end of the current operation
    → status `held_budget`;
  - held runs resume automatically when their window ends (scheduler tick);
  - the Fable cap gates only tasks routed to `claude-fable-5`; others
    proceed.
- No banner/toast anywhere — the meters (spec 16) are the only surface.

## Acceptance criteria

- [ ] Spend accumulates across runs and resets exactly at the window
      boundary (clock-mocked).
- [ ] A run started under the cap that crosses it mid-flight ends up
      `held_budget` at an operation boundary, never mid-operation.
- [ ] Held run resumes without user action when the window ends, keeping
      its position.
- [ ] `ignoreCaps=true` starts a run that a cap would block.
- [ ] Fable over cap: a Fable-routed task is refused while an Opus-routed
      task starts.
- [ ] Nothing in this module reads any Anthropic account endpoint (grep-able
      guarantee: the module imports no HTTP client).

## Tests

Window boundary math incl. restart persistence and the 5-hour "opens at
first run" rule; cap trip at start and mid-run; auto-resume; Fable routing
gate; bypass flag.

## Out of scope

Account-level meters (docs/15 Q1 — do not build), USD budgets, the stats
band UI (16).

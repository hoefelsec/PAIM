# 05 — Dependencies & re-evaluation

**Builds on:** 03. Parallel with 04.
**Source docs:** [05](../docs/05-dependencies.md).

## Goal

`dependsOn` semantics, the staleness markers, and the manual re-evaluation
endpoint (returning a draft — the AI call itself is stubbed until spec 07
provides the client, behind an interface).

## Scope

- `dependsOn` validation: same project only (`422 DEPENDENCY_CROSS_PROJECT`),
  no self-reference, no cycles (`422 DEPENDENCY_CYCLE`).
- Run gating hook: expose `unmetDependencies(task)` for spec 09's queue; a
  task with unmet dependencies can be queued but not started
  (`409 DEPENDENCY_NOT_MET` names the blocking task).
- Staleness engine (docs/05 table): set `staleReason` on
  `time` (14 days past `evaluatedAt`), `dependency` (a dependency reached
  done), `answers` (from spec 04), `project_change` (10+ tasks reached done
  since `evaluatedAt`). Evaluated lazily on task read plus a daily sweep;
  the two thresholds live in one config module (they are tuning values —
  docs/15).
- Re-evaluation is **manual only**:
  ```
  POST /api/projects/:project/tasks/:key/re-evaluate
  ```
  Reads `sourcePrompt` against current project state through a
  `Reevaluator` interface (real implementation in spec 07); returns a draft
  of description/size/priority/fields/dependsOn plus an optional
  `noLongerNeeded` flag. Applying the draft is a normal task update by the
  caller — this endpoint never writes the task. On success it clears
  `staleReason` and stamps `evaluatedAt`.

## Acceptance criteria

- [ ] A→B→C→A dependency chain is rejected at the write that closes the
      cycle.
- [ ] A task whose dependency reaches `done` gets `staleReason = dependency`
      without any poll from the client (visible on next read).
- [ ] `re-evaluate` returns a draft and does not modify the task record
      (except `evaluatedAt`/`staleReason`).
- [ ] Thresholds (14 days, 10 tasks) are read from config, not literals.

## Tests

Cycle/self/cross-project rejection; each of the four stale conditions;
re-evaluate clears markers and leaves the task otherwise untouched (stub
Reevaluator); `unmetDependencies` accuracy.

## Out of scope

The real AI re-evaluator (07), queue behaviour (09), orchestrator ordering
(10).

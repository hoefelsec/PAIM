# 09 — AI run

**Builds on:** 04, 08.
**Source docs:** [09](../docs/09-ai-run.md), [11](../docs/11-models-and-limits.md), [10](../docs/10-execution-safety.md).

## Goal

Single-task runs on the Claude Agent SDK: the run/operation records, the
in-flight approval loop, pause/resume/cancel, restore points, model routing,
git integration, streams, and crash recovery. The largest spec — split PRs
by section if needed, but it ships as one capability.

## Scope

- **Runner**: `@anthropic-ai/claude-agent-sdk` with the built-in tools;
  `canUseTool` delegates to spec 08's `decide()` — `allow` proceeds, `deny`
  returns the refusal + reason to the model (run continues), `ask` parks the
  operation as `proposed` and waits (no timeout) for
  `POST /api/runs/:run/approve|deny`.
- **Records** exactly per docs/09: `Run` (kind, parentRunId, trigger, status
  `queued|planning|awaiting_approval|executing|paused|held_budget|succeeded|
  failed|cancelled`, operations, restorePoint, usage, timestamps) and
  `Operation` (kind, risk derived from kind, summary, status, diff, stdout,
  exitCode).
- **Queue**: `POST /api/projects/:project/tasks/:key/runs` enqueues; start
  requires the spec 08 semaphore and no unmet dependencies
  (`409 DEPENDENCY_NOT_MET` at start, queuing allowed — docs/05). Task moves
  to `executing` on start; on run end the pipeline engine (04) advances or
  fails the task.
- **Model routing** (docs/11): task override wins; else project
  `modelRouting.field` (`size` or a custom select) through `map`; else
  `fallback`. `allowedModels` enforced (`422 MODEL_NOT_ALLOWED`).
- **Endpoints**: the full run set from docs/06 (runs list, get, stream,
  approve, deny, pause, resume, cancel `{restore}`, restore).
- **Streams**: `GET /api/runs/:run/stream` (operation lifecycle events) and
  `GET /api/activity` + `/api/activity/stream` (all runs, all projects) on
  the spec 06 SSE utility. Progress: planned/completed counts once the agent
  declares a plan; `planning` before.
- **Pause**: stops at the end of the current operation, never mid-operation;
  resume continues with context (SDK session preserved).
- **Restore points** (docs/09): git repo → record `HEAD` +
  `git stash create` of uncommitted state; else per-file byte snapshots +
  created-paths list under `data/restore/<runId>/`. Capture failure (huge
  file, unreadable tree) → run proceeds, Restore disabled with a stored
  reason. Restore reverts writes/edits/creations and this run's automatic
  commits; available until the task reaches `done`; each irreversible
  operation (bash side effects) is flagged on its row.
- **Git integration** (docs/12): `autoCommit` commits on success with the
  message template; `autoPush` only if autoCommit; push failures fail the
  run's post-step, not the work.
- **Service restart** (docs/09): on boot, runs in
  planning/awaiting_approval/executing/paused/held_budget → `failed`,
  reason `service_stopped`; queued runs stay queued.
- Usage recorded per run: inputTokens, outputTokens, costUsd (from SDK
  result messages).

## Acceptance criteria

- [ ] `ask_all` project: the first read operation parks and the run status
      is `awaiting_approval`; approving over the API resumes it.
- [ ] A deny-listed command is refused, recorded `denied`, and the run
      continues (mock agent proposes an alternative).
- [ ] Cancel offers keep/restore semantics: with `{restore:true}` files
      return byte-identical, created files removed, in both git and
      snapshot modes.
- [ ] Restore control is absent (with reason) when capture failed; the run
      still executed.
- [ ] Kill the process mid-run → restart → run is `failed/service_stopped`,
      workspace untouched, restore still works.
- [ ] Routing: size `XS` task runs the mapped model; task-level override
      beats the map; disallowed model rejected.
- [ ] A run in project A and a run in project B execute concurrently; two in
      one project (cap 1) do not.

## Tests

Fake agent harness (scripted SDK transcript) driving: approval flow, deny
continuation, pause boundary, both restore modes (temp git repo + plain
dir), crash recovery, routing matrix, stream event ordering, usage capture.

## Out of scope

Epic orchestration (10), schedules (11), gate test execution (12), caps
(13).

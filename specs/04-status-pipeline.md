# 04 — Status pipeline

**Builds on:** 03.
**Source docs:** [04](../docs/04-status-pipeline.md), [02](../docs/02-data-model.md), [06](../docs/06-rest-api.md).

## Goal

The status catalogue as a state machine the service enforces: gates,
failure-back-to-executing, the gate records (questions, design options,
reviews), and the gate endpoints. Automatic execution of gates that need a
runner (testing, ai_review) lands later — this spec builds the machine they
plug into.

## Scope

- Catalogue as a shared constant: the ten statuses, fixed order, `category`
  (`todo | in_progress | done | cancelled`), required set
  (`open_questions`, `design`, `ready`, `executing`, `done`).
- Transition engine: `advance(task, gateResult)` and
  `fail(task, reason)`; failure always returns the task to `executing`
  with the reason stored so the next run receives it as part of its brief.
  No override that skips a gate. Manual status writes through the task API
  are limited to legal moves (forward one enabled status when its gate
  needs no actor, `cancelled` from anywhere, re-open from done).
- Records on the task (shapes from docs/04): `Question`, `DesignOption`
  (with `mockupPath`), `TestRun`, `Review` (ai without `viewsOpened`;
  manual with summary/whatToCheck/entryPoint/verdict/note).
- Gate endpoints (docs/06 "Gates"):
  ```
  POST /api/projects/:project/tasks/:key/answers      { answers: [{questionId, answer}] }
  POST /api/projects/:project/tasks/:key/design-reply { optionId } | { text }
  POST /api/projects/:project/tasks/:key/review       { verdict, note }
  ```
  - Answers: recorded with `answeredAt`; when the last open question is
    answered the task moves to `ready` and `staleReason` becomes `answers`
    (re-evaluation stays manual — spec 05).
  - Design reply: stored as input; the gate does **not** clear on selection —
    clearing is Claude's call (wired in spec 07/09); until then the endpoint
    records the reply and keeps the task in `design`.
  - Review: valid only in `manual_review`; `approved` advances,
    `rejected` fails back with `note` as reason.
- Epic status rules (docs/02): when all children are resolved (`done` or
  `cancelled`, non-empty set), the epic leaves `executing` to the next
  enabled status; a re-opened child pulls the epic back to `executing`;
  empty epics never auto-move. Children never enter `open_questions` or
  `design`.
- Mockup files for design options: stored under
  `data/mockups/<taskId>/<optionId>.html`, served read-only at
  `GET /api/projects/:project/tasks/:key/mockups/:optionId`.

## Acceptance criteria

- [ ] A task cannot jump from `ready` to `done` when `testing` is enabled —
      `422 GATE_REQUIRED`.
- [ ] Rejecting a manual review moves the task to `executing` and the reason
      is retrievable on the task.
- [ ] Answering the last question: status → `ready`, `staleReason = answers`,
      and the task was **not** rewritten.
- [ ] Cancelling the last unresolved child of an epic advances the epic (a
      cancelled child counts as resolved); progress reports
      `n/m done, k cancelled`.
- [ ] An epic with zero children never auto-advances.
- [ ] A child task created under an epic starts at `ready` even when compose
      would have asked questions (enforced at creation).

## Tests

Transition table (legal/illegal move matrix); each gate endpoint happy path +
wrong-status rejection; epic auto-advance and re-open; answers→staleReason;
mockup file confinement (no `..`).

## Out of scope

Running tests (12), AI review verdicts (09), compose choosing the first
status (07), re-evaluation itself (05).

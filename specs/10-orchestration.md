# 10 — Epic orchestration

**Builds on:** 09.
**Source docs:** [09](../docs/09-ai-run.md) (orchestration), [02](../docs/02-data-model.md), [05](../docs/05-dependencies.md).

## Goal

The epic orchestrator: a deterministic scheduler inside the service — no
model, no tokens — that runs an epic's children in dependency order through
the spec 09 runner.

## Scope

- Running an epic creates a parent `Run { kind: 'orchestrated' }` and child
  runs with `parentRunId` and `trigger: 'orchestrator'`.
- Scheduling: topological order over `dependsOn` among the children; a child
  starts only when all of its dependencies are `done`. Children with no
  mutual order start FIFO by `order`. The scheduler itself never acquires
  the writer semaphore; each child agent does — default cap 1 gives strict
  sequence.
- Child pipeline: children skip `open_questions` and `design` (enforced by
  04); `childManualReview` on the epic decides whether children pass
  `manual_review` (false → skip that gate); the epic itself always passes
  the project's enabled gates.
- Safety: the stricter of epic policy and child policy applies to each child
  (mode strictness order: `allow_all < ask_listed < ask_all`; deny lists
  union).
- A dependent child starts only when its dependency task reaches `done` —
  full pipeline, not merely run-success.
- Cancel: stop starting new children, cancel running child runs (their own
  cancel semantics apply), completed children stay complete; the epic
  returns to its pre-run status.
- Completion: when all children are resolved, the parent run ends
  `succeeded` and the epic advances per spec 04's epic rule.
- Deadlock guard: a child whose dependencies can never complete (failed &
  abandoned, cancelled dependency chain) parks the orchestrator in a
  reported state rather than spinning; surfaced on the parent run.
- Running one child alone stays a normal single run (no orchestrator).

## Acceptance criteria

- [ ] Epic with children A←B (B depends on A), cap 1: A runs to `done`
      before B starts; the parent run shows both as child rows.
- [ ] `childManualReview: false` → children flow past manual review; the
      epic still stops at its own manual review when enabled.
- [ ] Epic mode `ask_all` + child override `allow_all` → child effectively
      runs `ask_all` (stricter wins).
- [ ] Cancelling the orchestrator mid-sequence leaves finished children
      `done` and unstarted children untouched.
- [ ] Zero tokens attributed to the parent run; usage only on children.
- [ ] Raising the cap to 2 runs two independent children concurrently while
      a dependent third waits.

## Tests

Topological ordering incl. ties; gate-waiting (dependency done vs run done);
strictness matrix; cancel mid-flight; deadlock guard; semaphore interaction
with cap 1 and 2 (fake agent harness from 09).

## Out of scope

The AI-planned orchestrator (not planned for release 1 at all), cross-epic
scheduling, dock UI (16).

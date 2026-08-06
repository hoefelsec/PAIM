# 08 — Execution safety

**Builds on:** 01. Parallel with 03–07.
**Source docs:** [10](../docs/10-execution-safety.md).

## Goal

The safety kernel as a pure, heavily-tested module — path confinement, the
glob deny/ask matcher, mode resolution, and the per-project writer-count
semaphore. Spec 09 plugs this into the Agent SDK permission callback
unchanged.

## Scope

- **Path confinement**: canonicalize (resolve symlinks, `..`), verify inside
  `workspacePath`. One function used by runs, docs rendering, restore, and
  mockup serving. Not configurable.
- **Pattern matcher** (docs/10 "The pattern language"): entries are globs,
  matched against (a) the normalized full command of a bash operation —
  trimmed, repeated spaces collapsed — and (b) the target path of a file
  operation. Either match applies. Case-sensitive. Use `picomatch`.
- **Policy resolution**: project `safety` + optional per-task mode override
  (deny list is never overridable). Decision function:
  `decide(op, policy) → 'deny' | 'ask' | 'allow'` —
  deny list first, then mode (`allow_all` / `ask_all` / `ask_listed` +
  askList).
- Denied operations are returned to the caller as a refusal-with-reason (the
  run must continue — enforced in 09); recorded status `denied`.
- **Concurrency semaphore**: per project, capacity `maxConcurrentRuns`,
  counting only agents that write. Acquire/release API with a wait queue;
  the epic scheduler never acquires (10).
- **Approvals have no time limit**: the module exposes a pending-approval
  registry; nothing in it expires.
- Default ask-list seeds per project type (docs/12 General).

## Acceptance criteria

- [ ] A symlink inside the workspace pointing outside is refused.
- [ ] `git push*` matches `git  push --force` (double space) after
      normalization; `*.env` matches a write to `prod.env`.
- [ ] Deny beats mode: `allow_all` still refuses a deny-listed command.
- [ ] Per-task override changes the mode but a task-supplied denyList is
      ignored.
- [ ] Semaphore: capacity 1, two acquire calls — second waits until release;
      release on error paths verified.

## Tests

Property-style confinement tests (`..`, absolute, symlink chains); matcher
table (≥15 cases incl. non-matches); decision matrix
mode × list-membership; semaphore under concurrency with induced failures.

## Out of scope

The Agent SDK integration, run records, restore (all spec 09).

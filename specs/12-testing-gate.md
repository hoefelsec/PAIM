# 12 — Testing gate

**Builds on:** 09.
**Source docs:** [04](../docs/04-status-pipeline.md) §3, [12](../docs/12-project-settings.md) Tests.

## Goal

Automatic execution of the `testing` status: regression suite + task tests,
result parsing (vitest structured, everything else via the custom path in
release 1), and the failure loop back to `executing`.

## Scope

- Trigger: task enters `testing` → the service runs the project's
  `regressionTests` and the task's `tests` (both `TestDef`:
  name, command, timeoutMs).
- Safety: every test command passes spec 08's `decide()` under the project
  policy — deny refuses (recorded as a failed TestRun with the reason), ask
  parks the gate awaiting approval like a run operation.
- Execution: commands run in `workspacePath` with timeout; results stored as
  `TestRun { name, kind: regression|task, status pass|fail|skip, durationMs,
  output }` on the task.
- Parsing: `testFramework: vitest` → run with `--reporter=json`, one TestRun
  per test with name and duration. All other frameworks and `custom` in
  release 1 → exit code + raw output, one TestRun per TestDef (docs/12:
  structured jest/pytest/go/cargo parsing is 1.5).
- Outcome: any fail → spec 04 `fail()` back to `executing` with the failing
  output attached as the next run's brief; all pass → advance.
- Task tests written by Claude during compose/runs are stored the same way;
  user edits via the normal task update path (they live on the task record).
- Re-run control: `POST /api/projects/:project/tasks/:key/tests/run`.

## Acceptance criteria

- [ ] A vitest project shows one row per test with real names and durations;
      a `custom` project shows one row per TestDef with exit-code status.
- [ ] One failing test returns the task to `executing`; the stored reason
      contains the failing test's output.
- [ ] A test command matching the deny list never executes and the gate
      reports why.
- [ ] Timeout produces `fail` with a timeout note, not a hung gate.
- [ ] All pass → task advances to the next enabled status automatically.

## Tests

Fixture repos (vitest project, shell-script custom project); parse both
report shapes; deny/ask interaction; timeout; the full
executing→testing→executing loop.

## Out of scope

jest/pytest/go/cargo structured parsers (release 1.5), AI review (part of
09's pipeline hookup), coverage metrics.

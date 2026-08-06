# 15 — Open questions

These decisions are not made. Each item gives the options and a recommendation.
The specification is complete without them, but an implementation must select an
answer.

---

## 1. Concurrency: how does an epic count against `maxConcurrentRuns`?

`maxConcurrentRuns` defaults to 1. The reason is correctness: two agents in one
workspace overwrite the work of each other. See
[10 — Execution safety](10-execution-safety.md).

`maxOrchestratorWorkers` also defaults to 1. If a user sets it to 3, three
agents write to the same workspace. This contradicts the reason for
`maxConcurrentRuns`.

**Options**

| Option | Result |
|---|---|
| A. Child runs count against `maxConcurrentRuns` | The two settings cannot conflict. `maxOrchestratorWorkers` has no effect while `maxConcurrentRuns` is 1. |
| B. An orchestrator counts as one run. Children are outside the limit. | `maxOrchestratorWorkers` works. The correctness rule has a hole. |
| C. Remove `maxOrchestratorWorkers`. Use `maxConcurrentRuns` for both. | One number. Less control. |

**Recommendation: C.** One number describes the real constraint, which is the
count of agents that write to one workspace. Two numbers for one constraint
invite a configuration that corrupts files.

---

## 2. What is the format of a test definition?

`TestDef` has a `command` and a `timeoutMs`. See
[12 — Project settings](12-project-settings.md). Three things are not defined:

- How does the service read the result? It could parse the exit code, TAP
  output, or a JUnit XML file.
- How does the service get the name and the duration of each test?
- Does the service detect the test framework from the project type?

**Recommendation.** Start with the exit code and the raw output. One `TestDef`
is one row in the tests table. Add per-test parsing later, when the format of
the output is known.

---

## 3. Where do task-specific tests come from?

A task can add tests. See
[04 — Status pipeline](04-status-pipeline.md). The source is not defined.

**Options**

| Option | Result |
|---|---|
| A. Claude writes them during the run | No extra work for the user. The model tests its own work. |
| B. The user writes them on the task | Reliable. It is more work. |
| C. Both | More complex. |

**Recommendation: A, with the user able to edit.** The compose step already
produces structured output. A test list is one more field.

---

## 4. When does a task enter `open_questions` or `design`?

A project can enable both statuses. The specification does not say who decides
that one task needs them.

**Recommendation.** Claude decides during compose.

- If the compose step returns questions, the task enters `open_questions`.
- If the compose step reports that a design decision must precede the work, the
  task enters `design`.
- If neither is true, the task enters `ready` and skips both.

An enabled status is available. It is not mandatory for every task. Confirm this
rule.

---

## 5. Does a cancelled child task count as done for its epic?

An epic moves to `done` when all children are done. See
[02 — Data model](02-data-model.md).

A cancelled child is not done. Its category is `cancelled`.

**Options**

| Option | Result |
|---|---|
| A. A cancelled child blocks the epic | The epic never completes until the user deletes the child. |
| B. A cancelled child counts as resolved | The epic completes. The count shows `5/7 done, 2 cancelled`. |

**Recommendation: B.** A cancelled child is a decision, not unfinished work.

---

## 6. Is an epic with no children valid?

A user can set `size` to `Epic` on a task with no children.

**Recommendation.** Permit it. An epic often exists before its children. Show
`0/0` in the progress position. Do not move an empty epic to `done`
automatically, because "all children are done" is true for zero children and
that result is wrong.

---

## 7. Can a dependency cross projects?

`dependsOn` holds task identifiers. The specification does not say whether the
tasks must be in the same project.

**Recommendation.** Same project only, for release 1. A cross-project dependency
needs cross-project queue rules and a display for a task that the current
workspace does not contain.

---

## 8. What happens when a schedule fires during another run?

The schedule puts the task in the queue. See
[09 — AI run](09-ai-run.md). The behaviour for a second firing is not defined.

**Options**

| Option | Result |
|---|---|
| A. Queue every firing | A slow task builds a queue of copies of itself. |
| B. Skip the firing if the task is already in the queue or running | One task has at most one pending run. |

**Recommendation: B.** Record the skipped firing in the schedule history, so the
user can see it.

---

## 9. What are the thresholds for `staleReason`?

Two values need a number. See
[05 — Dependencies](05-dependencies.md).

- `time`: how long after `evaluatedAt` is a task stale?
- `project_change`: what amount of change makes a task stale?

**Recommendation.** For `time`, use 14 days. For `project_change`, use a count
of tasks that reached `done` in the project after `evaluatedAt`; a value of 10
is a reasonable start. Both numbers need a test with real data.

---

## 10. How long does the trash keep a deleted task?

A delete sends the task to the trash. See
[06 — REST API](06-rest-api.md). The retention period is not defined.

**Recommendation.** 30 days, then permanent deletion. Show the count of items in
the trash in the Danger zone section of project settings.

---

## 11. What happens if the service cannot capture a restore point?

A restore point needs a git repository or file snapshots. See
[09 — AI run](09-ai-run.md). Two cases can fail: a very large file, and a
workspace that the process cannot read completely.

**Options**

| Option | Result |
|---|---|
| A. Refuse to start the run | Safe. It stops work for a reason the user may not care about. |
| B. Start the run and disable Restore for it | The run proceeds. The interface must state clearly that Restore is not available. |

**Recommendation: B.** State the reason on the Run tab, in the same position as
the Restore control.

---

## 12. Does the interface show the Fable meter when the project forbids Fable?

`allowedModels` can exclude `claude-fable-5`. The stats band always shows three
meters. See [11 — Models and limits](11-models-and-limits.md).

**Recommendation.** Hide the Fable meter when the project cannot use the model.
A meter for a limit the project cannot reach is noise.

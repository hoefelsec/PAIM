# 04 — Status pipeline

## Statuses are predefined

The service defines all statuses. A project selects which statuses it uses. A
project cannot invent a status and cannot change the order.

The service performs work at each status. It asks the questions. It runs the
tests. It performs the review. Therefore the set of statuses is fixed.

## The catalogue

| Status | Category | Condition to advance (the gate) |
|---|---|---|
| `backlog` | todo | None |
| `open_questions` | todo | The user answers all questions. See §1. **Required.** |
| `design` | todo | Claude accepts the design direction. See §2. **Required.** |
| `ready` | todo | None. **Required.** |
| `executing` | in_progress | The run ends. **Required.** |
| `testing` | in_progress | All tests pass. See §3. |
| `ai_review` | in_progress | Claude returns `approved`. See §4. |
| `manual_review` | in_progress | The user approves. See §5. |
| `done` | done | None. **Required.** |
| `cancelled` | cancelled | None |

`category` has four values: `todo`, `in_progress`, `done`, `cancelled`. A client
uses `category` to answer "is this task open?" without knowledge of the
project's pipeline.

A project must include `open_questions`, `design`, `ready`, `executing`, and
`done`. A task skips `open_questions` and `design` when it does not need them.
See "An enabled status is available" below.

```jsonc
// project settings
"statuses": ["backlog", "open_questions", "design", "ready", "executing", "testing", "done"]
```

## Failure moves the task back to `executing`

Each gate has one failure path. The task returns to `executing`. The service
attaches the reason. The next run receives the reason as part of its
instructions.

Examples of a failure: a test fails, Claude rejects the work, the user rejects
the work.

A task moves forward only when it satisfies the gate. The service has no
override that skips a gate.

## An enabled status is available, not mandatory

A project enables a set of statuses. A task does not always pass through all of
them.

**The compose step decides which gates apply to each task.** See
[08 — AI compose](08-ai-compose.md).

| Result of the compose step | First status of the task |
|---|---|
| Claude returns questions | `open_questions` |
| Claude reports that a decision must precede the work | `design` |
| Neither of the above | `ready` |

A task therefore skips `open_questions` and `design` when it needs neither. The
statuses after `executing` always apply when the project enables them.

Children of an epic are one exception. A child task does not use
`open_questions` and does not use `design`. The epic carries the questions and
the design decisions for all of its children. A child task enters the pipeline
at `ready`. See [09 — AI run](09-ai-run.md).

---

## 1. `open_questions`

The compose step does not always have sufficient information. In that case, the
task enters `open_questions`. It carries the questions that Claude needs.

```
Question {
  id
  text
  kind:     text | choice
  options:  string[]        // for kind = choice
  answer:   string | null
  answeredAt
}
```

The task has no Run control in this status.

When the user answers the last question, the task moves to `ready`. The answers
change the task, so the service sets `staleReason` to `answers` and highlights
the re-evaluation control. Re-evaluation is always manual. The user starts it.
See [05 — Dependencies and re-evaluation](05-dependencies.md).

## 2. `design`

Use this status when a decision must precede the work.

Claude presents options. Most options are HTML mockups. Claude writes each
mockup as one self-contained HTML file. The service stores the file with the
task and renders it in the option card. Some options are text only. Each
option states its cost, not only its benefit.

```
DesignOption {
  id
  title
  rationale
  mockupPath:  string | null    // a self-contained HTML file
  chosen: boolean
}
```

The user selects an option, or replies with text.

**Claude decides when the status ends.** A selection is input. It is not always
an answer. If the reply creates a new question, the task stays in `design`. The
task moves to `ready` when Claude reports that the direction is clear.

## 3. `testing`

A project defines **regression tests**. All tasks in the project must pass them.
A task can hold **task tests** in addition.

```
TestRun {
  id
  name
  kind:     regression | task
  status:   pass | fail | skip
  durationMs
  output:   string | null
}
```

The service runs both sets when the task enters `testing`. The results are a tab
on the task.

The test commands pass the same safety checks as the operations of a run. The
deny list and the mode apply. See
[10 — Execution safety](10-execution-safety.md).

### Where task tests come from

**Claude writes the task tests during the run.** The compose step already
produces structured output, so a list of tests is one more field on the task.

The user can edit a task test and can add a task test by hand. The source of a
test does not change how the service runs it.

### How the service reads the results

The project declares its `testFramework`. See
[12 — Project settings](12-project-settings.md).

| Value of `testFramework` | What the service reads |
|---|---|
| A known framework, for example `jest` or `pytest` | The structured report. The table shows one row for each test, with a name and a duration. |
| `custom` | The exit code and the raw output. The table shows one row for each `TestDef`. |

One failure returns the task to `executing`. The service attaches the output of
the failed test. The task advances when all tests pass.

## 4. `ai_review`

Claude reads the task description, the file differences of all runs, and the
test output. Claude returns a verdict.

```
Review {
  kind:        "ai"
  verdict:     approved | rejected
  reason:      string
  at:          timestamp
}
```

Release 1.5 extends this gate with computer use: Claude opens the application
views that it needs to see the result. The record then adds `viewsOpened`. See
[14 — Scope and operations](14-scope-and-operations.md).

A verdict of `rejected` returns the task to `executing` with the reason.

## 5. `manual_review`

A model cannot satisfy this gate. Claude prepares the review for the user.
Claude gives three things:

1. A description of the change in plain language.
2. A list of specific checks. Each check states an action and an expected
   result.
3. An entry point: a button that opens the correct screen, or a command.

```
Review {
  kind:         "manual"
  summary:      string
  whatToCheck:  string[]
  entryPoint:   { label, url | command }
  verdict:      approved | rejected | null
  note:         string | null
  at:           timestamp
}
```

## Related documents

- [05 — Dependencies and re-evaluation](05-dependencies.md)
- [09 — AI run](09-ai-run.md)
- [12 — Project settings](12-project-settings.md)

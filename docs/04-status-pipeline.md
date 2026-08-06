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
| `open_questions` | todo | The user answers all questions. See §1. |
| `design` | todo | Claude accepts the design direction. See §2. |
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

A project must include `ready`, `executing`, and `done`.

```jsonc
// project settings
"statuses": ["backlog", "open_questions", "ready", "executing", "testing", "done"]
```

## Failure moves the task back to `executing`

Each gate has one failure path. The task returns to `executing`. The service
attaches the reason. The next run receives the reason as part of its
instructions.

Examples of a failure: a test fails, Claude rejects the work, the user rejects
the work.

A task moves forward only when it satisfies the gate. The service has no
override that skips a gate.

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

When the user answers the last question, the service starts a re-evaluation. See
[05 — Dependencies and re-evaluation](05-dependencies.md). The answers change the
task, so the service reconsiders the description, the size, and the priority.
Then the task moves to `ready`.

## 2. `design`

Use this status when a decision must precede the work.

Claude presents options. Most options are images. Some options are text. Each
option states its cost, not only its benefit.

```
DesignOption {
  id
  title
  rationale
  image:  url | null
  chosen: boolean
}
```

The user selects an option, or replies with text, or replies with an image.

**Claude decides when the status ends.** A selection is input. It is not always
an answer. If the reply creates a new question, the task stays in `design`. The
task moves to `ready` when Claude reports that the direction is clear.

## 3. `testing`

A project defines **regression tests**. All tasks in the project must pass them.
A task can define **task tests** in addition.

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

One failure returns the task to `executing`. The service attaches the output of
the failed test. The task advances when all tests pass.

## 4. `ai_review`

Claude reads the task description and all operations of the runs. Claude opens
the application views that it needs to see the result. Claude returns a verdict.

```
Review {
  kind:        "ai"
  verdict:     approved | rejected
  reason:      string
  viewsOpened: string[]
  at:          timestamp
}
```

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

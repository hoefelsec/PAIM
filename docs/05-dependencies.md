# 05 — Dependencies and re-evaluation

## Dependencies

```
dependsOn   uuid[]
```

A task with an unfinished dependency cannot run.

The user can put such a task in the queue. The queue stops the task when its
turn arrives. The queue reports the name of the unfinished dependency. The
service does not start work when the condition of the work is false.

The service permits the queue action. A rule that refuses the queue action makes
the user watch the queue.

### How the service finds dependencies

The compose step finds dependencies when it drafts the task. See
[08 — AI compose](08-ai-compose.md).

The user can add and remove dependencies at any time.

### Dependencies stay inside one project

A dependency points to a task in the same project. The service refuses a
dependency that crosses projects.

A cross-project dependency needs queue rules across projects and a display for a
task that the current workspace does not hold. Release 1 does not include them.

### Effect on the epic orchestrator

The orchestrator obeys `dependsOn` between child tasks. It starts a child task
only when all dependencies of that child are done. See
[09 — AI run](09-ai-run.md).

---

## Re-evaluation

A task from three weeks ago describes a project state that no longer exists.

Re-evaluation reads the original text of the user against the current state of
the project. It reconsiders these values:

- description
- size
- priority
- difficulty and other custom fields
- dependencies

Re-evaluation can also report that the task is no longer necessary.

```
sourcePrompt  string        the original text from the user
evaluatedAt   timestamp     the time of the last evaluation
staleReason   time | dependency | answers | project_change | null
```

The service keeps `sourcePrompt` for this purpose. Re-evaluation reads it.

### The service suggests. The service does not act.

The service marks a task as stale. It shows the reason and a control. The user
starts the re-evaluation.

The service does not rewrite a task without a command from the user.

### Conditions that set `staleReason`

| Value | Condition |
|---|---|
| `time` | 14 days passed after `evaluatedAt`. |
| `dependency` | A dependency of this task reached `done`. |
| `answers` | The user answered the open questions of this task. |
| `project_change` | 10 or more tasks in the project reached `done` after `evaluatedAt`. |

Both numbers are the first values. Change them after a test with real data.

## Related documents

- [02 — Data model](02-data-model.md)
- [04 — Status pipeline](04-status-pipeline.md)
- [08 — AI compose](08-ai-compose.md)

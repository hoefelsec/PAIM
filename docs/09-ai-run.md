# 09 — AI run

To run a task is to send the task to Claude, receive operations, and execute
those operations in the workspace path.

## The library

The runner uses the **Claude Agent SDK** (`@anthropic-ai/claude-agent-sdk`).

The Agent SDK is Claude Code as a library. It supplies:

- the agent loop;
- the tools: Read, Write, Edit, Bash, Glob, Grep;
- context management;
- a permission callback before each tool execution.

The permission callback is the approval control. See
[10 — Execution safety](10-execution-safety.md).

> The compose step uses a different package: `@anthropic-ai/sdk`, the Messages
> API client. See [08 — AI compose](08-ai-compose.md). The two packages are
> different products.

## Endpoints

```
POST   /api/projects/:project/tasks/:key/runs   start a run
GET    /api/projects/:project/tasks/:key/runs   the runs of one task
GET    /api/runs/:run                           one run and its operations
GET    /api/runs/:run/stream                    Server-Sent Events
POST   /api/runs/:run/approve                   { operationIds: [ … ] }
POST   /api/runs/:run/deny                      { operationId, reason }
POST   /api/runs/:run/pause
POST   /api/runs/:run/resume
POST   /api/runs/:run/cancel                    { restore: true | false }
POST   /api/runs/:run/restore
```

## Records

```
Run {
  id, taskId, projectId
  kind         single | orchestrated
  parentRunId  uuid | null      set on the children of an orchestrated run
  trigger      manual | schedule | orchestrator
  status       queued | planning | awaiting_approval | executing
               | paused | held_budget | succeeded | failed | cancelled
  operations   Operation[]
  restorePoint RestorePoint
  usage        { inputTokens, outputTokens, costUsd }
  startedAt / endedAt
}

Operation {
  id
  kind      read | glob | grep | write | edit | bash
  risk      safe | write | exec         derived from kind
  summary   "Edit src/api/tasks.ts"
  status    proposed | approved | denied | running | done | failed
  diff      string | null               for write and edit
  stdout    string | null               for bash
  exitCode  integer | null
}
```

## Approval happens during the run

The agent works. Each operation that needs approval stops when it occurs. The
service does not produce a plan of all operations first.

A plan that the model writes before it reads any file is a guess. To review such
a plan costs attention and gives little value.

**Dry run** covers the other case. A dry run executes the agent in the normal
way. It shows every operation and every file difference. It applies nothing. Dry
run is a control on one run and a default in project settings.

## Restore

Each run captures a **restore point** before its first write.

| Method | Content |
|---|---|
| Git, when the workspace is a repository | The value of `HEAD`. A stash of the uncommitted changes. |
| File snapshots, in all other cases | The original bytes of each file that the run changes. The list of paths that the run creates. |

**Restore** returns the files to their state before the run. It deletes the
files that the run created.

The service offers Restore while the task is not finished: during `executing`,
`testing`, and review. The control disappears when the task reaches `done`. At
that point the changes are the product of the task.

### What Restore reverts

| Restore reverts | Restore does not revert |
|---|---|
| File writes and edits inside the workspace path | Packages that a command installed |
| Files that the run created | Services that a command restarted |
| Staged changes and automatic commits from this run | Database migrations that a command applied |
| | Commits that a command pushed to a remote |
| | Writes outside the workspace path |
| | Network requests that already completed |

The interface states this limit at the point of use:

- An operation that Restore cannot revert says so on its own row.
- The cancel dialog names the side effect that neither action can revert.

A run that only edits files restores completely. A run that executed
`npm install` restores its files and reports that the package stays installed.

### Cancel and Restore are different actions

| Action | Result |
|---|---|
| Pause | The run stops at the end of the current operation. It can resume. |
| Cancel | The run stops. The changes stay. |
| Restore | The files return to the state before the run. |

The cancel dialog offers *Keep running*, *Cancel and keep the changes*, and
*Cancel and restore*.

## Orchestration for an epic

To run one task starts one agent. To run an epic starts an **orchestrator**.

The orchestrator reads the epic and its children. It starts one agent for each
child task.

- The orchestrator uses its own model, normally one level above the workers. The
  setting is `modelRouting.orchestrator`. See
  [11 — Models and limits](11-models-and-limits.md).
- Each child task has its own run record, its own operations, and its own
  approvals. One failure belongs to one child task.
- The orchestrator obeys `dependsOn` between children. See
  [05 — Dependencies](05-dependencies.md).
- The number of concurrent child agents is `maxOrchestratorWorkers`. The default
  is 1. See [10 — Execution safety](10-execution-safety.md).
- Approvals show which child task raised them. The dock shows child runs under
  the parent run.
- The safety policy of the epic applies to all children. When the epic policy
  and the child policy differ, the stricter policy applies. A child cannot
  receive more permission from its parent.
- To cancel the orchestrator stops new work and cancels the running children.
  Completed child tasks stay complete.

**The user can always run one child task alone.** The child runs as a normal
single run. The orchestrator does not start.

## Scheduled runs

A task can hold a schedule. When the schedule fires, the service puts the task
in the queue as a normal run. The run obeys the same safety policy and the same
caps.

```
Schedule {
  type        once | cron
  at          ISO-8601        for type = once
  expression  "0 20 * * 5"    for type = cron
  timezone    "America/Sao_Paulo"
  enabled     boolean
  lastRunAt / nextRunAt
}
```

The schedule belongs to the task. A run from a schedule has
`trigger: "schedule"` in its record.

## Credentials

The service does not store an API key. It does not show a field for an API key.

The Anthropic SDKs read the credentials from the environment:
`ANTHROPIC_API_KEY`, or a profile from `ant auth login` in
`~/.config/anthropic/`.

The service reads what the shell that started it can read. At start, the service
reports "no Anthropic credentials found" if it finds none.

## Related documents

- [10 — Execution safety](10-execution-safety.md)
- [11 — Models and limits](11-models-and-limits.md)
- [07 — User interface](07-user-interface.md)

# 10 — Execution safety

A run writes files and executes shell commands. This document defines the
limits on that behaviour.

The boundary of the machine is sufficient for reading and writing tasks. It is
not sufficient for executing them.

## 1. The workspace path

Each project has an absolute `workspacePath`.

- A project without a workspace path **cannot run tasks**. The Run control does
  not appear. It is absent, not disabled.
- The service resolves every path to its canonical form. It then verifies that
  the path is inside the root.
- The service refuses `..` segments, symbolic links that leave the root, and
  absolute paths outside the root.

This rule is not a setting. The user cannot disable it.

## 2. The deny list

The deny list is the lowest level of the policy. The service checks it first.

```jsonc
"denyList": ["rm -rf /", "git push --force"]
```

- The deny list applies in **every mode**, and this includes *Allow everything*.
- A task **cannot** override the deny list.
- There is no control to approve a denied operation.

To execute a denied command, the user edits the deny list in project settings.
This step moves the decision away from an approval prompt at night. The user
sees the pattern and makes a deliberate change.

### A denied operation does not stop the run

The permission callback returns the refusal to the model with the reason. The
model then continues. It can select a different method.

The service records the operation with the status `denied`.

A denied command must not end the run. If it ends the run, users disable the
deny list to complete their work.

## 3. The three modes

```jsonc
"safety": {
  "denyList": [ "rm -rf /", "git push --force" ],
  "mode":     "ask_all",        // allow_all | ask_all | ask_listed
  "dryRun":   false,
  "askList":  [ "git push", "git commit", "rm *", "npm publish",
                "curl *", "*.env", "docker *" ]
}
```

| Mode | Behaviour for operations that the deny list permits |
|---|---|
| **Allow everything** | Every operation executes. There are no prompts. |
| **Ask everything** | Every operation waits for approval. This includes read operations. **This is the default.** |
| **Ask for listed actions** | Every operation executes, except an operation that matches the ask list. That operation waits for approval. |

### The ask list asks. It does not refuse.

The ask list stops an operation and shows it to the user. The user answers at
that moment. The run continues after the answer.

The deny list refuses. These are two different mechanisms.

## 4. Per-task override

A task has a `safety` value. The normal value is `null`, which means "use the
project policy".

The user overrides the **mode** for one task. Examples: a difficult refactor
uses *Ask everything*; a known routine task uses *Allow everything*.

The deny list is not part of the override. Only project settings change it.

The interface shows an inherited value and an overridden value in different
styles.

## 5. Concurrency

```
maxConcurrentRuns          1     per project
maxOrchestratorWorkers     1     child agents in one epic
```

Both settings default to 1.

**This is a correctness rule, not a performance setting.** Every agent writes to
the same filesystem. Two agents in one workspace interleave their writes. They
overwrite the work of each other. Neither agent detects the problem, because
each one reads a file that it did not write.

### The boundary is the workspace, not the machine

Two projects with different workspace paths write to different trees. They run
at the same time without conflict.

Therefore the dock can show Task Manager, Homelab, and RCX Briefings all
running. The service enforces the limit for each project.

If two projects use the same root, set a lower limit on one of them, or combine
them into one project.

### When to raise the limit

Raise `maxOrchestratorWorkers` when the child tasks of an epic change different
files. The service cannot verify that claim. The settings text states this.

## 6. Other controls

- **Dry run.** The agent executes in the normal way. The service shows every
  operation and every file difference. The service applies nothing.
- **Restore.** The files return to the state before the run. See
  [09 — AI run](09-ai-run.md).
- **Cancel.** The run stops. The changes stay, unless the user selects
  *Cancel and restore*.

## Related documents

- [09 — AI run](09-ai-run.md)
- [11 — Models and limits](11-models-and-limits.md)
- [12 — Project settings](12-project-settings.md)

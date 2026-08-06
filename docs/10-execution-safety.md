# 10 — Execution safety

A run writes files and executes shell commands. This document defines the
limits on that behaviour.

The boundary of the machine is sufficient for reading and writing tasks. It is
not sufficient for executing them.

## 1. The network boundary

The API starts runs. A run executes shell commands. Therefore the first limit
is on who can send a request.

### The service binds to the loopback interface

The service binds to `127.0.0.1:4400`. It does not bind to `0.0.0.0`. No other
machine reaches the port. This address is not a setting.

### The machine boundary does not stop a web page

A web page in the browser of the user runs on the same machine. The page can
send a request to `127.0.0.1:4400`. The machine boundary permits it.

Two attacks use this path:

| Attack | Method |
|---|---|
| DNS rebinding | A hostile name resolves to `127.0.0.1` after its record expires. The browser then treats the service as same-origin, and the page reads the responses. |
| Cross-site request | A page on another origin sends a request. The browser hides the response, but the service already performed the action. |

### Three checks on every request

The service applies these checks before it routes a request. A request that
fails a check gets `403` with the code `ORIGIN_REJECTED`.

1. **Host.** The `Host` header must be `localhost:4400` or `127.0.0.1:4400`.
   This check stops DNS rebinding, because the hostile name stays in the
   header.
2. **Origin.** A request with an `Origin` header must give an allowed origin.
   The allowed origins are `http://localhost:4400` and `http://127.0.0.1:4400`.
   A request **without** an `Origin` header passes. A browser always sends the
   header on a cross-origin request. A local script sends no header.
3. **Content type.** A request with a body must send
   `Content-Type: application/json`. A form in a browser cannot send this type.
   Therefore the browser must send a preflight request, and the preflight fails
   check 2.

The service sends no `Access-Control-Allow-Origin` header for any other origin.

### The service has no token

A bearer token gives more strength. It also makes every local script store a
secret. The three checks stop both attacks, and they cost the user nothing.
Add a token only if a program needs to reach the service from another machine.
That need changes the scope of the project. See
[01 — Overview](01-overview.md).

## 2. The workspace path

Each project has an absolute `workspacePath`.

- A project without a workspace path **cannot run tasks**. The Run control does
  not appear. It is absent, not disabled.
- The service resolves every path to its canonical form. It then verifies that
  the path is inside the root.
- The service refuses `..` segments, symbolic links that leave the root, and
  absolute paths outside the root.

This rule is not a setting. The user cannot disable it.

## 3. The deny list

The deny list is the lowest level of the policy. The service checks it first.

```jsonc
"denyList": ["rm -rf /*", "git push --force*"]
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

## 4. The three modes

```jsonc
"safety": {
  "denyList": [ "rm -rf /*", "git push --force*" ],
  "mode":     "ask_all",        // allow_all | ask_all | ask_listed
  "askList":  [ "git push*", "git commit*", "rm *", "npm publish*",
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

### The pattern language

An entry in the deny list and in the ask list is a glob pattern.

- The service matches a pattern against two strings: the full command of a
  `bash` operation, and the target path of a file operation. A match on either
  string applies the entry.
- The service normalizes the command before the match. It trims the ends and
  collapses repeated spaces.
- `git push*` matches `git push --force`. `*.env` matches `prod.env`.

The two lists are guardrails against accidents. They are not a boundary against
a determined model. A model can compose a command that a pattern does not
match. The mode is the boundary. *Ask everything* shows every operation to the
user.

### An approval has no time limit

An operation that waits for approval waits until the user answers. The service
does not cancel it and does not approve it. The run holds its position, its
context, and its concurrency slot while it waits. The dock shows the run in the
state "needs you".

## 5. Per-task override

A task has a `safety` value. The normal value is `null`, which means "use the
project policy".

The user overrides the **mode** for one task. Examples: a difficult refactor
uses *Ask everything*; a known routine task uses *Allow everything*.

The deny list is not part of the override. Only project settings change it.

The interface shows an inherited value and an overridden value in different
styles.

## 6. Concurrency

```
maxConcurrentRuns    1     per project. The default is 1.
```

**One number controls all agents that write in one project.** This includes
the child agents of an epic. The orchestrator of an epic does not count. It is
a scheduler. It does not write files. See [09 — AI run](09-ai-run.md).

**This is a correctness rule, not a performance setting.** Every agent writes to
the same filesystem. Two agents in one workspace interleave their writes. They
overwrite the work of each other. Neither agent detects the problem, because
each one reads a file that it did not write.

One number describes the real constraint, which is the count of agents that
write to one workspace. Two numbers for one constraint permit a configuration
that corrupts files.

### The boundary is the workspace, not the machine

Two projects with different workspace paths write to different trees. They run
at the same time without conflict.

Therefore the dock can show PAIM, Homelab, and RCX Briefings all
running. The service enforces the limit for each project.

If two projects use the same root, set a lower limit on one of them, or combine
them into one project.

### When to raise the limit

Raise `maxConcurrentRuns` when the tasks that run together change different
files. This is most common for an epic whose child tasks touch separate
modules.

The service cannot verify that the files are separate. The settings text states
this.

## 7. Other controls

- **Restore.** The files return to the state before the run. See
  [09 — AI run](09-ai-run.md).
- **Cancel.** The run stops. The changes stay, unless the user selects
  *Cancel and restore*.

## Related documents

- [09 — AI run](09-ai-run.md)
- [11 — Models and limits](11-models-and-limits.md)
- [12 — Project settings](12-project-settings.md)

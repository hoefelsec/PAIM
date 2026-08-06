# 01 — Overview

## Purpose

PAIM is the Project AI Manager. It holds and executes the work of one person
across many projects. It runs on one machine. One process serves the REST API,
the HTML interface, and the event streams on one port.

## Users of the service

The service has three users. Each one uses a different interface.

| User | Interface | Typical actions |
|---|---|---|
| Other local programs, scripts, and agents | REST over HTTP | Read tasks. Create tasks. Change a status. Mark a task done. |
| The person | HTML in a browser | Sort tasks. Edit tasks. Read documents. Approve work. |
| Claude | The Anthropic API, which the service calls | Write structured tasks from free text. Execute tasks in the workspace path. |

Programs and the person have equal rights on the data. The service has no login
and no permission model for them. The boundary of the machine is the boundary of
security for the data.

Claude has a different position. Claude changes files and runs commands.
Therefore Claude has an additional boundary: a workspace path for each project
and an approval policy. See [10 — Execution safety](10-execution-safety.md).

## The service is reachable only from this machine

The service binds to `127.0.0.1:4400`. It does not bind to `0.0.0.0`. No other
machine reaches the port.

The browser of the user is on this machine. Therefore the machine boundary
alone does not stop a hostile web page. The service adds three header checks on
every request: `Host`, `Origin`, and `Content-Type`. These checks stop DNS
rebinding and cross-site requests. The API has no token. See
[10 — Execution safety](10-execution-safety.md).

A program on another machine cannot use this service. That limit is part of the
design.

## Size of the data

| Item | Maximum | Typical |
|---|---|---|
| Projects | 100 | 12 active |
| Tasks in one project | 1000 | 100 open |
| Total tasks | 100 000 | — |

SQLite is the single store of the data. The service has no separate cache of
the tasks. The size is small for a local database. See
[14 — Scope and operations](14-scope-and-operations.md).

## Out of scope

The service does not do these things:

- Work for more than one person. It has no accounts and no permissions.
- Run on a public network. It runs on `localhost`.
- Track time, story points, sprints, or costs for invoices.
- Send email or chat messages.
- Show a board view, a list view, or a calendar. The table is the only view.
- Import data from Jira or ClickUp.

## Related documents

- [02 — Data model](02-data-model.md)
- [07 — User interface](07-user-interface.md)
- [10 — Execution safety](10-execution-safety.md)

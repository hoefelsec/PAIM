# 14 — Scope and operations

## Release 1

The service must do all of this before release 1.

**Projects and tasks**

- Create, edit, archive, and delete a project. The project grid.
- The workspace switcher.
- Full create, read, update, and delete for tasks.
- Core fields, custom fields, and the status pipeline.

**Interface**

- The task table with the temporary filter rail and saved views.
- The task view with tabs.
- Icons for priority, type, and difficulty.
- The stats band with the three usage meters and their caps.
- The activity dock with pause and cancel.
- Selection and the bulk action bar.

**AI**

- Compose: free text to a draft task.
- Merge tasks into an epic.
- Suggested order.
- Runs with the Agent SDK, the approval control, differences, and run history.
- Restore points.
- Model routing from a nominated field.
- Epic orchestration.

**Pipeline gates**

- Open questions.
- Design options.
- Tests: the regression suite and task tests.
- AI review and manual review.

**Other**

- Dependencies and re-evaluation.
- Scheduled runs.
- Project documents from `docs/`.
- The full REST API. See [06 — REST API](06-rest-api.md).
- Server-Sent Events for the interface and for runs.
- Example data and an OpenAPI description.

## Release 1.5

- Comments on a task.
- A log of what changed and when. It has no actor.
- Task-to-task references that are not dependencies.
- A view of open tasks across all projects.
- File attachments.
- Compose in place: describe a change to an existing task in free text.
- A reusable prompt prefix for each project.

## Not planned

Recurring tasks that create new tasks. Dependency graphs. Gantt charts.
Automation rules. Webhooks. Task templates. Import from Jira or ClickUp.

---

## Technical stack

| Layer | Choice |
|---|---|
| Language | TypeScript on the server and the client. The `Task`, `FieldDef`, and `Run` types are shared. |
| Server | Fastify. It serves the REST API, the built interface, and the event streams on one port. |
| Storage | SQLite through `better-sqlite3`. JSON columns hold the `fields` object. |
| Validation | Zod. The service builds one schema per project and caches it. |
| AI — compose | `@anthropic-ai/sdk`. `messages.parse()` with `zodOutputFormat`. Model `claude-opus-5`. |
| AI — run | `@anthropic-ai/claude-agent-sdk`. Built-in file and shell tools. The `canUseTool` callback is the approval control. |
| Interface | React, Vite, and Tailwind. Radix, cmdk, and TanStack Query. |

The two Anthropic packages are different products.

- `@anthropic-ai/sdk` is the Messages API client. One request returns one
  structured response. The compose step uses it.
- `@anthropic-ai/claude-agent-sdk` is Claude Code as a library. It supplies the
  agent loop and the tools. Runs use it.

### Storage detail

Core task columns are separate columns with indexes. The `fields` object is a
JSON column. The service creates an index on a JSON path when a custom field
needs one.

```sql
-- The service indexes a custom field without a schema change.
CREATE INDEX ix_layer ON tasks (json_extract(fields, '$.layer'));
```

## Operational requirements

- **One command starts the service.** `npm start` serves the API and the
  interface on one port. Docker is not necessary. An external database is not
  necessary.
- **The data is in one directory.** The user copies one folder to make a backup.
- **The service survives a crash.** A `kill -9` during a write must not corrupt
  the store.
- **The service is fast.** The 99th percentile for a list query of 1000 tasks is
  under 30 milliseconds. The interface responds to input in under 100
  milliseconds.
- **The service starts in under one second.**
- **Runs are the only slow operation.** A run takes minutes. No other operation
  waits for a run. Runs execute outside the request and report over
  Server-Sent Events.
- **The service runs on macOS and on Linux.**

## Related documents

- [06 — REST API](06-rest-api.md)
- [09 — AI run](09-ai-run.md)
- [15 — Open questions](15-open-questions.md)

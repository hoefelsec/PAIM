# 06 — REST API

Base path: `http://localhost:4400/api`. All requests and responses use JSON. The
project slug identifies the project in the path.

## Access

The service listens on `127.0.0.1:4400`. Only a program on this machine can
reach it. There is no token and no login.

Every request must satisfy three header rules:

| Header | Rule |
|---|---|
| `Host` | `localhost:4400` or `127.0.0.1:4400` |
| `Origin` | Absent, or `http://localhost:4400`, or `http://127.0.0.1:4400` |
| `Content-Type` | `application/json` on every request that has a body |

A request that breaks a rule gets `403` with the code `ORIGIN_REJECTED`. A
script that sends no `Origin` header always passes. These rules keep a web page
in the browser away from the API. See
[10 — Execution safety](10-execution-safety.md).

## Response format

Every list response uses this envelope:

```jsonc
{ "data": [ … ], "meta": { "total": 143, "cursor": "…", "hasMore": true } }
```

Every error response uses this envelope:

```jsonc
{ "error": { "code": "FIELD_UNKNOWN", "message": "…", "details": { "key": "…" } } }
```

The `code` value is stable. Client programs read `code`. The `message` value is
for a person.

## Projects

```
GET    /api/projects                        ?status=active|archived|all
POST   /api/projects
GET    /api/projects/:project
POST   /api/projects/:project               partial update
DELETE /api/projects/:project               ?force=true if the project has tasks
GET    /api/projects/:project/schema        fieldSchema and statuses
POST   /api/projects/:project/schema        add or change field definitions
```

## Tasks

```
GET    /api/projects/:project/tasks         list, filter, sort, paginate
POST   /api/projects/:project/tasks         create
GET    /api/projects/:project/tasks/:key    read one task
POST   /api/projects/:project/tasks/:key    partial update
PATCH  /api/projects/:project/tasks/:key    same as POST
DELETE /api/projects/:project/tasks/:key    ?hard=true to skip the trash
GET    /api/projects/:project/trash         tasks in the trash
POST   /api/projects/:project/trash/:key    restore a task from the trash
POST   /api/projects/:project/tasks/bulk    { ids[], patch{} }
```

`:key` accepts the task key, for example `FEAT-14`, or the UUID.

### Query parameters for the list

```
status=ready,executing        open=true              priority=high,urgent
label=backend                 assignee=edu           parent=FEAT-3
size=M,L                      field.layer=backend    q=free text
updatedSince=<ISO-8601>       sort=-updatedAt,order  limit=50&cursor=…
include=children,comments
```

### Update semantics

A `POST` to a task performs a shallow merge on the core fields and a shallow
merge on the `fields` object.

- `{"fields": {"a": 1}}` does not delete `fields.b`.
- To clear a value, send `null` for that key.
- Send the header `If-Match` with the value of `updatedAt` for a
  compare-and-swap update. Without the header, the last write wins.

## Gates

These endpoints answer the gates of the pipeline. See
[04 — Status pipeline](04-status-pipeline.md).

```
POST /api/projects/:project/tasks/:key/answers       { answers: [{ questionId, answer }] }
POST /api/projects/:project/tasks/:key/design-reply  { optionId } or { text }
POST /api/projects/:project/tasks/:key/review        { verdict, note }
POST /api/projects/:project/tasks/:key/re-evaluate   start a re-evaluation
```

`review` records the verdict of the user for `manual_review`. `re-evaluate`
reads `sourcePrompt` against the current project state and returns a draft. See
[05 — Dependencies and re-evaluation](05-dependencies.md).

## Cross-project

```
GET /api/tasks              ?project=a,b&status=…    query many projects
GET /api/search?q=…         full text over title and description
```

## Saved views

```
GET    /api/projects/:project/views
POST   /api/projects/:project/views
PATCH  /api/projects/:project/views/:view
DELETE /api/projects/:project/views/:view
```

## AI

```
POST /api/projects/:project/tasks/compose      text to a task draft
POST /api/projects/:project/tasks/merge-epic   selected tasks to an epic draft
POST /api/projects/:project/suggest-order      AI order for the open tasks
```

## Runs

```
POST   /api/projects/:project/tasks/:key/runs   start a run
GET    /api/projects/:project/tasks/:key/runs   list the runs of one task
GET    /api/runs/:run                           one run and its operations
GET    /api/runs/:run/stream                    Server-Sent Events
POST   /api/runs/:run/approve                   { operationIds: [ … ] }
POST   /api/runs/:run/deny                      { operationId, reason }
POST   /api/runs/:run/pause
POST   /api/runs/:run/resume
POST   /api/runs/:run/cancel                    { restore: true | false }
POST   /api/runs/:run/restore                   revert the workspace
```

## Activity and usage

```
GET  /api/events                    Server-Sent Events: all data changes
GET  /api/activity                  all runs in all projects
GET  /api/activity/stream           Server-Sent Events
GET  /api/usage                     the metered spend in the three windows, per project
GET  /api/projects/:project/caps
PUT  /api/projects/:project/caps    { fiveHour: 2000000, weekly: 10000000, fable: 2000000 }
```

### The events stream

`GET /api/events` is one stream of all data changes: tasks, projects, schemas,
and saved views. Each event names the record type, the record id, and the kind
of change: `created`, `updated`, or `deleted`. The interface subscribes once
and stays current when other programs write to the store. Scripts can
subscribe too.

## Schedules

```
GET    /api/projects/:project/schedules
PUT    /api/projects/:project/tasks/:key/schedule
DELETE /api/projects/:project/tasks/:key/schedule
```

## Documents

```
GET /api/projects/:project/docs           the file tree of docs/
GET /api/projects/:project/docs/*path     one rendered file, or one asset
```

## Status codes

| Code | Condition |
|---|---|
| 200 | Success |
| 201 | The service created a record |
| 400 | The request is not valid. Examples: `FIELD_UNKNOWN`, `MODEL_NOT_ALLOWED` |
| 403 | `ORIGIN_REJECTED`. The request breaks a header rule. See "Access" above. |
| 404 | The service did not find the record |
| 409 | A conflict. Examples: `BUDGET_CAP_REACHED`, `DEPENDENCY_NOT_MET`, `IF_MATCH_FAILED` |
| 422 | The request is valid but the service cannot process it |

A run request returns `409 BUDGET_CAP_REACHED` when a cap stops it. The response
gives the window and the time of the reset. Add `?ignoreCaps=true` to bypass the
cap.

## The trash

A `DELETE` on a task moves the task to the trash. The task stays there for
`trashRetentionDays`. The default is 30 days. After that period the service
deletes the task permanently.

Add `?hard=true` to delete a task at once and skip the trash.

## Related documents

- [03 — Custom fields](03-custom-fields.md)
- [09 — AI run](09-ai-run.md)
- [11 — Models and limits](11-models-and-limits.md)

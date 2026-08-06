# 06 — REST API

Base path: `http://localhost:4400/api`. All requests and responses use JSON. The
project slug identifies the project in the path.

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
POST   /api/projects/:project/tasks/bulk    { ids[], patch{} }
```

`:key` accepts the task key, for example `TM-14`, or the UUID.

### Query parameters for the list

```
status=ready,executing        open=true              priority=high,urgent
label=backend                 assignee=edu           parent=TM-3
size=M,L                      field.difficulty=hard  q=free text
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
GET  /api/activity                  all runs in all projects
GET  /api/activity/stream           Server-Sent Events
GET  /api/usage                     the three usage windows
GET  /api/projects/:project/caps
PUT  /api/projects/:project/caps    { fiveHour: 70, weekly: 85, fable: 50 }
```

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
| 400 | The request is not valid |
| 404 | The service did not find the record |
| 409 | A conflict. Examples: `BUDGET_CAP_REACHED`, `DEPENDENCY_NOT_MET`, `IF_MATCH_FAILED` |
| 422 | The request is valid but the service cannot process it |

A run request returns `409 BUDGET_CAP_REACHED` when a cap stops it. The response
gives the window and the time of the reset. Add `?ignoreCaps=true` to bypass the
cap.

## Related documents

- [03 — Custom fields](03-custom-fields.md)
- [09 — AI run](09-ai-run.md)
- [11 — Models and limits](11-models-and-limits.md)

# 08 — AI compose

The service uses Claude for three text operations. All three return a draft. The
user confirms the draft. The service does not write a record before the user
confirms.

## 1. Compose a task from text

The service has no form for a new task. It has a text box. The user describes
the work in any words. Claude maps the text onto the schema of the workspace.

```
POST /api/projects/:project/tasks/compose
{
  "text": "the api pagination thing is broken again, cursor resets on the
           second page. probably a day of work, blocking the CLI release"
}
```

Response:

```jsonc
{
  "draft":     { "title": "…", "description": "…", "priority": "urgent",
                 "size": "L", "fields": { "type": "bug", "layer": "backend" },
                 "dependsOn": [ … ] },
  "questions": [ … ],      // if Claude needs more information
  "warnings":  [ "No value inferred for assignee" ]
}
```

### The schema builds the prompt

The service builds the extraction schema from the project's `fieldSchema`. This
is the same source that validates writes. See
[03 — Custom fields](03-custom-fields.md).

A workspace with a `layer` field receives a layer value. A workspace
without that field never sees it. The service needs no prompt text for each
project.

```ts
const Draft = zodFromFieldSchema(project);   // same source as write validation
const res = await claude.messages.parse({
  model: "claude-opus-5",
  max_tokens: 4096,
  system: composerPrompt(project),           // stable, so the API caches it
  messages: [{ role: "user", content: text }],
  output_config: { format: zodOutputFormat(Draft) },
});
res.parsed_output;                           // a validated, typed draft
```

The system prompt is stable for one project. The service marks it with
`cache_control`. The field definitions are most of the tokens and they do not
change between calls.

### The result is a draft

The interface shows the values that Claude inferred. Each value is editable. The
service creates the task when the user selects Create.

A value that Claude cannot infer stays empty. The response says which value is
empty and why. The service does not guess a value.

Add `?commit=true` to create the task without review. Scripts use this
parameter.

### The compose step selects the first status

The compose step decides which gates the task needs.

| Result | First status of the task |
|---|---|
| Claude returns questions | `open_questions` |
| Claude reports that a decision must precede the work | `design` |
| Neither of the above | `ready` |

A project can enable `open_questions` and `design`. A task uses them only when
it needs them. See [04 — Status pipeline](04-status-pipeline.md).

### Dependencies and tests

The same pass finds dependencies on other tasks in the same project. See
[05 — Dependencies](05-dependencies.md).

The same pass also drafts the task-specific tests. See
[04 — Status pipeline](04-status-pipeline.md).

---

## 2. Merge tasks into an epic

```
POST /api/projects/:project/tasks/merge-epic
{ "taskIds": [ … ] }
```

This operation uses the compose pipeline with different input and different
output. The input is the selected tasks. The output is their parent.

Claude drafts:

- a title;
- a description of the shared goal;
- values for the epic's own fields.

Rules for the fields of the new epic:

| Field | Rule |
|---|---|
| `priority` | The highest priority of the children. |
| `size` | `Epic`. |
| `type`, `layer`, and other `select` fields | The common value, if all children agree. Empty if they do not agree. |

The response is a draft. The interface shows the proposed epic and the list of
tasks to re-parent. The service changes nothing until the user confirms.

---

## 3. Suggested order

```
POST /api/projects/:project/suggest-order
```

Response:

```jsonc
{
  "order":      [ "FEAT-3", "BUG-12", … ],
  "rationale":  [ { "key": "FEAT-3", "because": "…" } ],
  "computedAt": "…"
}
```

Claude reads the open tasks. Claude orders them by their effect on each other.
Work that changes the shape of a later task comes first. This order prevents
duplicate work.

Rules:

- The order is a snapshot. The service stamps it with `computedAt`.
- When the task set changes, the sort control shows that the order is old. The
  service does not reorder the table without a command.
- Each position has one line of reason in `rationale`.
- The order does not filter and does not hide any task.

## Model

All three operations use `claude-opus-5`.

## Related documents

- [03 — Custom fields](03-custom-fields.md)
- [04 — Status pipeline](04-status-pipeline.md)
- [11 — Models and limits](11-models-and-limits.md)

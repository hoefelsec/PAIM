# 11 — Models and limits

## Model routing

Each task runs on a **model** at an **effort** level. Both values are on the
task. Both are normally `null`, which means "the service selects the value".

### The routing configuration

The project nominates one routing field. The field is `size` or any custom
`select` field. The project then maps the values of that field.

```jsonc
"modelRouting": {
  "field": "size",                   // size, a custom select field, or null
  "map": {
    "XS": { "model": "claude-haiku-4-5", "effort": "low"    },
    "S":  { "model": "claude-sonnet-5",  "effort": "medium" },
    "M":  { "model": "claude-opus-5",    "effort": "high"   },
    "L":  { "model": "claude-opus-5",    "effort": "xhigh"  },
    "XL": { "model": "claude-opus-5",    "effort": "xhigh"  }
  },
  "fallback": { "model": "claude-opus-5", "effort": "high" }
}
```

The service cannot hard-code the routing to one field, because most candidate
fields are custom. The project nominates the field. This rule matches the rule
for table columns and for filter facets: the schema drives the product.

A project with no routing field sends every task to `fallback`.

### Rules

- The user can override the model and the effort for one task.
- The interface shows an inherited value and an overridden value in different
  styles.
- A change to the routing field re-routes the task, unless the user fixed the
  value on that task.
- The orchestrator of an epic is a scheduler, not a model. It has no routing
  entry. See [09 — AI run](09-ai-run.md).

### Available models

| Model | Use |
|---|---|
| `claude-opus-5` | The default. Complex coding and agent work. |
| `claude-fable-5` | The highest capability. It has a separate usage limit. |
| `claude-sonnet-5` | High speed with near-Opus quality. |
| `claude-haiku-4-5` | Fast and low cost. Simple tasks. |

`allowedModels` in project settings limits which models a project may use.

### Effort

`effort` has five values: `low`, `medium`, `high`, `xhigh`, `max`.

`xhigh` gives the best result for coding and agent work. `low` and `medium` are
the main controls for cost.

**The interface never shows `effort` alone.** It always shows the effort joined
to the model, for example `claude-opus-5 · xhigh`. An effort value has no
meaning without the model that spends it.

---

## Usage metering

The service meters its own runs. Each run records `inputTokens`,
`outputTokens`, and `costUsd`. See [09 — AI run](09-ai-run.md). The meters and
the caps read these records and nothing else.

The account of the user also has usage windows on the side of Anthropic. The
service has no confirmed source for that data. This is an open question. The
service does not build on account-level data until the question is closed. See
[15 — Open questions](15-open-questions.md).

The stats band shows three windows.

| Window | Definition |
|---|---|
| **5-hour** | The window starts at the first run after the previous window ends. It ends 5 hours after that start. |
| **Weekly** | The window starts on Monday at 00:00 in the timezone of the service. |
| **Fable** | The tokens of `claude-fable-5` inside the weekly window. |

## Caps

A cap is a token budget for one project and one window. The user sets it in
project settings. A project without a cap has no limit from the service.

```
PUT /api/projects/:project/caps
{ "fiveHour": 2000000, "weekly": 10000000, "fable": 2000000 }
```

**The service stops runs at the cap.** The purpose is to keep capacity for
other work. The user decides the budget of this project, and the service
enforces it.

### Rules

- Caps are per project. A test project can have a low cap.
- A cap **stops a new run**. The API returns `409 BUDGET_CAP_REACHED` with the
  window and the time when the window ends.
- A cap **pauses a running run**. The run pauses at the end of the current
  operation. It never pauses in the middle of an operation.
- A paused run **resumes automatically** when the window ends. The run keeps
  its context and its position.
- The Fable cap applies to routing. When the Fable cap is reached, a task that
  routes to `claude-fable-5` cannot start. Tasks that route to other models
  continue.
- To bypass a cap, add `?ignoreCaps=true` to the run request.

### No warning banner

The meters in the stats band are the only notification. The service shows no
banner and no toast.

A meter in the warning colour on every screen already reports the state. A
second message is the same fact twice.

### The Fable meter is conditional

The service hides the Fable meter when `allowedModels` excludes
`claude-fable-5`. A meter for a limit that the project cannot reach is noise.

The other two meters always appear.

## Related documents

- [09 — AI run](09-ai-run.md)
- [07 — User interface](07-user-interface.md)
- [12 — Project settings](12-project-settings.md)

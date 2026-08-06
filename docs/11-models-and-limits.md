# 11 — Models and limits

## Model routing

Each task runs on a **model** at an **effort** level. Both values are on the
task. Both are normally `null`, which means "the service selects the value".

### The routing configuration

The project nominates one `select` field as the routing field. The project then
maps the options of that field.

```jsonc
"modelRouting": {
  "field": "difficulty",             // any select field, or null
  "map": {
    "trivial":  { "model": "claude-haiku-4-5", "effort": "low"    },
    "easy":     { "model": "claude-sonnet-5",  "effort": "medium" },
    "moderate": { "model": "claude-opus-5",    "effort": "high"   },
    "hard":     { "model": "claude-opus-5",    "effort": "xhigh"  }
  },
  "fallback":     { "model": "claude-opus-5", "effort": "high" },
  "orchestrator": { "model": "claude-opus-5", "effort": "max"  }
}
```

`difficulty` is a custom field. Therefore the service cannot hard-code the
routing to it. The project nominates the field. This rule matches the rule for
table columns and for filter facets: the schema drives the product.

A project with no routing field sends every task to `fallback`.

### Rules

- The user can override the model and the effort for one task.
- The interface shows an inherited value and an overridden value in different
  styles.
- A change to the routing field re-routes the task, unless the user fixed the
  value on that task.
- The orchestrator of an epic uses `modelRouting.orchestrator`. It normally uses
  a higher level than the workers. To plan across seven child tasks is a harder
  problem than each single task.

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

## Usage limits

The service uses the credentials of the user. Those credentials have usage
windows. The stats band shows three windows.

| Window | Content |
|---|---|
| **5-hour** | The short window. It resets continuously. |
| **Weekly** | The weekly total for all models. |
| **Fable** | The separate total for `claude-fable-5`. |

## Caps

Each meter has a **cap marker**. The user moves the marker. The cap is below the
hard limit.

```
PUT /api/projects/:project/caps
{ "fiveHour": 70, "weekly": 85, "fable": 50 }
```

**The service stops runs at the cap, not at the hard limit.** The purpose is to
keep capacity for other work. The user decides that this project can use 70% of
the window and no more.

### Rules

- Caps are per project. A test project can have a low cap.
- A cap **stops a new run**. The API returns `409 BUDGET_CAP_REACHED` with the
  window and the reset time.
- A cap **pauses a running run**. The run pauses at the end of the current
  operation. It never pauses in the middle of an operation.
- A paused run **resumes automatically** when the window resets. The run keeps
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

## Related documents

- [09 — AI run](09-ai-run.md)
- [07 — User interface](07-user-interface.md)
- [12 — Project settings](12-project-settings.md)

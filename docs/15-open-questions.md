# 15 — Open questions

**No decisions are outstanding.** The specification is complete.

This document holds questions that block or change an implementation. Add an
item here when you find one. Remove the item when the decision is made, and
write the decision into the document that owns the subject.

## What belongs in this document

An item belongs here if all of these are true:

- An implementation must select an answer.
- The specification does not state the answer.
- The choice changes behaviour, data, or the interface.

An item does **not** belong here if it is a task. Put work in the task manager,
not in the specification.

## Format for an item

```markdown
## N. The question in one sentence

A short statement of the problem. Say which document the answer belongs in.

**Options**

| Option | Result |
|---|---|
| A. … | … |
| B. … | … |

**Recommendation: X.** One or two sentences of reason.
```

## Values that need a test with real data

These values have an answer. The answer is a first estimate. Measure them
against real use and change them if the measurement disagrees.

| Value | Current | Document |
|---|---|---|
| Staleness after time | 14 days | [05](05-dependencies.md) |
| Staleness after project change | 10 tasks reached `done` | [05](05-dependencies.md) |
| Trash retention | 30 days | [06](06-rest-api.md) |
| Concurrent runs for one project | 1 | [10](10-execution-safety.md) |

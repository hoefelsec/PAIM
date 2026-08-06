# 15 — Open questions

**Two questions are open.** Do not build the features that they block until
the decision is made.

This document holds questions that block or change an implementation. Add an
item here when you find one. Remove the item when the decision is made, and
write the decision into the document that owns the subject.

## What belongs in this document

An item belongs here if all of these are true:

- An implementation must select an answer.
- The specification does not state the answer.
- The choice changes behaviour, data, or the interface.

An item does **not** belong here if it is a task. Put work in PAIM, not in the
specification.

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

## 1. Where does account-level usage data come from?

The caps and the meters read the service's own run records. See
[11 — Models and limits](11-models-and-limits.md). The account of the user has
real usage windows on the side of Anthropic. No confirmed public API reports
them for subscription credentials.

**Do not build any feature on account-level data until this is investigated.**

**Options**

| Option | Result |
|---|---|
| A. Find and use a usage endpoint for the credentials | The meters show real account state. |
| B. Ship without account data | The meters show only the metered spend of the service. |

**Recommendation: B now, investigate A.** The project caps work without
account data.

## 2. How do project caps relate to the shared account windows?

Related to question 1. Caps are token budgets per project. The account windows
are shared across all projects and across work outside this service. Three
projects with generous caps can together exhaust the account window. The
relation between the two stays undefined until question 1 is answered. The
answer belongs in [11 — Models and limits](11-models-and-limits.md).

## Decisions that are made

| Question | Decision | Document |
|---|---|---|
| How does the service protect the API from the browser? | Bind to `127.0.0.1`. Check the `Host`, `Origin`, and `Content-Type` headers. No token. | [10 §1](10-execution-safety.md), [06](06-rest-api.md) |

## Values that need a test with real data

These values have an answer. The answer is a first estimate. Measure them
against real use and change them if the measurement disagrees.

| Value | Current | Document |
|---|---|---|
| Staleness after time | 14 days | [05](05-dependencies.md) |
| Staleness after project change | 10 tasks reached `done` | [05](05-dependencies.md) |
| Trash retention | 30 days | [06](06-rest-api.md) |
| Concurrent runs for one project | 1 | [10](10-execution-safety.md) |

# Task Manager — specification index

Task Manager is a local task service. It runs one process on `localhost`. It
gives a REST API to other programs and an HTML interface to the user. It uses
Claude to write tasks and to do the work in those tasks.

## How to read these documents

Read the documents in order for the full specification. Read one document alone
to understand one subject. Each document is complete for its subject. Each
document gives links to related documents.

| # | Document | Subject |
|---|---|---|
| 01 | [overview.md](01-overview.md) | Purpose, users, limits of scope |
| 02 | [data-model.md](02-data-model.md) | Project, task, epic, comment |
| 03 | [custom-fields.md](03-custom-fields.md) | Per-project fields and their rules |
| 04 | [status-pipeline.md](04-status-pipeline.md) | Statuses and the conditions to advance |
| 05 | [dependencies.md](05-dependencies.md) | Task dependencies and re-evaluation |
| 06 | [rest-api.md](06-rest-api.md) | Endpoints and response format |
| 07 | [user-interface.md](07-user-interface.md) | Screens, layout, controls |
| 08 | [ai-compose.md](08-ai-compose.md) | Text to task, suggested order, merge to epic |
| 09 | [ai-run.md](09-ai-run.md) | Task execution, orchestration, restore |
| 10 | [execution-safety.md](10-execution-safety.md) | Permissions, limits, concurrency |
| 11 | [models-and-limits.md](11-models-and-limits.md) | Model selection and usage limits |
| 12 | [project-settings.md](12-project-settings.md) | The configuration surface |
| 13 | [design-language.md](13-design-language.md) | Colour, type, spacing, motion |
| 14 | [scope-and-operations.md](14-scope-and-operations.md) | Release scope and technical stack |
| 15 | [open-questions.md](15-open-questions.md) | Decisions that are not yet made |

The rendered screen mockups are in [`../design/mockups.html`](../design/mockups.html).

## Language rules

These documents use ASD-STE100 Simplified Technical English:

- One sentence gives one instruction or one fact.
- Sentences are 25 words or less.
- Paragraphs are 6 sentences or less.
- The text uses the active voice.
- The text uses the present tense.
- The text uses one term for one thing. See the glossary below.

## Glossary

Use these terms. Do not use other terms for the same thing.

| Term | Definition |
|---|---|
| **project** | A container for tasks. It has a name, a slug, and settings. |
| **workspace** | The project that the interface shows. The user selects one project at a time. |
| **workspace path** | The directory on disk that a project controls. Runs and docs use only this directory. |
| **task** | One unit of work. It has a status, fields, and an optional schedule. |
| **epic** | A task with the size `Epic`. Other tasks can be its children. |
| **child task** | A task that has an epic as its parent. |
| **field** | A named value on a task. A field is core or custom. |
| **core field** | A field that all projects have. The user cannot remove it. |
| **custom field** | A field that one project defines. See [03](03-custom-fields.md). |
| **status** | The stage of a task in the pipeline. See [04](04-status-pipeline.md). |
| **gate** | A condition that a task must satisfy to leave a status. |
| **pipeline** | The list of statuses that a project uses. |
| **run** | One execution of a task by Claude. |
| **operation** | One action in a run. Examples: read a file, write a file, run a command. |
| **orchestrator** | The agent that runs an epic. It starts one agent for each child task. |
| **restore point** | The state of the workspace path before a run starts. |
| **facet** | A filter control in the left rail. |
| **view** | A saved set of filters, sort, group, and columns. |
| **dock** | The pane at the bottom of the window. It lists all runs in all projects. |
| **cap** | A usage limit that the user sets. It is below the hard limit. |

## Terms to avoid

| Do not use | Use |
|---|---|
| item, ticket, issue, card | task |
| job, execution, session | run |
| step, action, command | operation |
| folder (for a project) | project or workspace |
| board, list view, kanban | table (the table is the only view) |
| effort (for task size) | size |
| reasoning (for the model parameter) | effort |

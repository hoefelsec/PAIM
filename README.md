# Task Manager

A local task service. One process on `localhost` serves a REST API to other
programs and an HTML interface to the user. It uses Claude to write tasks and to
do the work in those tasks.

## Specification

The specification is in [`docs/`](docs/README.md). Start with
[`docs/README.md`](docs/README.md) for the index, the reading order, and the
glossary.

| Document | Subject |
|---|---|
| [01](docs/01-overview.md) | Purpose, users, limits of scope |
| [02](docs/02-data-model.md) | Project, task, epic |
| [03](docs/03-custom-fields.md) | Per-project fields |
| [04](docs/04-status-pipeline.md) | Statuses and gates |
| [05](docs/05-dependencies.md) | Dependencies and re-evaluation |
| [06](docs/06-rest-api.md) | Endpoints |
| [07](docs/07-user-interface.md) | Screens and controls |
| [08](docs/08-ai-compose.md) | Text to task |
| [09](docs/09-ai-run.md) | Task execution |
| [10](docs/10-execution-safety.md) | Permissions and limits |
| [11](docs/11-models-and-limits.md) | Models and usage |
| [12](docs/12-project-settings.md) | Configuration and documents |
| [13](docs/13-design-language.md) | Colour, type, spacing |
| [14](docs/14-scope-and-operations.md) | Release scope and stack |
| [15](docs/15-open-questions.md) | Decisions that are not yet made |

## Design

Rendered screen mockups: [`design/mockups.html`](design/mockups.html).

## Language

The documents use ASD-STE100 Simplified Technical English. See the language
rules and the glossary in [`docs/README.md`](docs/README.md).

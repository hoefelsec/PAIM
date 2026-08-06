# 07 — AI compose

**Builds on:** 04, 05.
**Source docs:** [08](../docs/08-ai-compose.md), [03](../docs/03-custom-fields.md), [11](../docs/11-models-and-limits.md).

## Goal

The three Messages-API operations — compose, merge-epic, suggested order —
plus the real `Reevaluator` behind spec 05's endpoint. All return drafts;
nothing writes a record until the user confirms.

## Scope

- Anthropic client module using `@anthropic-ai/sdk`:
  `messages.parse()` with `zodOutputFormat`, model `claude-opus-5`,
  per-project system prompt marked `cache_control` (stable across calls —
  the field definitions are most of the tokens). Credentials from the
  environment only; no stored key (docs/09 credentials). Startup logs
  "no Anthropic credentials found" when absent; AI endpoints then return
  `503 AI_UNAVAILABLE`.
- Extraction schema generated from `fieldSchema` via the spec 02 engine —
  same source as write validation. Draft covers title, description,
  priority, size, `fields`, `dependsOn` (existing open tasks are provided as
  context), task tests, plus `questions[]` and a needs-design signal.
- `POST /api/projects/:project/tasks/compose { text }` → draft + questions +
  warnings. `?commit=true` creates the task directly (scripts).
  First status per docs/08: questions → `open_questions`; design needed →
  `design`; else `ready`. `sourcePrompt` = the input text; `evaluatedAt`
  stamped.
- `POST /api/projects/:project/tasks/merge-epic { taskIds }` → epic draft:
  title, shared-goal description, `size: Epic`, priority = highest child,
  select fields = common value or empty. Response includes the re-parent
  list; nothing changes until the client applies it. Merging a task that is
  already an epic or a child → `422 MERGE_INVALID`.
- `POST /api/projects/:project/suggest-order` → `{ order, rationale,
  computedAt }` over open tasks; one `because` line per key; snapshot only —
  the service never reorders.
- Real `Reevaluator` for spec 05: reads `sourcePrompt` + current project
  state, returns the draft shape including `noLongerNeeded`.
- Design-gate resolution ("Claude decides when the status ends", docs/04):
  a design reply triggers a compose-side judgment call that returns either
  `resolved` (task → `ready`) or a follow-up question (task stays).

## Acceptance criteria

- [ ] A project with a `layer` field gets `layer` in drafts; a project
      without it never does — no per-project prompt text (prompt built from
      schema, asserted in a unit test with a mocked client).
- [ ] A value the model cannot infer is absent plus named in `warnings`;
      the service never fills a guess.
- [ ] `?commit=true` creates the task with the compose-selected first status.
- [ ] Merge-epic of three tasks re-parents nothing until the client applies
      the draft.
- [ ] With no credentials, `/compose` → `503 AI_UNAVAILABLE`; all non-AI
      endpoints unaffected.

## Tests

Mock the Anthropic client throughout: schema-driven prompt content, draft
validation failure → retry path, first-status selection matrix, merge field
rules, order snapshot stamping, reevaluator draft shape. One optional live
smoke test gated behind `ANTHROPIC_API_KEY` presence.

## Out of scope

Runs (09), model routing for runs (09/13), UI composer (15).

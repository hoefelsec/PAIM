# 15 — UI: task view & composer

**Builds on:** 07, 09, 14.
**Source docs:** [07](../docs/07-user-interface.md), [04](../docs/04-status-pipeline.md), [09](../docs/09-ai-run.md).

## Goal

The full-screen task view with its pipeline tabs, and the AI composer —
every gate the pipeline defines becomes operable from the browser.

## Scope

- Task view at `/p/:project/t/:key` (+ `/run` deep link): full screen, tabs
  Overview · Questions · Design · Run · Tests · Review in pipeline order;
  a tab renders only when the project pipeline includes the stage.
  Properties column: status, priority, size, type, custom fields, model ·
  effort (inherited vs pinned styled differently, never effort alone),
  dependencies with met/blocked state, schedule.
- Overview: description, stale banner with reason + **Re-evaluate** control
  (shows the returned draft; user applies or discards — applying is the
  only write), original `sourcePrompt` block.
- Questions: open questions with choice chips or free text; answering the
  last one reflects the `ready` + stale marker behaviour; no Run control in
  this status.
- Design: option cards rendering `mockupPath` HTML in sandboxed iframes,
  rationale + cost line, choose/reply; task leaves only when the service
  says resolved.
- Run: operation log colored by risk (docs/13), diffs inline, bash output,
  denied rows struck with reason, pending rows with Approve/Deny, workspace
  path in the header, Restore control (or its unavailable-reason), runfoot
  with model · duration · tokens.
- Tests: summary line, table per TestRun (name, kind, result, time), failing
  output block, Re-run.
- Review: sub-tabs AI review (verdict + reason) / Code review (cumulative
  diff across runs, per-file) / Manual review (summary, falsifiable
  checklist, entry point, Approve / Reject-with-reason).
- Composer at `/p/:project/new`: textbox → compose → draft with every
  inferred value editable, empty values marked with the why, warnings
  strip; Create / Create & run / Discard; model + latency + token footer.
  Focused surface: switcher stays, rail is a back link.
- Merge-into-epic flow from the 14 bulk bar: draft epic + re-parent list,
  nothing applied until confirm.

## Acceptance criteria

- [ ] A project without `testing` shows no Tests tab; enabling it in
      settings adds the tab live.
- [ ] Approving a parked operation from the Run tab resumes the run; the
      dock and tab agree on state via SSE.
- [ ] A design option's HTML mockup renders in its card; choosing it posts
      the reply and the card marks chosen.
- [ ] Rejecting a manual review with a note returns the task to `executing`
      and the note appears on the next run's brief (visible in Run tab).
- [ ] Composer leaves `assignee` empty with an explanation rather than
      guessing (mirrors API warning).
- [ ] Re-evaluate shows a draft diff and writes nothing until Apply.

## Tests

Tab gating by pipeline config; approval round-trip against a fake run
stream; composer draft editing and commit; review verdict flows; mockup
iframe sandboxing (no script escape).

## Out of scope

Dock (16), settings screens (16), docs rendering (16).

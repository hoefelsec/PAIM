# 17 — Packaging & release check

**Builds on:** all previous specs.
**Source docs:** [14](../docs/14-scope-and-operations.md), [15](../docs/15-open-questions.md).

## Goal

Everything release 1 requires beyond features: OpenAPI, example data, the
operational requirements verified, and a final conformance sweep against
`docs/`.

## Scope

- **OpenAPI description** generated from the Zod schemas (route schemas →
  document), served at `GET /api/openapi.json`; CI check that every
  registered route appears in it.
- **Example data**: `npm run seed` creates a demo project with a realistic
  spread — custom fields (`type`, `layer`), an epic with children, tasks in
  every status, a run history with diffs, a schedule, and caps — matching
  the mockups' content so the UI demos itself.
- **Operational verification** (docs/14) as an automated suite:
  - one command (`npm start`) serves everything on one port;
  - start under 1 s; list p99 under 30 ms at 1 000 tasks; input response
    under 100 ms (UI perf smoke);
  - `kill -9` crash-safety re-run against the full schema;
  - data confined to `data/` (backup = copy one folder);
  - runs are the only slow operation: no API endpoint awaits a run.
  - macOS and Linux: CI matrix for both.
- **Conformance sweep**: a checklist audit of every release-1 bullet in
  docs/14 against the running product; discrepancies become fixes or
  documented cuts before tagging v1.
- **Open questions guard**: assert (test) that nothing imports an Anthropic
  account-usage endpoint and that the server binds loopback with the Host
  check — the standing answers to docs/15 Q1/Q3 until they close.

## Acceptance criteria

- [ ] `npx @redocly/cli lint` (or equivalent) passes on the generated
      OpenAPI document; every route is present.
- [ ] Fresh clone → `npm install && npm run seed && npm start` →
      a populated, working product in the browser.
- [ ] The operational suite passes on macOS and Linux CI.
- [ ] The docs/14 release-1 checklist is committed with every line checked
      or explicitly deferred with a note.

## Out of scope

Everything in docs/14 "Release 1.5" and "Not planned".

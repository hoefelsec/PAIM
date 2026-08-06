# 14 — UI: shell & table

**Builds on:** 03, 06. The design system scaffold in `src/ui/` and
`src/styles/tokens.css` is the starting point; `design/mockups.html` is the
visual reference.
**Source docs:** [07](../docs/07-user-interface.md), [13](../docs/13-design-language.md).

## Goal

The application shell (routes, workspace switcher, left rail, stats band,
toolbar) and the task table — live over SSE, filters in the URL, saved
views.

## Scope

- Routes per docs/07: `/` project grid, `/p/:project` table (+ query-string
  filter state), `/p/:project/v/:view`, `/search`. Root never redirects.
- One workspace at a time: switcher (icon, name, open count; archived row;
  settings/new/all entries) scopes everything.
- Left rail on the table screen: facets generated from the schema — core
  facets status/priority/size/labels/assignee plus `select` fields with
  `showAsFacet`; facet heads labelled `core | pipeline | schema`. Rail
  filters the set; toolbar presents it; no control in both.
- Filters are ephemeral URL state; **Save view** promotes filters + sort +
  group + columns to a SavedView; dirty-state dot on divergence.
- Table (the only view): 33 px rows, columns Key · Title · Prio · Type ·
  Size · Updated plus `showInTable` custom fields. Icons per docs/13:
  priority bars (height), size dots (XS–XL = 1–5 of 5, Epic mark), type
  silhouettes from the pool; names on hover; monospace keys.
- Epics expand in place: disclosure triangle, `n/m done` (+ cancelled
  count), indented children, expansion is view state.
- Sort options incl. **Suggested** (calls spec 07's endpoint; snapshot with
  stale marker; one-line reason per position; never auto-reorders).
- Editing: click-in-place, optimistic with reconcile, rejected write flashes
  clay and reverts. Live updates from `/api/events` (TanStack Query
  invalidation).
- Selection + bulk bar: Delete (confirm with count → trash), Run *n*
  separately, Merge into epic (draft screen wired fully in 15).
- Stats band: version, task counts left; three meters right showing project
  spend vs cap from `/api/usage`, Fable meter hidden when `allowedModels`
  excludes `claude-fable-5`; expands to window end times; no banner/toast.
- Keyboard: `⌘K` palette (cmdk), `⌘P` switcher, `C`, `/`, `J/K`, `E`, `R`,
  `⌘Enter`, `Esc` per docs/07.
- Design language throughout: tokens.css values only; dark-only; motion and
  radii per docs/13; `prefers-reduced-motion` zeroes transitions.

## Acceptance criteria

- [ ] A task created via `curl` appears in the open table without a refresh.
- [ ] Filter → URL → paste in a new tab reproduces the filtered list; Back
      restores the previous filter state.
- [ ] A project with a `layer` facet shows it; another project without it
      doesn't — no hardcoded facet list.
- [ ] A rejected optimistic edit (If-Match induced) flashes and reverts.
- [ ] Size renders as dots with rings for empty steps; Epic renders its own
      mark; hover names the value.
- [ ] Keyboard walk: `⌘P` → switch project → `C` → composer opens.

## Tests

Component tests for facet generation, size/priority/type glyphs, URL filter
round-trip, optimistic revert; a Playwright (or vitest browser-mode) smoke:
SSE-driven row appearance, saved-view lifecycle.

## Out of scope

Task view tabs, composer, run screens (15); dock, settings, docs screens
(16).

# Forge Design System

Forge is an AI-first project management platform where tasks are not only tracked — they are executed. Users create projects, define tasks (objective, instructions, priority, deadline, supporting files) and delegate them to **AI agents** that run the work autonomously using connected models and tools. Forge watches the run: statuses, progress, execution logs, artifacts and completion summaries update themselves. Humans review output, give feedback, approve milestones and intervene when they want to — rarely because they have to.

The product should read as a **premium engineering tool**: the polish of Linear, the flexibility of Notion, the collaboration of GitHub, the intelligence of a modern AI product. AI is a member of the team, not a chat window bolted to the side.

## Surfaces covered here

| Surface | Where |
| --- | --- |
| **Forge app** — dark workspace: facet rail, board, tabbed task view, activity dock | `ui_kits/forge-app/` |
| **Forge web** — marketing home, pricing, changelog | `ui_kits/forge-web/` |

## Sources

This system was authored **from the written brand + product brief only**. No codebase, Figma file, screenshots, slide deck, font binaries or logo files were supplied.

Consequences, all flagged in place:

- **The logo was designed here, not supplied.** Four candidates were explored (`guidelines/logo-options.html`) and the user selected **C, the Spark** — now `assets/logo.svg`.
- **Fonts are substitutes.** Geist / Geist Mono from Google Fonts stand in for whatever Forge actually licenses.
- **Icons are substitutes.** Lucide 0.544.0, copied into `assets/icons/` and inlined into the `Icon` component.
- **The component inventory is authored, not derived.** With no source library to mirror, this is a standard primitive set sized to the product's needs, plus five execution-specific components (see *Intentional additions*).
- **Layout comes from a user-supplied mockup** (`uploads/mockups.html`, a sibling AI task tool). The app shell — workspace switcher, faceted rail, toolbar, stats band with token meters, global activity dock, slide-over detail — follows it structurally. Its palette does not: Forge keeps ember, not the mockup's blue.

If you have any of the real material — brand files, the app repo, a Figma library — hand it over and this system should be re-derived against it.

---

## Content fundamentals

Forge writes like an engineer's status line, not a product assistant.

**Tone.** Factual, present tense, active voice. The system reports what happened; it does not celebrate, apologise, or offer. Short sentences. Numbers wherever a number exists.

**Casing.** Sentence case everywhere — buttons, headings, menu items, table headers, toasts. The only uppercase is the 11px overline used for section eyebrows, and it is tracked +7%.

**Person.** Address the user as *you*, sparingly. Never *I* or *we* in product UI — the agent has a name (Atlas, Ledger, Scribe) and is referred to in the third person: *"Atlas finished FRG-214."* Marketing may use *we* in the footer and sales copy, nowhere else.

**Agents are named, not anthropomorphised.** *"Ledger is blocked: vendor sandbox credentials expired."* Not *"Ledger is having trouble!"* Agents do not thank, apologise, or express enthusiasm.

**Emoji: never.** Not in product, not in marketing, not in changelog entries. Status is carried by colour and glyph.

**Numbers and identifiers are monospace.** Task keys (`FRG-214`), durations (`2m 14s`), model names, percentages, versions. If a machine produced it, it is set in Geist Mono.

Examples:

| Write | Avoid |
| --- | --- |
| Atlas finished FRG-214. 3 files changed. | 🎉 Great news! Your AI assistant has completed the task! |
| Run failed: tool timeout after 120s. | Oops! Something went wrong. |
| Approve to deploy to staging. | Would you like me to go ahead and deploy this for you? |
| 31/31 tests passing | All tests are looking good ✅ |
| No tasks in review. Agent output lands here for sign-off. | Nothing here yet — check back later! |

**Marketing voice** is the same voice with longer sentences and a sharper claim: *"Tasks that execute themselves."* *"An execution platform, not a task list."* *"We charge for the humans supervising it."* Claims are concrete and checkable; no superlatives, no "revolutionary", no AI mysticism.

---

## Visual foundations

### Colour

**The app is dark by default.** `:root` is the dark ground — a warm graphite stack of four steps (`--surface-page #131211`, `--surface-card #1A1918`, `--surface-raised #222120`, `--surface-overlay-bg #292826`) with hairline borders at `#2A2927`/`#3A3835`. `[data-theme="light"]` exists for the marketing site, print and specimen work — it is not an app preference.

A neutral graphite ramp carries roughly 95% of every screen. Exactly **one vibrant accent — Ember `#F4511E`** — and it is reserved: primary actions, AI agent activity, the *running* task state, links, and focus rings. If ember appears anywhere else, something is wrong.

Neutrals are very slightly warm (`--gray-50 #F6F6F4`, `--gray-950 #111110`) so ember sits in the same temperature family rather than fighting a cool grey.

Semantic colours (green / amber / red / blue / violet) exist only for meaning — never decoration, never a chart palette by default. Task lifecycle is fixed and must never be remapped — ten states: **open questions** amber · **design** violet · **ready** grey-600 · **running** ember · **testing** ember-300 · **reviewing** blue · **paused** amber-600 · **failed** red · **canceled** grey-400 · **done** green. Ember and its lighter step mark the two states where an agent is actively working; the three greys all mean "not moving" (waiting, stopped, abandoned).

On the dark ground, status and semantic colours lift one step (`--green-300`, `--amber-300`, `--red-300`, `--blue-300`, `--violet-300`) and text accents use `--ember-400`; solid ember fills stay at `--ember-500` so buttons keep their weight.

### Type

Geist for everything, Geist Mono for machine output. The product lives between **11px and 20px** — density is a feature. Display sizes (30–62px) belong to marketing and page titles only.

Tracking tightens as size grows: −3% at display, −1.5% at headings, 0 at body. Weight, not tracking, carries emphasis: 400 body, 500 UI, 600 headings. Body line-height 1.5; long-form marketing 1.65; headings 1.15–1.3.

### Spacing and layout

4px base scale with 2px and 6px steps for dense control interiors. Fixed rhythms: **34px table rows**, **26/32/38px control heights**, **28px sidebar rows**, **48px page headers**, **236px sidebar**, **360px detail rail**, **1160px marketing content width**, **66ch prose**.

**App layout is one fixed shell**, and it is the same shell on every surface:

- **240px left rail.** Top: the workspace switcher — a project is a *workspace*, not a nav item, and choosing one re-scopes the entire UI. Below it: search, then **faceted filters** (Status from the pipeline; Priority, Assignee, Labels, Due from the workspace schema). Each filter is a single `label: value` line — the value opens a checkbox menu with live counts, one pick reads as that value, several read as "N selected", and a footer counts and clears everything. One line per dimension keeps the rail scannable no matter how many options a facet has. The rail is the answer to "what can I navigate or narrow here", so it changes contents by context but never moves.
- **Toolbar** (12/18px): the saved view's name with a dirty dot, the filtered count, sort/group/save chips, a live indicator, and the single primary action.
- **Stats band** below it: what the workspace *is* on the left (version, task counts), what it is *costing* on the right (token-budget meters, amber past 100%).
- **One view: the board.** A view switcher with a single option is chrome, so there isn't one.
- **A task opens as a full view**, not a panel: title, a two-column property grid, then the pipeline as a tab bar — Description · Questions · Design · Execution · Test · Review. Stages the task has not reached are disabled; the stage matching its status is highlighted in ember and selected on open. Escape returns to the board.
- **The activity dock spans the full window width, under the sidebar**, because runs are global rather than workspace-scoped. Collapsible, active runs above queued.

Marketing is a single centred column with a sticky translucent nav, and is the one surface that runs in the light theme.

### Backgrounds

Flat colour, always. **No gradients, no photography, no illustration, no texture, no pattern, no mesh.** The page is `--surface-page` (near-white), cards are pure white, sunken zones are `--gray-50`. The one full-bleed moment in the whole system is the near-black lifecycle band on the marketing home page. Execution logs are the other dark surface, and they are dark because they are terminals.

### Borders, corners, elevation

Hairline 1px borders do the structural work; shadows are almost invisible. `--shadow-xs`/`sm` are barely-there lifts for resting cards, `md` for hover, `lg` for popovers and toasts, `xl` for dialogs and the marketing hero frame. There is one coloured shadow (`--shadow-accent`) and it is used at most once per page, if at all.

Radii: **3px** micro (checkbox, kbd), **5px** chips, **7px** controls, **10px** cards, **14px** dialogs, **20px** marketing panels, **999px** pills and avatars. Cards are: white fill, 1px `--border-default`, 10px radius, `--shadow-sm`. Selection swaps the border to ember — never a fill.

### Transparency and blur

Two places only: the sticky marketing nav (`rgba(251,251,250,.82)` + `saturate(150%) blur(10px)`) and the dialog scrim (`rgba(17,17,16,.42)` + the same blur). Everything else is opaque. No frosted cards, no glassmorphism.

### Motion

Short and flat-out: 80ms instant, 130ms fast (the default for control state), 200ms normal, 320ms slow. Easing is `cubic-bezier(.2,0,0,1)` for state and `cubic-bezier(.16,1,.3,1)` for entrances. **Nothing bounces, nothing overshoots, nothing springs.**

Entrances are a 4px rise plus fade. The only continuous animation in the product is **agent activity** — the pulsing dot on `AgentRunIndicator`, the spinning `running` status glyph, and the indeterminate progress scan. When nothing is executing, the interface is completely still.

### Interaction states

- **Hover** — surfaces tint (`rgba(17,17,16,.04)`), solid fills darken one step (`--accent-solid-hover`), text lifts from secondary to primary. Interactive cards raise to `--shadow-md` and translate −1px.
- **Press** — `scale(.985)` plus the next-darker fill. No ripple.
- **Focus** — a 3px ember ring `rgba(244,81,30,.22)`, never an outline offset, never a colour change alone.
- **Selected** — ember border, ember-50 surface. **Disabled** — 45% opacity, `not-allowed`.
- **Loading** — the leading icon becomes a spinner and the control locks; layout never shifts.

### Imagery

There is none, by design. If product photography or illustration is ever introduced, the brief is: cool-neutral, high-contrast, no warm filters, no stock-photo people, no 3D gradient abstractions. Screenshots of the product itself are the preferred "image", framed in a 20px-radius panel with `--shadow-xl` (see the marketing hero).

---

## Logo

The **Spark** — a four-point ember star, the same silhouette as the `sparkles` glyph that marks AI activity throughout the product. The mark means the agent; the mark is the brand.

- `assets/logo.svg` — ember `#F4511E`, for light surfaces.
- `assets/logo-white.svg` — knockout, for graphite and ember surfaces.
- `assets/logo-mono.svg` — `currentColor`, for inline use.
- `assets/logo-lockup.svg` — mark + wordmark, horizontal.

**Lockup**: mark and wordmark on one baseline, gap = ¼ of the mark's height, wordmark in Geist Semibold at −3% tracking. **Clear space**: half the mark's height on all sides. **Minimum size**: 16px. **Never**: rotate it, outline it, gradient-fill it, put it in a container tile, or place it on a mid-tone background.

See `guidelines/logo.card.html`; the rejected candidates stay on record in `guidelines/logo-options.html`.

## Iconography

**Lucide 0.544.0** (ISC), outline, 1.5px stroke, 24px grid. This is a **substitution** — no icon set was supplied. Replace `assets/icons/` and the glyph map in `components/core/Icon.jsx` if Forge has its own set.

- **No icon font, no sprite sheet, no PNG icons, no CDN.** The 55 SVGs the system uses live in `assets/icons/` and are inlined into `Icon.jsx` as data URIs, applied as a CSS mask so they always inherit `currentColor` — that is the only sanctioned way to render an icon, and it keeps glyphs intact offline and in static exports.
- **Sizes**: 13px inside dense rows and chips, 14–16px for standard UI, 20px for feature marks. Never larger than 20px in-app.
- **Never draw inline SVG by hand** in a screen or slide. If a glyph is missing from Lucide, ask before inventing one.
- **No emoji, ever.** No unicode symbols standing in for icons (no ✓, →, ★ in text) — use the Lucide equivalent so weight and alignment match.
- **Colour** follows text: `--text-tertiary` at rest, `--text-primary` on hover, `--text-accent` when active or agent-related. Status glyphs take their lifecycle colour and nothing else.

Core glyph vocabulary: `sparkles` (agent), `play` / `pause` (execution), `terminal` (logs), `shield-check` (approval), `circle-help` / `shapes` / `circle` / `loader-circle` / `flask-conical` / `circle-user-round` / `circle-pause` / `circle-x` / `circle-slash` / `circle-check` (the ten lifecycle states in order), `signal-high` / `signal-medium` / `signal-low` (priority), `list` / `columns-3` / `calendar` / `gantt-chart` (the four views), `command` (keyboard), `building-2` (workspace).

---

## Components

Twenty-eight primitives, grouped by concern. Each directory holds `<Name>.jsx`, `<Name>.d.ts`, `<Name>.prompt.md` and one `@dsCard` HTML specimen.

**`components/core/`** — `Icon`, `Button`, `IconButton`, `Card`, `Badge`, `Tag`, `Avatar`, `Kbd`

**`components/forms/`** — `Input`, `Textarea`, `Select`, `Checkbox`, `Radio`, `Switch`

**`components/feedback/`** — `Dialog`, `Toast`, `Tooltip`, `ProgressBar`, `EmptyState`

**`components/navigation/`** — `Tabs`, `SidebarItem`, `Breadcrumbs`

**`components/product/`** — `StatusPill`, `AgentRunIndicator`, `TaskCard`, `ExecutionLog`, `ApprovalBanner`

### Intentional additions

No source library defined an inventory, so the core/forms/feedback/navigation groups are the standard set. These five are additions the product genuinely requires and would otherwise be re-invented per screen:

- **`Icon`** — wrapper over the substituted Lucide set; keeps every glyph consistent and colour-inheriting.
- **`StatusPill`** — the ten task states are load-bearing product vocabulary; they must render identically in every view.
- **`AgentRunIndicator`** — "an AI is working on this right now" is Forge's central signal and its only looping animation.
- **`ExecutionLog`** — transparent automation is a stated design principle; the log is a component, not a screen detail.
- **`ApprovalBanner`** — human checkpoints appear inline in several surfaces and must never drift into a modal.

`Avatar` and `Kbd` are also load-bearing here rather than decorative: agent-vs-human identity is a shape distinction (square/ember vs round/neutral), and Forge is keyboard-first.

---

## Index

```
styles.css                 global entry — @import list only
tokens/                    fonts, colors, typography, spacing, radius, elevation, motion, base
guidelines/                18 foundation specimen cards (Colors, Type, Spacing, Brand)
components/                core · forms · feedback · navigation · product
ui_kits/forge-app/         workspace click-through — see its README
ui_kits/forge-web/         marketing site click-through — see its README
assets/                    logo.svg + white/mono/lockup variants
assets/icons/              62 Lucide SVGs (substituted set)
thumbnail.html             homepage tile
SKILL.md                   Agent Skills wrapper
readme.md                  this file
```

**Token entry point:** link `styles.css`. It imports every token file; nothing else needs importing.

**Using components:** load `_ds_bundle.js` (generated) and read from `window.ForgeDesignSystem_8868ce`.

**Starting points:** `Button`, `Card`, `Input`, `Dialog`, `Tabs`, `StatusPill`, plus both UI kit index pages.

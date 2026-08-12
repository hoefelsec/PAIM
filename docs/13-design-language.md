# 13 — Design language

The visual identity is **Forge**. The source of truth for tokens, components
and rules is the design system in [`design/forge/`](../design/forge/readme.md).
This document holds the decisions the product needs: the identity, the token
source, the status mapping, and the deviations. Where this document and the
design system disagree, this document wins — it records the deviations on
purpose.

The interface is dark. It uses one theme. The light theme in the design
system exists for marketing and print; the product does not offer it.

## Identity

- **Name:** Forge. The interface shows the name in sentence case.
- **Logo:** the Spark — a four-point ember star
  ([`design/forge/assets/logo.svg`](../design/forge/assets/logo.svg); knockout
  variant `logo-white.svg`). The mark means the agent. Never rotate it,
  outline it, gradient-fill it, or put it in a container tile.
- **Voice:** an engineer's status line. Factual, present tense, active voice.
  Sentence case everywhere. No emoji, anywhere. Numbers wherever a number
  exists. The interface does not celebrate, apologise, or offer.

## Concept

The tool is an instrument. A neutral warm-graphite ramp carries about 95% of
every screen. Exactly **one vibrant accent — Ember `#F4511E`** — and it is
reserved: primary actions, agent activity, the running states, links, and
focus rings. If ember appears anywhere else, something is wrong.

## Tokens

The client imports the token files from
[`design/forge/tokens/`](../design/forge/tokens/) and defines no colour, size
or duration of its own. The main values:

```
surface/page      #131211    the page (--surface-page)
surface/card      #1A1918    cards, panels, the sidebar
surface/raised    #222120    inputs, hover surfaces
surface/overlay   #292826    menus, dialogs
surface/sunken    #0D0C0B    execution logs (terminals are darker)
border/subtle     #2A2927    hairlines
border/strong     #3A3835    emphasis
text/primary      #EAE7E1
text/secondary    #9C978F
text/tertiary     #7A756E
ember/500         #F4511E    the accent; solid fills
ember/400         #FF7440    text accent, links, focus
```

## Status colours

The design system fixes ten lifecycle colours. This product's pipeline
([04](04-status-pipeline.md)) maps onto them:

| Status | Token | Value |
|---|---|---|
| `backlog` | — (deviation, see below) | `--gray-500` `#7A756E` |
| `open_questions` | `--status-open-questions` | amber `#E0B252` |
| `design` | `--status-design` | violet `#A99BE8` |
| `ready` | `--status-ready` | `#9AA3AE` |
| `executing` | `--status-running` | ember `#F4511E` |
| `testing` | `--status-testing` | ember `#FF9D72` |
| `ai_review` | `--status-reviewing` | blue `#7FAAE6` |
| `manual_review` | `--status-reviewing` | blue `#7FAAE6` |
| `done` | `--status-done` | green `#6FC7A2` |
| `cancelled` | `--status-canceled` | `--gray-600` `#55514C` |

Ember and its lighter step mark the two states where an agent works. The
greys all mean "not moving".

**Deviations from the design system's list.** The design system names
`paused` and `failed` as task states. In this product they are **run**
statuses ([09](09-ai-run.md)), not task statuses: a paused or held run shows
`--status-paused` amber on the run row and in the dock; a failed run shows
`--status-failed` red there. The task itself stays `executing`. The design
system has no `backlog`; this product keeps it, on the neutral grey above.

## Run and agent colours

- Agent activity (the run indicator, the pulsing dot): `--agent-fg`
  `#FF7440` on `--agent-bg`. This is the only continuous animation in the
  product. When nothing executes, the interface is still.
- Execution logs sit on `--log-surface` `#0D0C0B` with `--log-text`.
- Operation risk keeps its three levels ([09](09-ai-run.md)) on semantic
  colours: safe = `--text-tertiary`, write = `--info-fg` blue, exec =
  `--danger-fg` red.

## Type

Geist for the interface, Geist Mono for machine output. The fonts are vendored
into the repository — the product is local-first and loads nothing from a CDN.

- The product lives between 11 and 20 pixels. Density is a feature.
- Weight carries emphasis: 400 body, 500 UI, 600 headings. Tracking: 0 at
  body, −1.5% at headings.
- **Monospace marks machine output.** Task keys (`FEAT-14`), durations,
  model names, token counts, percentages, versions, field keys, statuses.
  If a machine produced it, it is Geist Mono.

## Icons

**Lucide** (outline, 1.5px stroke), rendered through one `Icon` component as
a `currentColor` mask. No icon font, no CDN, no emoji, no unicode symbols
standing in for icons, no hand-drawn inline SVG.

| Dimension | Glyphs |
|---|---|
| Agent | `sparkles` |
| Execution | `play`, `pause`, `terminal` |
| Priority | `signal-high` / `signal-medium` / `signal-low`; `urgent` takes `--danger-fg`, the rest follow text colour |
| Statuses | the lifecycle glyph list in [`design/forge/readme.md`](../design/forge/readme.md), each in its status colour |
| Approval | `shield-check` |

Size renders as text (`XS`–`XL`, `Epic` as a pill) in Geist Mono — the dot
scale of the previous identity is retired. Type keeps one glyph per pool
option, drawn from Lucide.

Icon colour follows text: `--text-tertiary` at rest, `--text-primary` on
hover, `--text-accent` when active or agent-related. Status glyphs take
their lifecycle colour and nothing else.

## Geometry

- 4 pixel base scale, with 2 and 6 pixel steps inside dense controls.
- Rows: **34 pixels** in task lists and tables. Sidebar rows 28 pixels.
  Control heights 26/32/38 pixels.
- The left rail is **240 pixels**. The task view property rail is
  **360 pixels**.
- Radii: 3 (micro), 5 (chips), 7 (controls), 10 (cards), 14 (dialogs),
  999 (pills). Nothing larger in the product.
- Hairline 1 pixel borders do the structure; shadows are almost invisible.
  Selection swaps a border to ember — never a fill.
- Flat colour, always: no gradients, no texture, no photography, no
  illustration. Blur exists in exactly one product place, the dialog scrim.
- Numbers that align in a column use `font-variant-numeric: tabular-nums`.

## Motion

- Durations: 80ms instant, 130ms fast (the default for control state),
  200ms normal, 320ms slow. Easing `cubic-bezier(.2,0,0,1)` for state,
  `cubic-bezier(.16,1,.3,1)` for entrances. Nothing bounces or springs.
- Entrances are a 4 pixel rise plus fade.
- Hover: surfaces tint, text lifts one step. Press: `scale(.985)`.
  Focus: a 3 pixel ember ring, never an outline offset.
- The interface applies an optimistic update at once. A rejected write makes
  the row flash in `--danger-bg` and then return.
- `prefers-reduced-motion` sets all transitions to zero.

## Project identity colours

A project's colour comes from the token palette's semantic hues (ember,
violet, blue, green, amber, plus three greys). The interface shows it as a
tinted icon tile and a progress meter — never as a bar on a card edge.

## Related documents

- [`design/forge/readme.md`](../design/forge/readme.md) — the full design system
- [07 — User interface](07-user-interface.md)

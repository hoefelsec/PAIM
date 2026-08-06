# 13 — Design language

The interface is dark. It uses one theme. The product specification requires a
dark theme, so the interface does not offer a light theme.

## Concept

The tool is an instrument. It runs in a directory on one machine. No other
person uses it.

Therefore the palette comes from drafting, not from web applications:

- a **warm graphite** ground, the colour of pencil lead;
- a **desaturated blueprint blue** as the only interaction colour.

The warm ground has a function. Each project has its own colour. The interaction
colour must stay quiet, so that a clay project and a sage project can appear
together. A cool ground with a saturated blue competes with both. A warm ground
with a cool accent separates them by temperature, not by saturation.

## Ground

```
bg/base        #131211    the page
bg/surface     #1A1918    cards, panels, the sidebar
bg/raised      #222120    inputs, hover states
bg/overlay     #292826    menus, dialogs
border/subtle  #2A2927    hairlines
border/strong  #3A3835    focus, emphasis
text/primary   #EAE7E1
text/secondary #9C978F
text/muted     #7A756E    contrast 4.0:1 on bg/base — the minimum for any text
```

## Accent

```
accent         #6FA8CE
accent/hover   #8CBEDE
accent/solid   #3D7FA8    with #F4FAFD text
accent/tint    #6FA8CE at 13%
```

## Status colours

All values are between 45% and 60% saturation. No status colour is stronger
than a project colour.

```
backlog        #6B6660
open questions #A78BC5
design         #5FA39B
ready          #9AA3AE
executing      #C99A54
testing        #C99A54
review         #6FA8CE
done           #6FA57C
cancelled      #55514C
```

## Priority colours

```
urgent  #CB6F63     high  #C99A54     medium  #7E9FBE     low  #5F5A54
```

`low` is the quietest of the four at 2.7:1 on `bg/base`. It cannot go quieter.
The priority glyph is a 2 pixel bar, and a bar at the contrast of a hairline is
invisible. An invisible `low` bar makes `low` and `none` the same picture.

An unfilled bar uses `border/subtle`. It is always darker than `low`.

Brass (`#C99A54`) has two uses: `executing` and `high`. Both values mean the
same thing: this needs attention now. The shapes differ, so a column never
needs a second reading.

## Operation risk colours

This is the one place where the accent carries meaning, not interaction. On a
run screen the question is "what can this operation change on my machine?".

```
safe (read, glob, grep)   #7A756E    neutral
write (write, edit)       #6FA8CE    the accent
exec (bash)               #CB6F63    clay, the same tone as urgent
```

## Project identity colours

Eight tones:

```
steel   #6FA8CE     sage   #6FA57C     brass  #C99A54     clay   #CB6F63
violet  #A78BC5     teal   #69B5AD     rose   #C37994     grey   #938D85
```

Each tone has a contrast between 5.3:1 and 7.9:1 on `bg/base`. A new tone must
stay in this band.

The interface shows a project colour as a tinted icon square and as a progress
bar. The tint is the tone at 17%. It never shows a project colour as a bar on
the edge of a card.

## Icons and shapes

Colour marks state. Shape marks value. Custom field values have no colour,
because a schema can grow without limit and a palette cannot.

| Dimension | Shape | Values |
|---|---|---|
| Priority | Bars that grow in **height** | 0 to 3 bars |
| Size | Dots that fill in **count**. Empty steps are rings. Filled steps are discs. | `XS` to `XL`: 1 to 5 of 5. `Epic` has its own mark. |
| Type | A different silhouette for each pool option (see [03](03-custom-fields.md)) | feature, bug, chore, spike, debt |
| Status | A ring that fills as work progresses | ring, half ring, disc |

Priority and size are both scales. They use different shape languages, so
a reader does not confuse them.

## Type

The interface uses the system font stack, not Inter.

```
UI      -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif
Mono    ui-monospace, "SF Mono", "JetBrains Mono", Menlo, monospace
```

**Monospace marks an identifier.** The rule is exact: if the text is monospace,
the user can put it in a URL or a JSON key. Examples: `FEAT-14`, `layer`,
`executing`.

### Scale

| Size / weight | Use |
|---|---|
| 28 / 600 / -0.02em | Page titles |
| 19 / 600 / -0.015em | Task titles |
| 13.5 / 600 | The workspace name |
| 13 / 450 | Table rows |
| 12.5 / 400 | Facet items, properties |
| mono 11 | Identifiers |
| mono 10, caps, 0.11em | Section labels |

## Geometry

- A 4 pixel spacing grid.
- Table rows are 33 pixels. There is one density.
- The left rail is 240 pixels. The task view side column is 244 pixels.
- Corner radius: 6 pixels for controls, 10 pixels for cards, 14 pixels for
  panels. No radius is larger. A large radius at this density looks incorrect.
- Structure comes from 1 pixel lines and from steps in the background colour.
- Only three elements have a shadow: the workspace menu, a dialog, and a card
  that the user drags.
- Numbers that align in a column use `font-variant-numeric: tabular-nums`.

## Motion

- Transitions are 120 to 200 milliseconds, ease-out. This applies to the menu,
  the panel, the collapse of a facet, and a change of tab.
- Hover is 0 milliseconds in and 140 milliseconds out. A table must not feel
  slow when the user moves the pointer across it.
- The interface applies an optimistic update at once. A rejected write makes the
  row flash in clay and then return.
- `prefers-reduced-motion` sets all transitions to zero.

## Related documents

- [07 — User interface](07-user-interface.md)

# Task Manager

A local-first project & task management service. Single process, runs on `localhost`,
serves both a **REST API** for other services/agents and an **HTML UI** for humans.

Think: a personal, self-hosted Jira/ClickUp — with Notion's visual calm.

---

## 1. Purpose & Context

The service is a **shared task substrate for a single user's machine**. Its two
consumers are:

| Consumer | Interface | Typical use |
|---|---|---|
| Other local services / scripts / AI agents | REST/JSON over HTTP | Read the backlog, pick up work, mark tasks done, file new tasks |
| The user | HTML UI in a browser | Triage, plan, edit, browse across projects |
| **Claude** | Anthropic API, called by the service | Turn free text into structured tasks; **execute** tasks against a workspace (§7) |

The first two act on the **same data with equal authority**. There is no
multi-tenancy, no login, no permission model — the machine boundary *is* the
security boundary for reading and writing tasks.

**Claude is a third consumer of a different kind.** It doesn't just read the
store, it acts on the filesystem. That capability gets its own boundary — a
per-project workspace root and an approval gate — because "it's all local
anyway" stops being a sufficient answer the moment a model can run `rm`. See
§7.3.

### Non-goals (explicitly out of scope)

- Multi-user collaboration, presence, real-time cursors
- Authentication, authorization, audit-by-actor, RBAC
- Public/remote deployment, TLS, rate limiting
- Sprints, story points, burndown charts, time tracking, invoicing
- Email/Slack notifications, integrations with external trackers
- Mobile-native apps (the UI should be *usable* narrow, not app-grade responsive)

---

## 2. Domain Model

### Project

A named container for tasks. Identified by a URL-safe **slug** used in all API paths.

```
id          uuid
slug        "task-manager"        # unique, URL identity, immutable after create
name        "Task Manager"        # display name, editable
description text (markdown)
icon        emoji or lucide icon name
color       accent token          # tints the project in lists/headers
status      active | archived
fieldSchema FieldDef[]            # per-project custom task fields  (see §3)
statuses    string[]              # which predefined statuses apply (§3)
regressionTests  TestDef[]        # the suite every task must pass  (§3.3)
type        node | python | go | rust | generic     # §5.1
version     "0.4.2"               # read from the workspace, not stored (§5)
workspacePath  "/Users/edu/Projects/task-manager" | null
                                  # required for runs (§7.3) and docs (§8)
autoCommit  bool                  # commit after a successful run   (§5.1)
autoPush    bool                  # …and push. Outward-facing.      (§5.1)
safety      SafetyPolicy          # §7.3
modelRouting  { field, map }      # difficulty → model + effort     (§7.4)
allowedModels string[]            # which models this project may use
usageCaps   { fiveHour, weekly, fable }        # self-imposed, 0–100 (§7.5)
createdAt   / updatedAt / archivedAt
```

- At most ~100 projects; ~12 active at a time. Archived projects stay fully
  readable and API-addressable, just hidden from default listings.

### Task

```
id          uuid                  # internal
key         "TM-14"               # human/agent-facing: <PROJECT_PREFIX>-<counter>
projectId   uuid
title       string                # required, the only truly required field
description text (markdown)
status      string                # must be one of the project's statuses
priority    none|low|medium|high|urgent
labels      string[]
assignee    string                # free-text name; no user table
size        XS | S | M | L | XL | Epic        # core — see below
parentId    uuid | null           # subtasks, one level deep
order       float                 # manual sort position within status column
fields      { [key]: value }      # ← the schemaless part, validated against
                                  #   the project's fieldSchema
model       string | null         # execution model; null = routed (§7.4)
effort      low|medium|high|xhigh|max | null    # model reasoning depth; null = routed
safety      SafetyPolicy | null   # null = inherit the project's (§7.3)
schedule    Schedule | null       # §7.9
dependsOn   uuid[]                # must be done before this runs   (§3.6)
questions   Question[]            # open_questions gate             (§3.1)
designOptions DesignOption[]      # design gate                     (§3.2)
tests       TestRun[]             # testing gate                    (§3.3)
reviews     Review[]              # ai_review / manual_review       (§3.4–5)
sourcePrompt  string              # the original free text, kept for re-evaluation
evaluatedAt / staleReason         # §3.7
createdAt / updatedAt / closedAt
```

- At most ~1000 tasks per project; ~100 open at a time. Total ceiling ~100k
  documents — small enough that any storage engine works and the whole active
  set fits comfortably in memory.

### Size — and why it is core

`size` is the one field that had to leave the custom schema and become core,
because **`size: "Epic"` makes the task an epic.** A field that changes what
kind of thing a record *is* cannot be optional per project — the table, the
orchestrator and the run pipeline all need to know it exists.

```
size   XS  S  M  L  XL  Epic
                        └── sets kind = "epic"
```

Everything else stays schema-driven. `type`, `difficulty` and `layer` remain
ordinary custom fields; `size` is core alongside `status` and `priority`.

### Epic

**An epic is a task**, not a separate entity. `kind` is derived from `size`
rather than set independently, and its children point at it with `parentId`.

```
size        …| Epic                # the input
kind        task | epic            # derived: kind === "epic" iff size === "Epic"
parentId    uuid | null            # set on children of an epic
```

Deriving `kind` rather than storing it separately removes a whole class of
inconsistency — there is no way to have an `XL` epic or an `Epic`-sized task
that isn't one. Changing a task's size to `Epic` promotes it; changing it away
is refused while it still has children.

This is the whole design. Because an epic *is* a task it inherits everything
already built — statuses, priority, custom fields, filters, the table, the
board, model routing, runs — instead of needing a parallel implementation of
each. A separate `Epic` entity would have meant duplicating the schema engine,
the view layer and the run pipeline for a second object that behaves almost
identically.

- **One level.** An epic's children are tasks; a task inside an epic cannot
  itself be an epic. Nesting arbitrary trees buys very little here and
  complicates every query, every view, and orchestration.
- **Status is set, with one automatic transition.** An epic's status is yours
  to set like any task's — except that **it moves to Done on its own once every
  child is done**, and back out if a child reopens. That single rule removes the
  only genuinely annoying inconsistency (a finished epic sitting in In Progress)
  while leaving you free to say "this epic is blocked" whenever you need to.
- **Children are ordinary tasks.** They appear in the table, match filters,
  and can be run individually. Being in an epic constrains nothing.

### Comment (v1.5 — see §9)

```
id / taskId / body (markdown) / createdAt
```

### Writes are anonymous

The store records **when** something changed, never **who** changed it. There is
no author field, no actor on the activity record, and no distinction in the API
between a write from the UI and a write from a script. Consequences:

- Tasks carry `createdAt` / `updatedAt` / `closedAt` and nothing else temporal.
- `assignee` is unaffected — it is a value *you set*, not a value derived from
  who made the request. Assigning a task to `agent` remains meaningful.
- "What did the agent change overnight?" is not answerable. `updatedSince` is
  the closest available query, and it is deliberately actor-blind.

This follows from the machine boundary being the security boundary (§1): if
there is only one principal, attribution is bookkeeping without a consumer.

---

## 3. The Central Design Problem: Evolving, Per-Project Fields

> *"the definition of task fields will grow over time and probably be different per project"*

This is the requirement that shapes everything else. The approach:

**A small fixed core + a validated open bag.**

- Every task everywhere has the same **core fields** (`title`, `status`,
  `priority`, `labels`, `assignee`, `description`, timestamps). These are what
  the UI's generic chrome and cross-project views can rely on, and what the API
  guarantees to any consumer regardless of project.
- Everything beyond that lives in `fields`, a free-form object, **described** by
  the project's `fieldSchema` rather than constrained by a database schema.

### FieldDef

```jsonc
{
  "key": "impacted_service",     // stable, snake_case, immutable
  "label": "Impacted Service",
  "type": "select",
  "options": ["api", "ui", "storage"],   // select / multi_select only
  "required": false,
  "default": null,
  "order": 3,
  "showInTable": true,           // surfaces as a column in the table view
  "showAsFacet": true,           // surfaces as a filter facet in the left rail
  "description": "Which subsystem this touches"
}
```

**Field types (v1):** `text`, `long_text`, `number`, `checkbox`, `date`,
`datetime`, `select`, `multi_select`, `url`, `person`, `task_ref`.

> **Naming: two things were called "effort".** Resolved by renaming the field
> rather than the parameter. The work-sizing field is **`size`**; the model
> parameter keeps its real name, **`effort`**. Nothing is called two things any
> more, and no wire format changed.
>
> The UI reinforces it: `effort` is never shown on its own. It is always
> rendered joined to the model it belongs to — **`claude-opus-5 · xhigh`** as a
> single value — because effort is meaningless without knowing which model is
> spending it.

### Rules for evolution

1. **Adding a field is always safe.** Existing tasks simply lack the key;
   reads return the field's `default` (or `null`).
2. **Removing a field hides it, it does not delete data.** The value stays in
   `fields` — soft-removal makes "oops, put it back" free.
3. **Type changes are rejected.** Change of type = new field. Keeps every
   consumer's parsing assumptions stable.
4. **Unknown keys on write are rejected by default**, with an opt-in escape
   hatch (`?allowUnknownFields=true`) that auto-creates a `text` FieldDef.
   Strict-by-default catches agent typos; the escape hatch keeps the system
   from blocking legitimate growth.
5. **`required` is advisory in the API, enforced in the UI.** An agent filing a
   task at 3am should never fail because a human-oriented field is missing.
   The API surfaces a `warnings[]` array instead.

### Statuses — a predefined pipeline, not free-form labels

**This reverses an earlier draft.** Statuses started as fully custom per project
(`StatusDef[]` with arbitrary keys). They can't be, because the system now *acts*
on them: it asks the questions, runs the tests, performs the review. A status
the tool has to implement behaviour for cannot be a string the user invents.

So there is **one predefined catalogue**, and a project chooses which of them
apply. The order is fixed by the catalogue — a project can skip `testing`, but
it cannot put it before `executing`.

| Status | Category | Gate — what has to clear before it advances |
|---|---|---|
| `backlog` | todo | — |
| `open_questions` | todo | Claude's questions are answered (§3.1) |
| `design` | todo | A design option is chosen (§3.2) |
| `ready` | todo | — *(mandatory)* |
| `executing` | in_progress | The run finishes *(mandatory)* |
| `testing` | in_progress | Regression + task tests pass (§3.3) |
| `ai_review` | in_progress | Claude returns approved (§3.4) |
| `manual_review` | in_progress | You approve (§3.5) |
| `done` | done | — *(mandatory)* |
| `cancelled` | cancelled | — |

`category` remains the universal projection, so "is this open?" is still
answerable without knowing a project's pipeline.

**Every gate fails backwards to `executing`.** Tests fail, AI review rejects,
you reject — the task returns to `executing` with the reason attached, and the
next run starts knowing what went wrong. A task only moves forward by clearing
the gate; there is no manual override that skips one, because a gate you can
wave past is a gate nobody trusts.

```jsonc
// project settings — pick your pipeline
"statuses": ["backlog", "open_questions", "ready", "executing", "testing", "done"]
```

#### 3.1 `open_questions`

Compose (§7.1) doesn't always have enough to work with. When it doesn't, the
task lands in `open_questions` carrying what Claude needs to know rather than
guessing and being confidently wrong.

```
Question { id, text, kind: text|choice, options?, answer?, answeredAt }
```

Answering all of them triggers a **re-evaluation** (§3.7) — the answers change
the task, so its description, size and priority are reconsidered — and then it
moves to `ready`.

#### 3.2 `design`

For work where a decision has to be made before implementation makes sense.
Claude presents options — usually rendered images, sometimes prose — and you
pick one or reply in free text or with your own image.

```
DesignOption { id, title, rationale, image?, chosen }
```

**Claude decides when it's resolved, not the picker.** Choosing an option is
input, not necessarily an answer; if your reply opens a new question the task
stays in `design`. It advances to `ready` only when Claude says the direction
is unambiguous.

#### 3.3 `testing`

Project settings define **regression tests** — the suite that must pass for any
change. A task can add its **own** tests on top. Entering `testing` runs both.

```
TestRun { id, name, kind: regression|task, status: pass|fail|skip, durationMs, output? }
```

Results are a tab on the task. Any failure sends it back to `executing` with the
failing output attached; it moves on only when everything passes.

#### 3.4 `ai_review`

Claude reads the task description and everything the run actually did, opens
whatever app views it needs to see the result, and returns a verdict.

```
Review { kind: "ai", verdict: approved|rejected, reason, viewsOpened[], at }
```

Rejected sends it back to `executing` with the reason as the next run's brief.

#### 3.5 `manual_review`

The one gate a model can't clear. Claude's job here is to make *your* job small:
it describes what changed in plain language, says specifically **what to look
for**, and hands you a way in — a button that opens the right screen, or the
command to get there.

```
Review { kind: "manual", summary, whatToCheck[], entryPoint: {label, url|command},
         verdict, note, at }
```

#### 3.6 Dependencies

```
dependsOn   uuid[]
```

A task with unfinished dependencies **cannot run**. You can still queue it —
forbidding that would mean babysitting the queue — but the queue **stops it
when its turn comes** and says which dependency isn't done, rather than
starting work whose premise isn't true yet.

Dependencies are **detected at generation** by the same pass that drafts the
task, and editable by hand afterwards. A dependency completing is one of the
triggers for re-evaluation.

#### 3.7 Re-evaluation

A task written three weeks ago describes a codebase that no longer exists.
**Re-evaluate** re-reads the original prompt against the project's current
state and reconsiders the description, size, priority, difficulty and
dependencies — including concluding the task is no longer relevant.

```
sourcePrompt  string          # what you originally typed, kept for exactly this
evaluatedAt   timestamp
staleReason   time | dependency | answers | project_change | null
```

It is **suggested, never automatic** — the tool marks the task stale and offers
it. Silently rewriting a task you wrote would be worse than leaving it out of
date. Suggested when:

- significant time has passed since `evaluatedAt`
- a **dependency completed** — the ground it was written on just moved
- **open questions were answered**
- the project changed substantially underneath it

---

---

## 4. REST API

Base: `http://localhost:<port>/api`. JSON in, JSON out. Project addressed by slug.

### Projects

```
GET    /api/projects                        ?status=active|archived|all
POST   /api/projects
GET    /api/projects/:project
POST   /api/projects/:project               partial update (also PATCH)
DELETE /api/projects/:project               ?force=true required if it has tasks
GET    /api/projects/:project/schema        fieldSchema + statuses
POST   /api/projects/:project/schema        add/modify field & status defs
```

### Tasks

```
GET    /api/projects/:project/tasks         list + filter + sort + paginate
POST   /api/projects/:project/tasks         create
GET    /api/projects/:project/tasks/:key    detail (key = "TM-14" or uuid)
POST   /api/projects/:project/tasks/:key    partial update  ← primary write verb
PATCH  /api/projects/:project/tasks/:key    alias of the above
DELETE /api/projects/:project/tasks/:key    ?hard=true to skip trash
POST   /api/projects/:project/tasks/bulk    { ids[], patch{} }  batch update
```

### Cross-project

```
GET    /api/tasks                           ?project=a,b&status=...  federated query
GET    /api/search?q=...                    full-text over title/description
```

### List query parameters

```
status=todo,in_progress     open=true            priority=high,urgent
label=backend               assignee=edu         parent=TM-3
field.impacted_service=api  q=free text          updatedSince=ISO-8601
sort=-updatedAt,order       limit=50&cursor=...
include=subtasks,comments
```

### Response envelope

Every list response:
```jsonc
{ "data": [...], "meta": { "total": 143, "cursor": "...", "hasMore": true } }
```
Every error:
```jsonc
{ "error": { "code": "FIELD_UNKNOWN", "message": "...", "details": { "key": "..." } } }
```
Stable, machine-readable `code` values matter more than prose here — the
primary API consumer is a script, not a person.

### Update semantics

`POST` on a task is a **shallow merge on core fields, shallow merge on
`fields`**. Sending `{"fields": {"a": 1}}` does not wipe `fields.b`. To clear a
value, send `null` explicitly. Idempotency via optional `If-Match` on
`updatedAt` for compare-and-swap; absent the header, last write wins.

---

## 5. HTML UI

### Routes

```
/                       Project grid — all active projects, archived collapsed
/p/:project             Workspace task view (default: table)
/p/:project?status=...  Live filter state — ephemeral, shareable (§6)
/p/:project/v/:view     A saved view
/p/:project/new         AI task composer (§7.1)
/p/:project/t/:key      Task detail (panel over the list, deep-linkable)
/p/:project/t/:key/run  Run panel — operations, diffs, output (§7.2)
/p/:project/docs        Project wiki — the workspace's docs/ folder (§8)
/p/:project/docs/*path  A rendered doc or image
/p/:project/settings    Fields, statuses, workspace, run policy, routing, caps
/search                 Cross-workspace search
```

Root stays the project grid rather than redirecting to the last workspace, so
there is always one URL that answers "what projects exist?" — for a human and
for a script alike.

### Shell: one workspace at a time

A project is a **workspace**, not a sidebar item. Selecting one scopes the
entire UI — every view, every filter, every keyboard shortcut. It is changed
from a **switcher in the top-left corner**, the way a workspace is changed in
Notion. The switcher menu lists active projects with open counts, a collapsed
Archived row, and the workspace-level actions (Project settings, New project,
All projects) at the bottom.

The switcher shows the project's **icon tile** alongside its name and open
count — the same colour identity used on the project grid, so the workspace you
are in is recognisable before you read the word.

Directly beneath it sits the **Docs** button (§8), then the search box, then the
rail's real job: **faceted filtering**.

```
┌──────────────┬─────────────────────────────────────────┐
│ ◈ Task Mgr ⌄ │ v0.4.2 · 28 · 17 open   5h ▓▓▒ Wk ▓▓▓▒ F ▓ │ ← stats band
│   17 open    ├─────────────────────────────────────────┤
├──────────────┤  [Table|Board|List]  8 of 28  Sort Group │ ← toolbar
│ ▤ Docs    12 │─────────────────────────────────────────┤
├──────────────┤  KEY  TITLE          PRIORITY  TYPE  ... │
│ ⌕ Search   / │  ▾ In Progress 3                         │
│ ▾ STATUS core│  TM-4  Table view…      High   feature   │
│   ☑ Todo   5 │  TM-3  Field schema…    High   feature   │
│   ☑ In Pr  3 │  ▾ Todo 5                                │
│ ▾ TYPE schema│  TM-14 Reject type…     High   chore     │
│ ▸ LAYER      │                                          │
│ Clear all  2 │                                          │
└──────────────┴─────────────────────────────────────────┘
```

### The stats band

A band across the top of the main pane, above the toolbar, present on every
workspace screen. Two halves:

- **Left — what this project is.** Version, read live from the workspace
  (`package.json`, else `git describe`, else absent — it is not a stored field),
  and task counts: total, open, closed.
- **Right — what it is costing.** The three usage windows from §7.5 as compact
  meters, each carrying its user-set cap marker. Passing a marker turns that
  meter clay and disables Run across the workspace.

Collapsed it is a single ~44px row. Expanding it reveals reset times and the
draggable cap markers. It collapses because it is ambient information — you
want it glanceable on every screen, and in your way on none of them.

**The rail is generated, not hardcoded.** `status`, `priority`, `labels` and
`assignee` are core facets present in every workspace. `type`, `difficulty` and
`layer` are this project's custom fields. Both come from the same
`fieldSchema` that drives the table columns: **every `select` /
`multi_select` field becomes a facet automatically**, and each facet head is
annotated `core` or `schema` so it's obvious which is which. Open a different
workspace and the rail is different.

Two toggles per field, not one — `showInTable` and `showAsFacet`. What you
slice by and what you scan by are not the same list: `layer` is a facet but not
a column, `effort` is both, `target` is neither.

> **The rule that settles the small arguments:** the rail controls *which tasks
> are in the set*; the toolbar controls *how that set is presented*. Filtering
> lives left, view/sort/group live top. Nothing appears in both places.

### 5.1 Project configuration

`/p/:project/settings`. The rail becomes a **section nav** — same slot,
contextual content, the third instance of that pattern after facets and the
docs tree.

| Section | Contains |
|---|---|
| **General** | Project type, workspace path, docs folder status, icon & colour |
| **Git** | Auto-commit after a successful run · auto-push · message template |
| **Safety** | The three-mode policy and its ask list (§7.3) |
| **Fields & statuses** | The custom-field editor (§3) |
| **Models & routing** | Which models this project may use, and the routing map (§7.4) |
| **Usage limits** | The three self-imposed caps (§7.5) |
| **Danger** | Archive, delete, reset schema |

**Project type** (`node` · `python` · `go` · `rust` · `generic`) is a small
field that does real work: it tells the service where to read `version` from
(`package.json`, `pyproject.toml`, `go.mod`, `Cargo.toml`, else `git describe`)
and seeds a sensible starting ask-list for that ecosystem.

**Auto-push deserves its own note.** Auto-commit is local and reversible.
Auto-push is **outward-facing and hard to undo** — it publishes model-authored
commits to a remote where other people and CI will see them. It is off by
default, cannot be enabled without auto-commit, and the settings copy says what
it does rather than just naming it.

### 5.2 The activity dock

A **collapsible pane across the bottom of the window**, spanning the full width
— under the sidebar too, not inside the main pane. That placement is the design
statement: **the dock is global, not workspace-scoped.** It shows every run in
every project, because a run you started in Homelab an hour ago is exactly the
thing you'd otherwise forget while working in Task Manager.

```
┌──────────────────────────────────────────────────────────────────────────┐
│ ▴ Activity        2 running · 1 needs you · 2 queued        Pause all    │
├──────────────────────────────────────────────────────────────────────────┤
│ ◈ TM-12  Cursor pagination resets…   opus-5 xhigh  ▓▓▓▓▓▓░░ 4/6   2m14s ⏸ ✕│
│ ▲ RCX-8  Draft the Q3 briefing       sonnet-5 high ▓▓░░░░░░ 1/5   0m38s ⏸ ✕│
│ ⌂ HL-3   Rebuild the Proxmox notes   opus-5 high   ⚠ needs you    4m02s ⏸ ✕│
│ ── Queued ──────────────────────────────────────────────────────────────  │
│ ◈ TM-5   Board view drag-and-drop    opus-5 xhigh  #1                   ✕│
│ ✦ PS-2   Rewrite the case study      haiku low     #2                   ✕│
└──────────────────────────────────────────────────────────────────────────┘
```

Each row: the project's **colour tile** (this is the only screen besides the
grid where several project identities appear together — precisely what that
palette is for), task key and title, the model and effort actually running,
progress, elapsed time, and the two controls.

**Progress is labelled as an estimate, and sometimes refuses to guess.** Once
the agent has declared a plan, the bar is completed-operations over
planned-operations and shows `4/6`. Before that — while it is still reading and
deciding — there is no honest denominator, so the row shows an indeterminate
shimmer rather than a fabricated percentage. A progress bar that invents a
number is worse than one that admits it doesn't know yet.

**Controls.**

- **Pause** stops at the next operation boundary, never mid-operation. A
  half-written file or a half-run command is not a state worth being able to
  reach. A paused run holds its place and resumes where it stopped.
- **Cancel** opens a confirmation, and the confirmation's job is to state the
  thing people get wrong: **completed operations stay applied.** It names them
  — "3 files already changed" — and offers *Cancel run* against *Keep running*.
  There is no rollback, so the dialog must not imply one.

```
GET  /api/activity                   every run, every project
GET  /api/activity/stream            SSE
POST /api/runs/:run/pause | resume
```

Collapsed, the dock is a ~30px strip with the counts and nothing else, so an
idle machine costs one line.

### 5.3 Selection and the bulk bar

Selecting rows raises a **floating bar centred above the activity dock** —
count on the left, actions on the right, dismissed with `Esc` or by clearing
the selection. It floats rather than docking because selection is transient;
permanent chrome for a temporary state is chrome you look at all day for
nothing.

Actions are **Delete · Run · Merge into epic** (§7.7). Run queues each task
independently — it is deliberately *not* the same as making an epic, and the
bar's copy says "Run 3 separately" rather than just "Run" so the distinction
isn't discovered afterwards.

### Screens

**Project grid (`/`)** — pre-workspace, so no rail: the grid gets full width.
Cards per project with icon, name, open count, progress meter, last activity.
Archived collapsed at the bottom. Picking a card enters that workspace.

**Workspace view (`/p/:project`)** — the workhorse. **Opens as a table by
default**; Board is one click away. The table is the default because field sets
differ per workspace, and a table is the only view that shows custom field
values side by side at scanning density. Switching view does not reset the
filter set — that is precisely why filtering had to leave the toolbar. Rows are
**33px, one density** — no compact mode.

**Epics expand in place.** An epic row carries a disclosure triangle and its
children render as indented rows beneath it, inside the same table, sharing its
columns. Expanding is a view state, not navigation — you can open an epic,
scan its children against the same columns as everything else, and collapse it
without losing your place.

**Epic detail** — the same slide-over panel as any task, plus a **child task
table** in place of nothing, and a Run control that starts the orchestrator
(§7.6) rather than a single agent.

**Task detail — a full view with tabs.** *This reverses the earlier
"panel, not a page" decision.* A slide-over made sense when a task was eight
properties; it can't honestly hold five tabbed sections including a test
results table and rendered design options. 430px of panel would mean scrolling
a table sideways to read a pass/fail column, which is worse than losing the
list behind it.

```
Overview · Questions · Design · Tests · Review
```

Tabs appear **only when the project's pipeline includes them** — a project
without `testing` has no Tests tab. The left column keeps the properties
(status, priority, size, custom fields, model, schedule, dependencies); the
tabbed area carries whatever the current gate needs. Triage speed is preserved
where it actually mattered: inline editing in the table itself.

**Project settings** — the custom-field editor. Add/reorder/hide fields, set
each field's column and facet toggles, edit statuses and their colours and
categories.

### Interaction requirements

- **Inline editing everywhere.** Click a value, edit it, blur to save. No modal
  forms, no explicit Save button.
- **Optimistic updates.** UI reflects the change immediately, reconciles or
  rolls back on server response.
- **Keyboard-first.** `⌘K` palette, `⌘P` switch workspace, `c` new task,
  `/` search, `j/k` navigate, `e` edit, `⌘Enter` submit, `Esc` close.
- **Drag & drop** on the board (status change + reorder).
- **Live-ish freshness.** Because agents write concurrently, the UI must not go
  stale. Server-Sent Events push change notifications; UI revalidates.

---

## 6. Saved Views

**Filters do not persist.** Change the rail, switch workspace, come back — the
rail is clean. Ephemeral filtering is the default because a persisted filter you
forgot about is indistinguishable from missing data.

To keep a filter set, hit **Save view** in the toolbar, next to Sort and Group.

```
SavedView {
  id, projectId, name, order
  view      table | board | list
  filters   { status: [], priority: [], fields: { type: [], difficulty: [] } }
  sort      "-updatedAt"
  groupBy   "status"
  columns   string[]     // optional column set + order override
}
```

- Live filter state lives in the **URL query string**, so any filtered view is
  copy-pasteable and back/forward works. `Save view` promotes the current query
  string to a stored record; nothing is written until you press it.
- Saved views appear in a selector at the far left of the toolbar. Selecting one
  replaces the entire toolbar+rail state — it captures view, filters, sort,
  group and columns, not just filters.
- When live state diverges from the selected view, the view name shows a dot and
  `Save view` becomes the accented button. `⌥`-click to save as new.

```
GET    /api/projects/:project/views
POST   /api/projects/:project/views
PATCH  /api/projects/:project/views/:view
DELETE /api/projects/:project/views/:view
```

---

## 7. AI Integration

The tool is **AI-first**: Claude is not a bolted-on assistant, it is how tasks
get written and how they get done. Two distinct integrations, with different
shapes and different risk profiles.

### 7.1 Compose — free text becomes a structured task

There is no new-task form. There is a **textbox**. You describe the work however
you like, and Claude maps it onto the workspace's schema.

```
POST /api/projects/:project/tasks/compose
     { "text": "the api pagination thing is broken again, cursor resets
                on the second page. probably a day of work, blocking the
                CLI release" }
  →  { "draft": { title, description, priority, fields: {...} },
       "reasoning": "...",
       "warnings": [ "No value inferred for `target`" ] }
```

The elegant part: **the extraction schema is generated from the project's
`fieldSchema`.** The same engine that validates API writes (§3) builds the Zod
schema handed to Claude, so a workspace with `difficulty` gets difficulty
extracted, and one without it never sees the field. No per-project prompt
engineering, no hardcoded field list.

```ts
const Draft = zodFromFieldSchema(project);   // same source as write validation
const res = await claude.messages.parse({
  model: "claude-opus-5",
  max_tokens: 4096,
  system: composerPrompt(project),           // stable → prompt-cached
  messages: [{ role: "user", content: text }],
  output_config: { format: zodOutputFormat(Draft) },
});
res.parsed_output;                           // validated, typed draft
```

**Compose returns a draft, it does not create the task.** The UI shows what
Claude inferred, every field editable inline, and you press Create. Guessing
wrong silently is worse than not guessing. `?commit=true` skips review for
scripted callers.

The system prompt is per-project but stable across calls, so it sits behind a
`cache_control` breakpoint — the field definitions are the bulk of the tokens
and they don't change between composes.

### 7.2 Run — a task becomes work performed

> *"To run a task means to send the task data to Claude, have it reply with
> operations, then the tool executes those operations."*

This is the feature that changes what the product is. Everything in §1–§6 is a
task tracker; this makes it an execution surface.

**Built on the Claude Agent SDK** (`@anthropic-ai/claude-agent-sdk`), not on a
hand-rolled loop over the Messages API. The Agent SDK is Claude Code packaged as
a library: it ships the agent loop, the Read/Write/Edit/Bash/Glob/Grep tools,
context management, and — critically — a **permission callback fired before
every tool execution**. Rebuilding that means rebuilding file editing, diffing,
command execution, and the approval gate, and getting all four right.

```
POST   /api/projects/:project/tasks/:key/runs     start a run
GET    /api/projects/:project/tasks/:key/runs     run history for a task
GET    /api/runs/:run                             run detail + operations
GET    /api/runs/:run/stream                      SSE: live operations & output
POST   /api/runs/:run/approve                     { operationIds: [...] }
POST   /api/runs/:run/deny                        { operationId, reason? }
POST   /api/runs/:run/cancel
```

```
Run {
  id, taskId, projectId
  status      queued | planning | awaiting_approval | executing
              | succeeded | failed | cancelled
  operations  Operation[]
  usage       { inputTokens, outputTokens, costUsd }
  startedAt / endedAt
}

Operation {
  id, kind      read | glob | grep | write | edit | bash
  risk          safe | write | exec        // derived from kind
  summary       "Edit src/api/tasks.ts"
  status        proposed | approved | denied | running | done | failed
  diff?         unified diff, for write/edit
  stdout? exitCode?                        // for bash
}
```

### 7.3 Execution safety

Executing model-authored file writes and shell commands is the sharpest edge in
this project. The machine boundary is the security boundary for *reading* tasks
(§1); it is emphatically not sufficient for *running* them.

**Workspace scoping is unconditional.** Each project carries an absolute
`workspacePath`. A project without one **cannot run tasks at all** — the Run
button is absent, not disabled-with-a-tooltip. Every path is resolved to
canonical form and verified inside the root; `..`, symlinks and absolute
escapes are rejected. This is not a policy setting and cannot be turned off.

**Above that sits one policy: a floor, then three modes.**

```jsonc
"safety": {
  "denyList": [                    // the floor — applies in every mode
    "rm -rf /", "git push --force"
  ],
  "mode": "ask_all",               // default. allow_all | ask_all | ask_listed
  "dryRun": false,                 // plan and show diffs, execute nothing
  "askList": [                     // used by ask_listed only
    "git push", "git commit", "rm *", "npm publish", "curl *", "*.env"
  ]
}
```

**The deny list is the floor.** It is checked first, applies in **every mode
including Allow everything**, and is **not overridable per task**. Ships with
two entries and is meant to stay short:

```
rm -rf /            git push --force
```

| Mode | Behaviour (for anything not on the deny list) |
|---|---|
| **Allow everything** | Every operation runs. No prompts. |
| **Ask everything** | Every operation stops for approval, reads included. |
| **Ask for listed actions** | Everything runs *except* operations matching the ask list, which stop for approval. |

**Priority, type and difficulty render as icons, not text.** Priority is
ascending bars, difficulty is filled dots on a four-step scale, type is a
distinct silhouette per value. Names appear on hover and in the filter rail —
in a dense table the column header already says which dimension you are
reading, so repeating the value as a word costs width and buys nothing. Two
different glyph *languages* keep the two scales apart: bars grow in height,
dots fill in count.

**Deny and ask are different mechanisms, not two strengths of the same one.**

- The **ask list** is a tripwire: *stop and show me before you do this.* You
  answer in the moment, and the run continues either way.
- The **deny list** is a refusal: there is **no approve-anyway button**. To run
  a denied command you edit the deny list in project settings. That friction is
  the point — it moves the decision out of a 1am approval prompt, where a
  mis-click costs you a filesystem, and into a deliberate act with the pattern
  in front of you.

**A denial does not kill the run.** The Agent SDK permission callback returns
the refusal *to the model* with the reason, so it can adapt — try a safe
alternative, or explain why it can't proceed. The operation is recorded in the
run log with status `denied`, so the transcript shows what was attempted. This
matters: killing the run on a denied command would make the deny list something
people disable to get work done, which defeats it.

**Modes are set per project and overridable per task.** A task's `safety` is
normally `null` — inherit. Override it for the one task where the default is
wrong: a risky refactor set to *Ask everything*, a well-understood chore set to
*Allow everything*. The task detail shows inherited and overridden differently,
same convention as model and effort (§7.4). **The deny list is not part of that
override** — a task cannot widen it, only the project settings can.

**Approval is as-you-go, not plan-first.** The agent works, and each operation
that needs you stops at the moment it comes up — rather than proposing a full
operation list before anything runs. A plan composed before the model has read
any files is largely guesswork, so reviewing it costs attention and buys little.
The **dry-run toggle** covers the case where you do want the plan first: it runs
the agent normally, shows every operation and diff it would apply, and executes
none of them.

Other controls, independent of mode:

- **Dry run.** Per run, and settable as a project default.
- **Cancellable mid-run.** Completed operations stay applied and recorded —
  cancelling stops further work, it does not roll back. The confirmation says
  so explicitly (§5.2).

**Runs are recorded in full** — operations, diffs, stdout, exit codes, token
usage. This does not contradict §2's anonymous writes: a run record describes
*what happened*, not *who asked*. The distinction is that a run has real content
worth keeping, while an author field would have been bookkeeping with no
consumer.

### 7.4 Model routing

Every task runs on a **model** at an **effort**. Both are stored on the task, and
both are normally left `null` — meaning *routed*.

Routing is schema-driven, like everything else here. In project settings you
nominate one `select` field as the **routing field**, then map its options:

```jsonc
"modelRouting": {
  "field": "difficulty",              // any select field, or null for none
  "map": {
    "trivial":  { "model": "claude-haiku-4-5", "effort": "low"    },
    "easy":     { "model": "claude-sonnet-5",  "effort": "medium" },
    "moderate": { "model": "claude-opus-5",    "effort": "high"   },
    "hard":     { "model": "claude-opus-5",    "effort": "xhigh"  }
  },
  "fallback":   { "model": "claude-opus-5",    "effort": "high"   }
}
```

`difficulty` is a custom field, not a core one — so routing can't be hardcoded
to it. Nominating the field keeps this consistent with the table columns and the
filter facets: **the schema drives it, the product doesn't presume it.** A
workspace with no routing field sends every task to the fallback.

- Both values are **overridable per task**, from the detail panel. An override
  is visually distinct from an inherited value, so you can tell at a glance
  whether a task is routed or pinned.
- Changing a task's difficulty re-routes it — unless it has been pinned.
- `xhigh` is the recommended default for the harder coding work; `low` and
  `medium` are genuinely strong and are the main cost lever.

### 7.5 Usage and self-imposed budget guards

The service runs on the user's own Claude credentials, which carry rolling usage
windows. The stats band (§5) surfaces three:

| Window | Meaning |
|---|---|
| **5-hour** | The rolling short window; resets continuously |
| **Weekly** | The weekly allowance across all models |
| **Fable** | The separate allowance for `claude-fable-5`, the most capable tier |

Each bar shows consumption against the **hard limit** (the bar's end) and carries
a draggable **marker** — a soft cap you set for yourself, somewhere below it.

**Runs are blocked at the marker, not at the hard limit.** If 5-hour usage has
passed your marker, the Run button is disabled with the reason stated and the
reset time shown. The point is to reserve headroom deliberately: you decide that
this project may burn 70% of the window and no more, so that whatever else you
do today still has room.

- Caps are **per project**, so a scratch project can be capped low without
  constraining real work.
- A cap blocks **starting** a run, and **pauses one already running**. Hitting a
  cap mid-run pauses at the next operation boundary — never mid-operation, so a
  half-written file is still not a reachable state — and the run **resumes
  automatically when the window resets.** Pausing is not cancelling: completed
  operations stay applied, the agent keeps its context, and it picks up where it
  stopped.
- The bars in the stats band are the whole notification. **No banner, no toast.**
  A meter that is visibly clay on every screen has already said it; a warning
  strip on top of that is the same information twice, and the second copy is
  the one you learn to dismiss without reading.
- The **Fable cap gates by routing**: if a task routes to `claude-fable-5` and
  the Fable marker is passed, that task is blocked while cheaper-routed tasks
  keep running.
- Caps are advisory over the API — `POST /runs` returns `409 BUDGET_CAP_REACHED`
  with the window and reset time, and an `?ignoreCaps=true` escape hatch for
  scripted callers who know what they're doing.

```
GET  /api/usage                      the three windows, live
GET  /api/projects/:project/caps
PUT  /api/projects/:project/caps     { fiveHour: 70, weekly: 85, fable: 50 }
```

### 7.6 Running an epic — orchestration

Running a single task starts one agent. **Running an epic starts an
orchestrator**, which reads the epic and its children and spawns one agent per
subtask.

```
Run {
  kind        single | orchestrated
  parentRunId uuid | null          # set on the children of an orchestrated run
  ...
}
```

- The orchestrator gets its own model, normally a tier above the workers —
  `modelRouting.orchestrator`, defaulting to the routing fallback. Planning
  across seven subtasks is a harder problem than any one of them.
- **Each subtask gets its own run record**, with its own operations, diffs and
  approvals. An orchestrated run is a parent with child runs, not one giant
  transcript, so a failure is attributable to a subtask and the epic's other
  work is unaffected.
- Children are dispatched **according to the epic's own ordering**, and
  independent ones run concurrently. The concurrency ceiling is a project
  setting, because N parallel agents means N × the usage burn (§7.5).
- **Approvals still surface per operation**, tagged with which subtask raised
  them. The activity dock nests child rows under the orchestrator so the
  provenance is visible.
- **Safety is the epic's**, applied to every child. A subtask cannot widen the
  policy it runs under by being part of a permissive epic — the stricter of
  (epic, subtask) wins.
- Cancelling the orchestrator stops dispatch and cancels running children;
  completed subtasks stay completed, same rule as §5.2.

**Running one subtask alone is always available.** Being in an epic doesn't
capture a task — open it, hit Run, and it executes as a normal single run with
no orchestrator involved.

### 7.7 Bulk actions and merge-into-epic

Selecting tasks in the table raises a floating action bar (§5.3). Three actions:

| Action | Behaviour |
|---|---|
| **Delete** | Confirmation naming the count; goes to trash, recoverable |
| **Run** | Queues each selected task as an independent run. Not an epic — no orchestrator, no shared plan |
| **Merge into epic** | Asks Claude to read the selected tasks and draft an epic that contains them |

**Merge into epic** reuses the compose pipeline (§7.1) with a different input:
instead of free text it gets the selected tasks, and instead of drafting a task
it drafts the *parent*. Claude proposes a title, a description covering the
shared goal, and values for the epic's own custom fields inferred from the
children — priority taking the highest of them, effort summing, type and layer
taken where the children agree and left empty where they don't.

Like compose, **it returns a draft, not a commit.** You see the proposed epic
with every field editable and the list of tasks about to be reparented, and
nothing changes until you confirm. The same rule applies for the same reason:
an AI guessing wrong silently is worse than one that asks.

### 7.8 Concurrency — one at a time by default

**Runs are serialised.** By default a project executes exactly one run at a
time; the rest queue. This is not a performance tuning knob, it is a
correctness one: **every agent writes to the same filesystem.** Two agents
editing the same repository concurrently will interleave writes, clobber each
other's edits, and produce a diff neither of them intended — and neither will
notice, because each sees a file it didn't write.

```
maxConcurrentRuns          1     # per project. Default 1.
maxOrchestratorWorkers     1     # subtask agents an epic may run at once
```

Both are project settings, both default to 1, and the settings copy states the
reason rather than just the number — someone raising it should know what they
are trading.

**The boundary is the workspace, not the machine.** Two projects with different
`workspacePath` roots write to disjoint trees, so they run concurrently without
conflict — which is why the activity dock legitimately shows Task Manager,
Homelab and RCX Briefings all running at once. Serialisation is enforced
per project. If two projects genuinely share a root, that is the case to set
one of them to a lower limit or merge them.

**Raising it is reasonable in one specific case:** an epic whose subtasks touch
disjoint files. The tool cannot verify that claim, so the setting is yours to
make and the copy says so.

### 7.9 Scheduled runs

A task can carry a schedule. When it fires, the task is queued as a normal run —
it takes its turn behind whatever is already running, obeys the same safety
policy, and is blocked by the same budget caps.

```
Schedule {
  type       once | cron
  at         ISO-8601            # once
  expression "0 20 * * 5"        # cron
  timezone   "America/Sao_Paulo"
  enabled    bool
  lastRunAt / nextRunAt
}
```

```
GET    /api/projects/:project/schedules
PUT    /api/projects/:project/tasks/:key/schedule
DELETE /api/projects/:project/tasks/:key/schedule
```

Scheduling is per task, not a separate object type, because "run this task
nightly" is a property of the task. A run created by a schedule is tagged
`trigger: "schedule"` in its record so a surprising 3am diff is traceable.

### 7.10 Suggested order

An AI-computed ordering, offered alongside the ordinary sorts. Claude reads the
open tasks and orders them by **how they influence each other** — so that work
which changes the shape of a later task comes first, and you don't implement
something twice because two tasks overlapped and nobody noticed.

```
POST /api/projects/:project/suggest-order
  →  { order: [ "TM-3", "TM-12", … ],
       rationale: [ { key, because } ],
       computedAt }
```

- It is a **snapshot, not a live sort.** The ordering is computed on demand and
  stamped; edit or add tasks and the sort chip marks itself stale with a
  recompute affordance rather than silently reordering under you.
- Each position carries a one-line **because**, reachable from the row, so the
  order is arguable rather than oracular. An ordering you can't interrogate is
  one you'll stop trusting the first time it looks wrong.
- It sorts, it does not filter or hide. Everything in the current filter set is
  still there, in a different order.

### 7.11 Credentials

No API-key UI, no key stored in the database. The Anthropic SDKs resolve
credentials from the environment — `ANTHROPIC_API_KEY`, or an `ant auth login`
profile under `~/.config/anthropic/`. The service reads whatever the shell that
launched it can see, and reports "no Anthropic credentials found" at startup if
it can't. Key custody stays where the rest of the machine's key custody is.

---

## 8. Project Docs

A **Docs** button sits in the sidebar directly under the workspace switcher,
above the search box. It opens the project's own documentation: **the contents
of `docs/` inside the workspace directory.**

Nothing is imported or copied. The files on disk are the wiki — edit them in
your editor, commit them with the code, and the tool renders whatever is
currently there. A workspace whose `docs/` doesn't exist shows the button
disabled with "No `docs/` folder in this workspace".

```
/p/:project/docs            index — the tree, plus docs/README.md if present
/p/:project/docs/*path      a rendered file
```

```
GET /api/projects/:project/docs           { tree: DocNode[] }
GET /api/projects/:project/docs/*path     rendered HTML, or the raw asset
```

- **Renders** Markdown (GitHub-flavoured: tables, task lists, fenced code with
  highlighting) and images (`png`, `jpg`, `gif`, `webp`, `svg`). Other file
  types are listed in the tree and offered as a download rather than rendered.
- **The rail becomes the tree.** On the docs screen the left rail shows the
  `docs/` folder structure instead of filter facets — same slot, contextual
  content. Filtering has nothing to act on here, the same reason it's absent
  from compose and run.
- **Relative links resolve within the tree**, so `[see the API](./api.md)`
  navigates in-app and `![](./diagram.png)` renders inline.
- **Markdown is rendered to the design system**, not to browser defaults — the
  type scale, mono treatment, and code-block styling from §9 apply.
- **Path-confined.** Same canonical-resolution check as runs (§7.3): every
  request resolves inside `workspacePath/docs/` or is rejected. `..`, symlinks
  escaping the root, and absolute paths are refused. Docs are served read-only;
  the tool never writes into `docs/`.

Requiring `workspacePath` is what makes this coherent: the same directory that a
run operates on is the directory whose docs you read. One workspace, one root,
one truth.

---

## 9. Design Language

Dark, modern, quiet. Notion's restraint, Linear's density and speed.

### Principles

1. **Content over chrome.** Borders and background separation carry structure;
   heavy shadows and outlines are avoided.
2. **One accent, used sparingly.** Colour is reserved for meaning (status,
   priority) and a single interaction accent. Everything else is neutral.
3. **Motion is functional.** 120–200ms easing to explain what moved where.
   Nothing decorative, nothing that delays input.
4. **Density is a feature.** A hundred open tasks should be scannable without
   scrolling forever, without feeling cramped.

### Direction: "drafting table"

This is an instrument, not a product — it lives in a folder on your machine and
nobody else logs into it. The palette borrows from drafting rather than SaaS: a
**warm graphite ground** the colour of pencil lead, and a **desaturated
blueprint blue** as the only interaction accent.

The warmth is load-bearing. Every project carries its own colour, so the system
accent must stay quiet enough that a clay-red project and a sage-green project
can sit side by side without the chrome shouting over either. Warm ground, cool
accent, low-chroma semantics: temperature contrast carries the hierarchy so
saturation doesn't have to.

### Tokens

**Ground** — warm graphite, not blue-black:

```
bg/base       #131211   page
bg/surface    #1A1918   cards, panels, sidebar
bg/raised     #222120   inputs, hover, board cards
bg/overlay    #292826   menus, dialogs
border/subtle #2A2927   hairlines
border/strong #3A3835   focused / emphasised
text/primary  #EAE7E1
text/secondary#9C978F
text/muted    #7A756E   (4.0:1 on base — floor for any real text)
```

**Accent** — blueprint blue. `#6FA8CE` (hover `#8CBEDE`, solid fills
`#3D7FA8` with `#F4FAFD` on top, tinted backgrounds at 13%).

**Semantic** — held at 45–60% saturation so nothing outshines a project colour:

```
backlog #6B6660   todo #9AA3AE   in_progress #C99A54
in_review #A78BC5   done #6FA57C   cancelled #55514C
urgent #CB6F63    high #C99A54    medium #7E9FBE    low #3A3835
```

Brass appears twice by design — `in_progress` and `high` both mean heat. The
glyphs differ (half-filled ring vs. stacked bars) so the column never reads
ambiguously. **Shape carries state, colour only reinforces it.**

**Project identity** — 8 tinted tones (steel, sage, brass, clay, violet, teal,
rose, grey) rendered as a tinted icon tile and a progress meter, never as an
accent rail down a card edge.

**Type** — native system stack (`-apple-system` / SF), *not* Inter. Monospace
(`ui-monospace` / SF Mono) is reserved for identifiers: task keys, field keys,
status keys. The rule is literal — **if it's mono, you can put it in a URL.**
Scale: 28/600 page titles · 17/600 task titles · 13/450 table rows ·
12/400 metadata · mono 11 identifiers · mono 10 caps/.12em section labels.

**Geometry** — 4px spacing grid, 33px table rows. Radii: 6px controls, 10px
cards, 14px panels — never larger, since soft corners at this density read as
toy-like. 1px hairlines and background steps carry structure; the only
elevation shadow in the system is a card mid-drag.

**Motion** — 120–200ms ease-out for panel slide, group collapse, view switch.
Hover is 0ms in / 140ms out so scanning never feels laggy. Rejected optimistic
writes flash the row clay and revert. `prefers-reduced-motion` zeroes all of it.

> Rendered reference: [`design/mockups.html`](design/mockups.html) — five
> screens plus the full token set.
>
> **Ground colour is settled: warm graphite.** Chosen against a cool zinc
> alternative (`#0E0E11 → #232329`); the comparison that decided it is kept at
> [`design/ground-compare.html`](design/ground-compare.html) as a record. Note
> that file predates the workspace shell and still shows the old project-list
> sidebar — it is a colour artefact, not a current layout reference.

---

## 10. Scope

### v1 — the thing that must work end to end

- Projects: create, edit, archive, delete; grid view; workspace switcher
- Tasks: full CRUD, core fields, per-project custom fields & statuses
- Views: table + board, ephemeral filter rail, saved views (§6)
- Task detail panel with inline editing
- Custom-field editor in project settings
- **AI compose** — free-text textbox → reviewable structured draft (§7.1)
- **Task runs** — Agent SDK execution with approval gate, diffs, run
  history (§7.2, §7.3)
- **Model routing** — per-task model + effort, preselected from a nominated
  schema field, overridable (§7.4)
- **Stats band** — version, task counts, three usage meters with draggable
  caps that block runs (§5, §7.5)
- **Project docs** — render the workspace's `docs/` folder, MD + images (§8)
- **Activity dock** — global, cross-project run monitor with pause and
  cancel (§5.2)
- **Project settings** — type, path, git automation, safety, routing,
  limits (§5.1)
- Full REST API with the surface in §4
- SSE live refresh, and SSE run streaming
- Seed/demo data and an OpenAPI description

### v1.5 — likely-next

- Comments, and a change log of *what* changed and when (no actor)
- Subtasks and task-to-task references
- Cross-project "my open tasks" dashboard
- Markdown attachments / file uploads
- Compose-in-place: describe an *edit* to an existing task in free text
- Run templates — a reusable prompt prefix per project

### Explicitly deferred

Recurring tasks, dependency graphs, Gantt, automation rules, webhooks,
templates, import from Jira/ClickUp.

### Settled

| Question | Decision |
|---|---|
| Plan-then-approve, or approve-as-you-go? | **Approve as you go**, with a dry-run toggle for when you want the plan first |
| Default approval policy | **Ask everything** — the safest default; loosen per project |
| Table density | **33px**, one density. No compact mode |
| Range facets for numbers and dates | **Not needed.** `effort` became a `select` (`XS`–`XL`), so it faceted as checkboxes like everything else, and `target` was dropped — it was an invented field with no purpose. Every facet is now select-based, so the range widget is out of v1 |

### Settled — "ask" was not enough

An earlier draft had no way to say *never*: every mode either ran an operation
or asked about it. **Resolved by adding a short deny list** (§7.3), shipping
with `rm -rf /` and `git push --force`, applying in every mode and not
overridable per task.

Kept deliberately short. A deny list that grows into a general-purpose
config surface stops being read, and every entry is one more thing to maintain.
Two entries that cover the two genuinely unrecoverable outcomes — losing the
filesystem, and rewriting shared history — are worth more than twenty that
nobody audits.

---

## 11. Operational Requirements

### Stack

| Layer | Choice |
|---|---|
| Language | TypeScript end to end — `Task` / `FieldDef` / `Run` types shared between server and client rather than duplicated |
| Server | Fastify — REST, static UI, and SSE on one port |
| Storage | SQLite via `better-sqlite3`, JSON columns for `fields` (§3) |
| Validation | Zod, built per project from `fieldSchema` and cached |
| AI — compose | `@anthropic-ai/sdk` · `messages.parse()` + `zodOutputFormat` · `claude-opus-5` |
| AI — run | `@anthropic-ai/claude-agent-sdk` · built-in file/bash tools · `canUseTool` permission callback as the approval gate |
| UI | React + Vite + Tailwind; dnd-kit, Radix, cmdk, TanStack Query |

Note the two Anthropic packages are different products. `@anthropic-ai/sdk` is
the Messages API client — one call, one structured response, used for compose.
`@anthropic-ai/claude-agent-sdk` is Claude Code as a library, and supplies the
agent loop and tools for runs.

### Requirements

- **One command to run.** `npm start` (or a single binary) serves API + UI on
  one port. No Docker required, no external database process required.
- **Runs are the only slow path.** A run can take minutes; nothing else may
  block on it. Runs execute out of band and report over SSE.
- **Data lives in one visible place.** A single directory under the user's home
  (or `./data`), backed up by copying a folder.
- **Crash-safe.** A kill -9 mid-write must not corrupt the store.
- **Fast enough to feel local.** p99 under 30ms for a 1000-task list query;
  UI interaction feedback under 100ms.
- **Startup under 1s.**
- **Portable.** macOS primary; Linux should work unchanged.

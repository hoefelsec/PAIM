/* The design system gallery.
 *
 * Every primitive appears here at its real size against the real ground. This
 * page is the check on the token layer: if a colour, a radius, or a duration
 * is wrong, it is wrong here first.
 */

import { useState } from "react";
import {
  DEFAULT_COMPOSE_MODEL,
  formatModelChoice,
  IDENTITY_TONES,
  OPERATIONS,
  OPERATION_RISK,
  PRIORITIES,
  RISK_VAR,
  SIZES,
  SIZE_LABEL,
  STATUSES,
  STATUS_CATEGORY,
  TASK_TYPES,
  TYPE_LABEL,
  TYPE_PREFIX,
  PRIORITY_LABEL,
  STATUS_LABEL,
  toneVar,
} from "../ui/vocabulary";
import { PriorityIcon, SizeIcon, StatusRing, TypeIcon } from "../ui/shapes";
import {
  Button,
  Chip,
  FacetHead,
  FacetRow,
  Kbd,
  Meter,
  ProjectTile,
  SizePill,
  StatusPill,
  Tabs,
} from "../ui/controls";

function Section({
  n,
  title,
  note,
  children,
}: {
  n: string;
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-t border-bd-subtle py-10">
      <div className="mb-6 flex flex-col gap-2">
        <span className="font-mono text-label uppercase text-tx-muted">
          {n}
        </span>
        <h2 className="text-task text-tx-primary">{title}</h2>
        {note && (
          <p className="max-w-[62ch] text-prop leading-relaxed text-tx-secondary">
            {note}
          </p>
        )}
      </div>
      {children}
    </section>
  );
}

function Cell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-2.5">
      <div className="grid h-9 place-items-center">{children}</div>
      <span className="font-mono text-label text-tx-muted">{label}</span>
    </div>
  );
}

const GROUND = [
  ["base", "#131211", "the page"],
  ["surface", "#1A1918", "cards, panels, the sidebar"],
  ["raised", "#222120", "inputs, hover states"],
  ["overlay", "#292826", "menus, dialogs"],
  ["bd-subtle", "#2A2927", "hairlines"],
  ["bd-strong", "#3A3835", "focus, emphasis"],
] as const;

/* The class is written out, never built from the token name: Tailwind scans
 * source text, so `text-${token}` would generate no utility at all. */
const TYPE_SCALE = [
  ["page", "text-page", "Page titles", "28 / 600 / -0.02em"],
  ["task", "text-task", "Task titles", "19 / 600 / -0.015em"],
  ["ws", "text-ws", "The workspace name", "13.5 / 600"],
  ["row", "text-row", "Table rows", "13 / 450"],
  ["prop", "text-prop", "Facet items, properties", "12.5 / 400"],
] as const;

export default function Gallery() {
  const [tab, setTab] = useState("overview");
  const [facets, setFacets] = useState<Record<string, boolean>>({
    ready: true,
    executing: true,
  });

  return (
    <div className="mx-auto max-w-[1080px] px-8 py-14">
      <header className="flex flex-col gap-3 pb-10">
        <span className="font-mono text-label uppercase text-tx-muted">
          PAIM · design system
        </span>
        <h1 className="text-page text-tx-primary">Primitives</h1>
        <p className="max-w-[64ch] text-prop leading-relaxed text-tx-secondary">
          Warm graphite ground, one desaturated blueprint accent. Every value on
          this page reads a token from{" "}
          <code className="font-mono text-id text-tx-primary">
            src/styles/tokens.css
          </code>
          , which transcribes{" "}
          <code className="font-mono text-id text-tx-primary">
            docs/13-design-language.md
          </code>
          . No component holds a literal colour.
        </p>
      </header>

      {/* ── ground ─────────────────────────────────────────────────────── */}
      <Section
        n="01"
        title="Ground"
        note="The warm ground has a function. Each project carries its own colour, so the
              interaction colour must stay quiet enough that a clay project and a sage
              project can appear together. A warm ground with a cool accent separates
              them by temperature, not by saturation."
      >
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {GROUND.map(([name, hex, use]) => (
            <div key={name} className="flex flex-col gap-2">
              <div
                className="h-16 rounded-card border border-bd-subtle"
                style={{ background: hex }}
              />
              <div className="flex flex-col gap-0.5">
                <span className="font-mono text-id text-tx-primary">{name}</span>
                <span className="font-mono text-label text-tx-muted">{hex}</span>
                <span className="text-label text-tx-muted">{use}</span>
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* ── accent ─────────────────────────────────────────────────────── */}
      <Section
        n="02"
        title="Accent"
        note="One interaction colour. It appears on a focused control, a selected tab,
              and a primary action — and nowhere else, except operation risk."
      >
        <div className="flex flex-wrap items-end gap-6">
          {(
            [
              ["accent", "var(--color-accent)"],
              ["accent-hover", "var(--color-accent-hover)"],
              ["accent-solid", "var(--color-accent-solid)"],
              ["accent-tint", "var(--color-accent-tint)"],
            ] as const
          ).map(([name, v]) => (
            <div key={name} className="flex flex-col gap-2">
              <div
                className="size-16 rounded-card border border-bd-subtle"
                style={{ background: v }}
              />
              <span className="font-mono text-label text-tx-muted">{name}</span>
            </div>
          ))}
        </div>
      </Section>

      {/* ── shape language ─────────────────────────────────────────────── */}
      <Section
        n="03"
        title="Shape marks value"
        note="Colour marks state; shape marks value. Priority and size are both scales,
              so they use different shape languages — priority grows in bar height, size
              fills in dot count. A reader never confuses the two columns. Type is not a
              scale, so each pool option gets its own silhouette."
      >
        <div className="flex flex-col gap-9">
          <div>
            <p className="mb-4 font-mono text-label uppercase text-tx-secondary">
              priority · bar height
            </p>
            <div className="flex gap-8">
              {PRIORITIES.map((p) => (
                <Cell key={p} label={PRIORITY_LABEL[p]}>
                  <PriorityIcon priority={p} />
                </Cell>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-4 font-mono text-label uppercase text-tx-secondary">
              size · dot count · empty steps are rings · epic has its own mark
            </p>
            <div className="flex gap-8">
              {SIZES.map((s) => (
                <Cell key={s} label={`${s} · ${SIZE_LABEL[s]}`}>
                  <SizeIcon size={s} />
                </Cell>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-4 font-mono text-label uppercase text-tx-secondary">
              type · silhouette · the pool is fixed, because a key prefix attaches
              to each option
            </p>
            <div className="flex gap-8">
              {TASK_TYPES.map((t) => (
                <Cell key={t} label={`${TYPE_LABEL[t]} · ${TYPE_PREFIX[t]}`}>
                  <TypeIcon type={t} />
                </Cell>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-4 font-mono text-label uppercase text-tx-secondary">
              status · a ring that fills as work progresses
            </p>
            <div className="flex flex-wrap gap-8">
              {STATUSES.map((s) => (
                <Cell key={s} label={STATUS_CATEGORY[s]}>
                  <StatusRing status={s} size={13} />
                </Cell>
              ))}
            </div>
          </div>
        </div>
      </Section>

      {/* ── status colours ─────────────────────────────────────────────── */}
      <Section
        n="04"
        title="Status and priority colour"
        note="All status values sit between 45% and 60% saturation, so no status colour
              is stronger than a project colour. Brass is both `executing` and `high`:
              both mean this needs attention now, and the shapes differ, so a column
              never needs a second reading."
      >
        <div className="flex flex-wrap gap-2.5">
          {STATUSES.map((s) => (
            <StatusPill key={s} status={s} />
          ))}
        </div>
      </Section>

      {/* ── project identity ───────────────────────────────────────────── */}
      <Section
        n="05"
        title="Project identity"
        note="Eight tones, each between 5.3:1 and 7.9:1 on the ground. A project colour
              appears as a tinted icon square and as a progress bar — never as a bar on
              the edge of a card. Tinted fill keeps eight hues on one screen without any
              of them dominating."
      >
        <div className="flex flex-wrap gap-6">
          {IDENTITY_TONES.map((tone) => (
            <div key={tone} className="flex flex-col items-start gap-2">
              <div className="flex items-center gap-2.5">
                <ProjectTile tone={tone} glyph="◈" size={24} />
                <div
                  className="h-[3px] w-16 rounded-full"
                  style={{ background: toneVar(tone) }}
                />
              </div>
              <span className="font-mono text-label text-tx-muted">{tone}</span>
            </div>
          ))}
        </div>
      </Section>

      {/* ── operation risk ─────────────────────────────────────────────── */}
      <Section
        n="06"
        title="Operation risk"
        note="The one place where the accent carries meaning, not interaction. On a run
              screen the question is never what kind of operation this is, but what it
              can do to the machine — so the palette answers that instead."
      >
        <div className="flex flex-col gap-1.5">
          {OPERATIONS.map((op) => {
            const risk = OPERATION_RISK[op];
            return (
              <div
                key={op}
                className="flex items-center gap-3 rounded-ctl border
                           border-bd-subtle bg-surface px-3 py-2"
              >
                <span
                  className="min-w-14 rounded-[4px] px-2 py-0.5 text-center
                             font-mono text-label uppercase"
                  style={{
                    color: RISK_VAR[risk],
                    background: `color-mix(in srgb, ${RISK_VAR[risk]} 14%, transparent)`,
                  }}
                >
                  {op}
                </span>
                <span className="text-prop text-tx-secondary">{risk}</span>
              </div>
            );
          })}
        </div>
      </Section>

      {/* ── type ───────────────────────────────────────────────────────── */}
      <Section
        n="07"
        title="Type"
        note="The system font stack, not Inter. Monospace marks an identifier, and the
              rule is exact: if the text is monospace, it goes in a URL or a JSON key."
      >
        <div className="flex flex-col divide-y divide-bd-subtle">
          {TYPE_SCALE.map(([token, cls, use, spec]) => (
            <div
              key={token}
              className="grid grid-cols-[10rem_1fr] items-baseline gap-6 py-4"
            >
              <div className="flex flex-col gap-1">
                <span className="font-mono text-id text-tx-primary">{cls}</span>
                <span className="font-mono text-label text-tx-muted">
                  {spec}
                </span>
              </div>
              <span className={`${cls} text-tx-primary`}>{use}</span>
            </div>
          ))}
          <div className="grid grid-cols-[10rem_1fr] items-baseline gap-6 py-4">
            <div className="flex flex-col gap-1">
              <span className="font-mono text-id text-tx-primary">text-id</span>
              <span className="font-mono text-label text-tx-muted">mono 11</span>
            </div>
            <span className="font-mono text-id text-tx-primary">PAIM-14</span>
          </div>
          <div className="grid grid-cols-[10rem_1fr] items-baseline gap-6 py-4">
            <div className="flex flex-col gap-1">
              <span className="font-mono text-id text-tx-primary">
                text-label
              </span>
              <span className="font-mono text-label text-tx-muted">
                mono 10, caps, 0.11em
              </span>
            </div>
            <span className="font-mono text-label uppercase text-tx-secondary">
              Section label
            </span>
          </div>
        </div>
      </Section>

      {/* ── controls ───────────────────────────────────────────────────── */}
      <Section
        n="08"
        title="Controls"
        note="Corner radius is 6px for a control, 10px for a card, 14px for a panel. No
              radius is larger: a large radius at this density looks incorrect."
      >
        <div className="flex flex-col gap-8">
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="primary" shortcut="R">
              ▶ Run
            </Button>
            <Button>Save view</Button>
            <Button variant="quiet">Group · Status</Button>
            <Button variant="danger">Cancel &amp; restore</Button>
            <Button disabled>Run</Button>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {SIZES.map((s) => (
              <SizePill key={s} size={s} />
            ))}
            {/* Never the effort alone: it has no meaning without the model
                that spends it. */}
            <Chip>{formatModelChoice({ model: "claude-opus-5", effort: "xhigh" })}</Chip>
            <Chip>{formatModelChoice(DEFAULT_COMPOSE_MODEL)}</Chip>
            <Chip>storage</Chip>
            <span className="text-prop text-tx-secondary">
              press <Kbd>⌘K</Kbd>
            </span>
          </div>
        </div>
      </Section>

      {/* ── meters ─────────────────────────────────────────────────────── */}
      <Section
        n="09"
        title="Usage meters"
        note="The meters are the only warning. There is no banner and no toast when a cap
              is reached. The user places the marker; a run cannot start past it."
      >
        <div className="flex flex-wrap gap-10 rounded-card border border-bd-subtle
                        bg-surface p-5">
          <Meter label="5-hour" percent={46} cap={70} resets="2h 14m" />
          <Meter label="Weekly" percent={71} cap={85} resets="Sun" />
          <Meter label="Fable" percent={62} cap={50} resets="Sun" />
        </div>
      </Section>

      {/* ── rail and tabs ──────────────────────────────────────────────── */}
      <Section
        n="10"
        title="Rail and tabs"
        note="The rail controls which tasks are in the set. The toolbar controls how the
              set appears. No control appears in both places. Each facet head names its
              source."
      >
        <div className="flex flex-wrap gap-6">
          <div
            className="rounded-card border border-bd-subtle bg-surface p-2"
            style={{ width: "var(--rail-w)" }}
          >
            <FacetHead source="pipeline">Status</FacetHead>
            {(["backlog", "ready", "executing", "testing", "done"] as const).map(
              (s, i) => (
                <FacetRow
                  key={s}
                  count={[6, 5, 3, 1, 9][i]!}
                  checked={facets[s]}
                  onToggle={() =>
                    setFacets((f) => ({ ...f, [s]: !f[s] }))
                  }
                >
                  <StatusRing status={s} />
                  {STATUS_LABEL[s]}
                </FacetRow>
              ),
            )}
            <FacetHead source="core">Priority</FacetHead>
            {(["urgent", "high", "medium", "low"] as const).map((p, i) => (
              <FacetRow
                key={p}
                count={[1, 6, 13, 8][i]!}
                checked={facets[p]}
                onToggle={() => setFacets((f) => ({ ...f, [p]: !f[p] }))}
              >
                <PriorityIcon priority={p} />
                {PRIORITY_LABEL[p]}
              </FacetRow>
            ))}
          </div>

          <div className="min-w-[340px] flex-1 rounded-card border
                          border-bd-subtle bg-surface pt-3">
            <Tabs
              active={tab}
              onSelect={setTab}
              tabs={[
                { id: "overview", label: "Overview" },
                { id: "questions", label: "Questions", badge: 2 },
                { id: "design", label: "Design" },
                { id: "run", label: "Run" },
                { id: "tests", label: "Tests", badge: 1 },
                { id: "review", label: "Review" },
              ]}
            />
            <div className="p-5 text-prop text-tx-secondary">
              The tab order is the pipeline order, so the tab row also shows
              progress. A tab appears only when the project&rsquo;s pipeline
              includes that stage.
            </div>
          </div>
        </div>
      </Section>

      {/* ── the row ────────────────────────────────────────────────────── */}
      <Section
        n="11"
        title="The table row"
        note="33 pixels, one density. Icons instead of text: the column head names the
              dimension, so the row does not repeat it. The name appears when the
              pointer is over the icon."
      >
        <div className="overflow-x-auto rounded-card border border-bd-subtle
                        bg-surface">
          <table className="w-full min-w-[640px] border-collapse text-row">
            <thead>
              <tr className="border-b border-bd-subtle">
                {["Key", "Title", "Prio", "Type", "Size", "Updated"].map(
                  (h) => (
                    <th
                      key={h}
                      className="px-3 py-2 text-left font-mono text-label
                                 font-normal uppercase text-tx-muted"
                    >
                      {h}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {/* The key is the type prefix plus a counter, and the counter is
                  one sequence for the whole project. See docs/02. */}
              {(
                [
                  ["FEAT-4", "Table view: grouping, inline edit, column resize", "high", "feature", "M", "18m ago"],
                  ["FEAT-3", "Per-project field schema validation", "high", "feature", "L", "2h ago"],
                  ["FEAT-20", "Pagination overhaul", "high", "feature", "Epic", "12m ago"],
                  ["BUG-21", "Cursor encoding is not stable across restarts", "urgent", "bug", "M", "1d ago"],
                  ["DEBT-9", "Drop the legacy field-validation path", "medium", "debt", "S", "2d ago"],
                  ["CHORE-16", "OpenAPI description from the Zod schemas", "low", "chore", "XS", "4d ago"],
                ] as const
              ).map(([key, title, prio, type, size, when]) => (
                <tr
                  key={key}
                  className="border-b border-bd-subtle/60 transition-colors
                             duration-(--dur-hover-out) last:border-0
                             hover:bg-raised hover:duration-(--dur-hover-in)"
                  style={{ height: "var(--row-h)" }}
                >
                  <td className="whitespace-nowrap px-3 font-mono text-id text-tx-muted">
                    {key}
                  </td>
                  <td className="px-3 text-tx-primary">{title}</td>
                  <td className="px-3">
                    <PriorityIcon priority={prio} />
                  </td>
                  <td className="px-3">
                    <TypeIcon type={type} />
                  </td>
                  <td className="px-3">
                    <SizeIcon size={size} height={11} />
                  </td>
                  <td className="whitespace-nowrap px-3 text-prop text-tx-muted" data-numeric>
                    {when}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <footer className="border-t border-bd-subtle pt-8 pb-4 text-label text-tx-muted">
        PAIM · Project AI Manager · tokens from docs/13-design-language.md
      </footer>
    </div>
  );
}

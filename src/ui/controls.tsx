/* Controls.
 *
 * Every value here reads a token. No component holds a literal colour, radius,
 * or duration.
 */

import type { ReactNode } from "react";
import type { IdentityTone, Size, Status } from "./vocabulary";
import { STATUS_LABEL, STATUS_VAR, toneTint, toneVar } from "./vocabulary";
import { StatusRing } from "./shapes";

const cx = (...parts: (string | false | undefined)[]) =>
  parts.filter(Boolean).join(" ");

/* ── button ─────────────────────────────────────────────────────────────── */

type ButtonProps = {
  children: ReactNode;
  variant?: "default" | "primary" | "quiet" | "danger";
  shortcut?: string;
  onClick?: () => void;
  disabled?: boolean;
};

export function Button({
  children,
  variant = "default",
  shortcut,
  onClick,
  disabled,
}: ButtonProps) {
  const base =
    "inline-flex items-center gap-2 rounded-ctl px-3 py-1.5 text-prop font-medium " +
    "transition-colors ease-(--ease) duration-(--dur-fast) " +
    "disabled:opacity-40 disabled:pointer-events-none";

  const look = {
    default:
      "bg-raised text-tx-primary border border-bd-subtle hover:border-bd-strong",
    primary:
      "bg-accent-solid text-accent-on border border-transparent hover:bg-accent",
    quiet: "text-tx-secondary hover:text-tx-primary hover:bg-raised",
    // Clay is reserved for an action with a consequence the user cannot undo.
    danger:
      "text-pr-urgent border border-pr-urgent/40 bg-pr-urgent/10 hover:bg-pr-urgent/20",
  }[variant];

  return (
    <button className={cx(base, look)} onClick={onClick} disabled={disabled}>
      {children}
      {shortcut && <Kbd>{shortcut}</Kbd>}
    </button>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd
      className="rounded-[4px] border border-bd-subtle bg-base/60 px-1.5
                 font-mono text-label leading-[1.5] text-tx-muted"
    >
      {children}
    </kbd>
  );
}

/* ── chip and pill ──────────────────────────────────────────────────────── */

/** A neutral container for one short value. It carries no state colour. */
export function Chip({ children }: { children: ReactNode }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-ctl border
                 border-bd-subtle bg-raised px-2 py-0.5 text-prop
                 text-tx-secondary"
    >
      {children}
    </span>
  );
}

/** A status pill: the ring, then the name. Colour comes from the status. */
export function StatusPill({ status }: { status: Status }) {
  return (
    <span
      className="inline-flex items-center gap-[7px] rounded-full bg-raised
                 px-2.5 py-[3px] text-prop"
      style={{
        color: "var(--color-tx-primary)",
        // STATUS_VAR, not a name built from the status: two statuses share the
        // review colour and open_questions does not match its token name.
        boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${STATUS_VAR[status]} 30%, transparent)`,
      }}
    >
      <StatusRing status={status} size={9} />
      {STATUS_LABEL[status]}
    </span>
  );
}

/** Size as text, for the property column. The table uses SizeIcon instead:
 *  a column of glyphs scans, a column of words does not. */
export function SizePill({ size }: { size: Size }) {
  const isEpic = size === "Epic";
  return (
    <span
      className={cx(
        "inline-flex min-w-8 justify-center rounded-[4px] border px-1.5",
        "font-mono text-label uppercase leading-[1.7]",
        isEpic
          ? "border-accent/40 bg-accent/10 text-accent"
          : "border-bd-subtle bg-raised text-tx-secondary",
      )}
    >
      {size}
    </span>
  );
}

/* ── project identity ───────────────────────────────────────────────────── */

/** The tinted icon square. This and the progress bar are the only two places
 *  a project colour appears. */
export function ProjectTile({
  tone,
  glyph,
  size = 17,
}: {
  tone: IdentityTone;
  glyph: string;
  size?: number;
}) {
  return (
    <span
      className="grid shrink-0 place-items-center rounded-[4px]"
      style={{
        width: size,
        height: size,
        background: toneTint(tone),
        color: toneVar(tone),
        fontSize: Math.round(size * 0.6),
      }}
    >
      {glyph}
    </span>
  );
}

/* ── usage meter ────────────────────────────────────────────────────────── */

/** A usage window with a cap marker. The meter is the only warning: there is
 *  no banner and no toast when a cap is reached. */
export function Meter({
  label,
  percent,
  cap,
  resets,
}: {
  label: string;
  percent: number;
  cap: number;
  resets: string;
}) {
  const over = percent >= cap;
  const fill = over ? "var(--color-pr-urgent)" : "var(--color-accent)";

  return (
    <div className="flex min-w-[150px] flex-col gap-1">
      <div className="flex items-baseline justify-between gap-2">
        <span
          className={cx(
            "font-mono text-label uppercase",
            over ? "text-pr-urgent" : "text-tx-muted",
          )}
        >
          {label}
        </span>
        <span className="text-label text-tx-secondary" data-numeric>
          {percent}%
        </span>
      </div>

      <div className="relative h-[3px] rounded-full bg-bd-subtle">
        <div
          className="absolute inset-y-0 left-0 rounded-full transition-[width]
                     ease-(--ease) duration-(--dur-slow)"
          style={{ width: `${Math.min(percent, 100)}%`, background: fill }}
        />
        {/* The user places the marker. A run cannot start past it. */}
        <div
          className="absolute -top-[3px] h-[9px] w-[1.5px] rounded-full
                     bg-tx-primary"
          style={{ left: `${cap}%` }}
          title={`Cap ${cap}%`}
        />
      </div>

      <span className="text-label text-tx-muted">
        cap {cap}% · resets {resets}
      </span>
    </div>
  );
}

/* ── facet ──────────────────────────────────────────────────────────────── */

/** One row in the filter rail. The rail controls which tasks are in the set;
 *  it never controls how the set appears. */
export function FacetRow({
  children,
  count,
  checked,
  onToggle,
}: {
  children: ReactNode;
  count: number;
  checked?: boolean;
  onToggle?: () => void;
}) {
  return (
    <label
      className="flex cursor-pointer items-center gap-2 rounded-ctl px-2 py-1
                 text-prop text-tx-secondary transition-colors
                 duration-(--dur-hover-out) hover:bg-raised
                 hover:duration-(--dur-hover-in) has-checked:text-tx-primary"
    >
      <input
        type="checkbox"
        checked={checked ?? false}
        onChange={onToggle}
        className="size-3.5 shrink-0 appearance-none rounded-[3px] border
                   border-bd-strong bg-center bg-no-repeat
                   checked:border-accent-solid checked:bg-accent-solid
                   checked:[background-image:var(--tick)]"
        // appearance:none removes the tick as well as the frame. Without this
        // the checked box is a filled square, which reads as a swatch.
        style={
          {
            "--tick":
              "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Cpath d='m2.6 6.2 2 2 4.2-4.6' fill='none' stroke='%23F4FAFD' stroke-width='1.7' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E\")",
          } as React.CSSProperties
        }
      />
      <span className="flex flex-1 items-center gap-2 truncate">{children}</span>
      <span className="text-label text-tx-muted" data-numeric>
        {count}
      </span>
    </label>
  );
}

/** A facet head names its source: core, pipeline, or schema. */
export function FacetHead({
  children,
  source,
}: {
  children: ReactNode;
  source: "core" | "pipeline" | "schema";
}) {
  return (
    <div className="flex items-baseline justify-between px-2 pt-3 pb-1">
      <span className="font-mono text-label uppercase text-tx-secondary">
        {children}
      </span>
      <span className="font-mono text-label text-tx-muted">{source}</span>
    </div>
  );
}

/* ── tabs ───────────────────────────────────────────────────────────────── */

/** The tab order is the pipeline order, so the tab row also shows progress. */
export function Tabs({
  tabs,
  active,
  onSelect,
}: {
  tabs: { id: string; label: string; badge?: number }[];
  active: string;
  onSelect?: (id: string) => void;
}) {
  return (
    <div className="flex gap-0.5 border-b border-bd-subtle px-5">
      {tabs.map((t) => {
        const on = t.id === active;
        return (
          <button
            key={t.id}
            onClick={() => onSelect?.(t.id)}
            className={cx(
              "flex items-center gap-2 border-b-2 px-3 py-2 text-prop",
              "transition-colors ease-(--ease) duration-(--dur-fast)",
              on
                ? "border-accent font-medium text-tx-primary"
                : "border-transparent text-tx-secondary hover:text-tx-primary",
            )}
          >
            {t.label}
            {t.badge !== undefined && (
              <em
                className="not-italic rounded-full bg-raised px-1.5 font-mono
                           text-label text-tx-secondary"
                data-numeric
              >
                {t.badge}
              </em>
            )}
          </button>
        );
      })}
    </div>
  );
}

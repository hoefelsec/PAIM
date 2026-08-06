/* The shape language.
 *
 * Colour marks state. Shape marks value.
 *
 * Priority and size are both scales, so they use different shape languages:
 * priority grows in bar HEIGHT, size fills in dot COUNT. A reader never
 * confuses the two columns. Type is not a scale, so each pool option gets its
 * own silhouette instead.
 *
 * Every glyph carries a <title>, because the name appears only when the
 * pointer is over the icon. The column head names the dimension, so the row
 * does not repeat it.
 */

import type { ReactNode } from "react";
import type { Priority, Size, Status, TaskType } from "./vocabulary";
import {
  PRIORITY_BARS,
  PRIORITY_LABEL,
  PRIORITY_VAR,
  SIZE_FILLED,
  SIZE_LABEL,
  STATUS_CATEGORY,
  STATUS_LABEL,
  STATUS_VAR,
  TYPE_LABEL,
} from "./vocabulary";

type GlyphProps = { size?: number; className?: string };

/* ── priority: bars that grow in height ─────────────────────────────────── */

export function PriorityIcon({
  priority,
  size = 13,
  className,
}: GlyphProps & { priority: Priority }) {
  const filled = PRIORITY_BARS[priority];
  const colour = PRIORITY_VAR[priority];
  // Four slots always render, so the glyph keeps one width and the column
  // stays aligned. An unfilled slot uses bd-subtle, which is darker than
  // pr-low — otherwise `low` and `none` draw the same picture.
  const heights = [3.5, 6, 8.5, 11];

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 13 13"
      role="img"
      aria-label={PRIORITY_LABEL[priority]}
      className={className}
    >
      <title>{PRIORITY_LABEL[priority]}</title>
      {heights.map((h, i) => (
        <rect
          key={i}
          x={1 + i * 3.1}
          y={12 - h}
          width={2}
          height={h}
          rx={0.6}
          fill={i < filled ? colour : "var(--color-bd-subtle)"}
        />
      ))}
    </svg>
  );
}

/* ── size: dots that fill in count, and one mark for Epic ───────────────── */

export function SizeIcon({
  size: value,
  height = 13,
  className,
}: { size: Size; height?: number; className?: string }) {
  // Epic is not on the scale. It is a container, so it gets a container mark:
  // an outline that holds two rows.
  if (value === "Epic") {
    return (
      <svg
        width={(height / 13) * 39}
        height={height}
        viewBox="0 0 39 13"
        role="img"
        aria-label={SIZE_LABEL.Epic}
        className={className}
      >
        <title>{SIZE_LABEL.Epic}</title>
        <g
          fill="none"
          stroke="var(--color-accent)"
          strokeWidth={1.1}
          strokeLinecap="round"
        >
          <rect x={0.75} y={1.75} width={13.5} height={9.5} rx={2.25} />
          <path d="M3.6 5.4h7.8M3.6 7.9h4.7" />
        </g>
      </svg>
    );
  }

  const filled = SIZE_FILLED[value];
  // Five steps in 39 units. The pitch is tight enough that the row reads as one
  // glyph and not as five separate marks.
  const pitch = 8;

  return (
    <svg
      width={(height / 13) * 39}
      height={height}
      viewBox="0 0 39 13"
      role="img"
      aria-label={SIZE_LABEL[value]}
      className={className}
    >
      <title>{SIZE_LABEL[value]}</title>
      {[0, 1, 2, 3, 4].map((i) =>
        i < filled ? (
          // A filled step is a disc.
          <circle
            key={i}
            cx={3.5 + i * pitch}
            cy={6.5}
            r={2.6}
            fill="var(--color-tx-secondary)"
          />
        ) : (
          // An empty step is a ring. Fill alone is unreadable at this size.
          <circle
            key={i}
            cx={3.5 + i * pitch}
            cy={6.5}
            r={2.1}
            fill="none"
            stroke="var(--color-bd-strong)"
            strokeWidth={1}
          />
        ),
      )}
    </svg>
  );
}

/* ── type: a silhouette for each pool option ────────────────────────────── */

const TYPE_PATH: Record<TaskType, ReactNode> = {
  // A star outline. Additive work.
  feature: (
    <path
      d="M6.5 1.4 8.1 5h3.6l-2.9 2.3 1.1 3.5-3.4-2.2-3.4 2.2 1.1-3.5L1.3 5h3.6Z"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.1}
      strokeLinejoin="round"
    />
  ),
  // Body and antennae only. Legs become noise at 13px.
  bug: (
    <g fill="none" stroke="currentColor" strokeWidth={1.1} strokeLinecap="round">
      <circle cx={6.5} cy={7.6} r={3.4} />
      <path d="M4.3 4.2 2.9 2.3M8.7 4.2l1.4-1.9" />
    </g>
  ),
  // A checked box. Maintenance that is simply done or not done.
  chore: (
    <g fill="none" stroke="currentColor" strokeWidth={1.1}>
      <rect x={1.8} y={1.8} width={9.4} height={9.4} rx={2} />
      <path d="m4.2 6.7 1.9 1.9 3-4" strokeLinecap="round" />
    </g>
  ),
  // A bolt. Short, exploratory, and time-boxed.
  spike: (
    <path
      d="M7.6 1.3 3.2 7.2h2.7l-.6 4.5 4.5-6.1H7.1Z"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.1}
      strokeLinejoin="round"
    />
  ),
  // A triangle holding a bar. A liability the codebase already carries.
  // Distinct in silhouette from the star, the circle, the square, and the bolt.
  debt: (
    <g
      fill="none"
      stroke="currentColor"
      strokeWidth={1.1}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M6.5 1.7 11.8 11H1.2Z" />
      <path d="M6.5 5.6v2.6" />
    </g>
  ),
};

export function TypeIcon({
  type,
  size = 13,
  className,
}: GlyphProps & { type: TaskType }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 13 13"
      role="img"
      aria-label={TYPE_LABEL[type]}
      className={className}
      style={{ color: "var(--color-tx-secondary)" }}
    >
      <title>{TYPE_LABEL[type]}</title>
      {TYPE_PATH[type]}
    </svg>
  );
}

/* ── status: a ring that fills as work progresses ───────────────────────── */

export function StatusRing({
  status,
  size = 11,
  className,
}: GlyphProps & { status: Status }) {
  const colour = STATUS_VAR[status];
  const category = STATUS_CATEGORY[status];
  const r = 4;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 11 11"
      role="img"
      aria-label={STATUS_LABEL[status]}
      className={className}
    >
      <title>{STATUS_LABEL[status]}</title>
      {category === "done" ? (
        // A disc. The work is complete.
        <circle cx={5.5} cy={5.5} r={r} fill={colour} />
      ) : category === "in_progress" ? (
        // A half ring. Work is under way.
        <>
          <circle
            cx={5.5}
            cy={5.5}
            r={r}
            fill="none"
            stroke={colour}
            strokeWidth={1.5}
          />
          <path d="M5.5 1.5a4 4 0 0 1 0 8Z" fill={colour} />
        </>
      ) : category === "cancelled" ? (
        // A ring with a bar. The decision was to stop.
        <>
          <circle
            cx={5.5}
            cy={5.5}
            r={r}
            fill="none"
            stroke={colour}
            strokeWidth={1.5}
          />
          <path
            d="M3.4 5.5h4.2"
            stroke={colour}
            strokeWidth={1.5}
            strokeLinecap="round"
          />
        </>
      ) : (
        // An empty ring. Nothing has started.
        <circle
          cx={5.5}
          cy={5.5}
          r={r}
          fill="none"
          stroke={colour}
          strokeWidth={1.5}
        />
      )}
    </svg>
  );
}

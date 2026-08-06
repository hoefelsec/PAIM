/* The values the design system draws.
 *
 * Every union here comes from the specification, not from the interface:
 * statuses from docs/04-status-pipeline.md, the type pool from
 * docs/03-custom-fields.md, the rest from docs/02-data-model.md. A component
 * never accepts a bare string for one of these, so a value that the palette
 * does not cover cannot reach the screen.
 */

export const STATUSES = [
  "backlog",
  "open_questions",
  "design",
  "ready",
  "executing",
  "testing",
  "ai_review",
  "manual_review",
  "done",
  "cancelled",
] as const;
export type Status = (typeof STATUSES)[number];

export type StatusCategory = "todo" | "in_progress" | "done" | "cancelled";

/** A client answers "is this task open?" from the category alone. */
export const STATUS_CATEGORY: Record<Status, StatusCategory> = {
  backlog: "todo",
  open_questions: "todo",
  design: "todo",
  ready: "todo",
  executing: "in_progress",
  testing: "in_progress",
  ai_review: "in_progress",
  manual_review: "in_progress",
  done: "done",
  cancelled: "cancelled",
};

export const STATUS_LABEL: Record<Status, string> = {
  backlog: "Backlog",
  open_questions: "Open questions",
  design: "Design",
  ready: "Ready",
  executing: "Executing",
  testing: "Testing",
  ai_review: "AI review",
  manual_review: "Manual review",
  done: "Done",
  cancelled: "Cancelled",
};

/** Colour marks state. Keyed to --color-st-* in tokens.css. */
export const STATUS_VAR: Record<Status, string> = {
  backlog: "var(--color-st-backlog)",
  open_questions: "var(--color-st-questions)",
  design: "var(--color-st-design)",
  ready: "var(--color-st-ready)",
  executing: "var(--color-st-executing)",
  testing: "var(--color-st-testing)",
  ai_review: "var(--color-st-review)",
  manual_review: "var(--color-st-review)",
  done: "var(--color-st-done)",
  cancelled: "var(--color-st-cancelled)",
};

/* ── priority ───────────────────────────────────────────────────────────── */

export const PRIORITIES = ["none", "low", "medium", "high", "urgent"] as const;
export type Priority = (typeof PRIORITIES)[number];

/** Priority grows in bar height: 0 to 4 bars.
 *
 * Four bars, not three. Priority has five values, so three bars gives four
 * pictures and two values would share one. Shape marks value, so shape alone
 * must separate all five. */
export const PRIORITY_BARS: Record<Priority, 0 | 1 | 2 | 3 | 4> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
  urgent: 4,
};

export const PRIORITY_VAR: Record<Priority, string> = {
  none: "var(--color-pr-low)",
  low: "var(--color-pr-low)",
  medium: "var(--color-pr-medium)",
  high: "var(--color-pr-high)",
  urgent: "var(--color-pr-urgent)",
};

export const PRIORITY_LABEL: Record<Priority, string> = {
  none: "No priority",
  low: "Low",
  medium: "Medium",
  high: "High",
  urgent: "Urgent",
};

/* ── size ───────────────────────────────────────────────────────────────── */

export const SIZES = ["XS", "S", "M", "L", "XL", "Epic"] as const;
export type Size = (typeof SIZES)[number];

/** kind is derived. The user cannot set it. */
export const kindOf = (size: Size): "task" | "epic" =>
  size === "Epic" ? "epic" : "task";

/** Size fills in dot count: 1 to 5 of 5. `Epic` is not on this scale and has
 *  its own mark. */
export const SIZE_FILLED: Record<Exclude<Size, "Epic">, 1 | 2 | 3 | 4 | 5> = {
  XS: 1,
  S: 2,
  M: 3,
  L: 4,
  XL: 5,
};

export const SIZE_LABEL: Record<Size, string> = {
  XS: "Extra small",
  S: "Small",
  M: "Medium",
  L: "Large",
  XL: "Extra large",
  Epic: "Epic",
};

/* ── type ───────────────────────────────────────────────────────────────────
 * `type` is a custom field, but its options come from a fixed pool: a
 * silhouette and a key prefix attach to each option, and both need a known set.
 */

export const TASK_TYPES = [
  "feature",
  "bug",
  "chore",
  "spike",
  "debt",
] as const;
export type TaskType = (typeof TASK_TYPES)[number];

export const TYPE_LABEL: Record<TaskType, string> = {
  feature: "Feature",
  bug: "Bug",
  chore: "Chore",
  spike: "Spike",
  debt: "Debt",
};

/** The key is the type prefix plus a counter. A task with no type uses TASK. */
export const TYPE_PREFIX: Record<TaskType, string> = {
  feature: "FEAT",
  bug: "BUG",
  chore: "CHORE",
  spike: "SPIKE",
  debt: "DEBT",
};

export const NO_TYPE_PREFIX = "TASK";

/* ── models and effort ──────────────────────────────────────────────────────
 * A project makes two model decisions. The compose model writes task text and
 * is one value for the project. The run model executes a task and is routed per
 * task from a nominated field. See docs/11-models-and-limits.md.
 */

export const MODELS = [
  "claude-opus-5",
  "claude-fable-5",
  "claude-sonnet-5",
  "claude-haiku-4-5",
] as const;
export type Model = (typeof MODELS)[number];

export const MODEL_USE: Record<Model, string> = {
  "claude-opus-5": "The default. Complex coding and agent work.",
  "claude-fable-5": "The highest capability. It has a separate usage limit.",
  "claude-sonnet-5": "High speed with near-Opus quality.",
  "claude-haiku-4-5": "Fast and low cost. Simple tasks.",
};

/** claude-fable-5 is metered in its own window, so the band hides that meter
 *  when the project does not permit the model. */
export const HAS_OWN_WINDOW: Model = "claude-fable-5";

export const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export type Effort = (typeof EFFORTS)[number];

/** A model and the effort it spends. Both the compose setting and a routing
 *  entry use this shape. */
export type ModelChoice = { model: Model; effort: Effort };

/** The interface never shows effort alone. An effort value has no meaning
 *  without the model that spends it. */
export const formatModelChoice = (c: ModelChoice) => `${c.model} · ${c.effort}`;

export const DEFAULT_COMPOSE_MODEL: ModelChoice = {
  model: "claude-opus-5",
  effort: "medium",
};

/* ── operation risk ─────────────────────────────────────────────────────── */

export const OPERATIONS = [
  "read",
  "glob",
  "grep",
  "write",
  "edit",
  "bash",
] as const;
export type Operation = (typeof OPERATIONS)[number];

export type Risk = "safe" | "write" | "exec";

export const OPERATION_RISK: Record<Operation, Risk> = {
  read: "safe",
  glob: "safe",
  grep: "safe",
  write: "write",
  edit: "write",
  bash: "exec",
};

export const RISK_VAR: Record<Risk, string> = {
  safe: "var(--color-op-safe)",
  write: "var(--color-op-write)",
  exec: "var(--color-op-exec)",
};

/* ── project identity ───────────────────────────────────────────────────── */

export const IDENTITY_TONES = [
  "steel",
  "sage",
  "brass",
  "clay",
  "violet",
  "teal",
  "rose",
  "grey",
] as const;
export type IdentityTone = (typeof IDENTITY_TONES)[number];

export const toneVar = (tone: IdentityTone) => `var(--color-id-${tone})`;

/** The tint is the tone at 17%. It is never a bar on the edge of a card. */
export const toneTint = (tone: IdentityTone) =>
  `color-mix(in srgb, var(--color-id-${tone}) 17%, transparent)`;

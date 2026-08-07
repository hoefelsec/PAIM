/**
 * The status catalogue of docs/04-status-pipeline.md.
 *
 * Statuses are predefined: a project selects *which* of these it uses, it
 * cannot invent one and it cannot change the order. This module holds only
 * the identity and order of the catalogue plus the required set — the
 * transition engine, the gates and the categories belong to the pipeline
 * work and are not part of the projects surface.
 */

export const STATUS_CATALOGUE = [
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

export type Status = (typeof STATUS_CATALOGUE)[number];

/**
 * docs/04: "`category` has four values: `todo`, `in_progress`, `done`,
 * `cancelled`. A client uses `category` to answer 'is this task open?'
 * without knowledge of the project's pipeline."
 */
export const STATUS_CATEGORIES = ["todo", "in_progress", "done", "cancelled"] as const;

export type StatusCategory = (typeof STATUS_CATEGORIES)[number];

/** The `Category` column of the catalogue table in docs/04. */
export const STATUS_CATEGORY = {
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
} as const satisfies Record<Status, StatusCategory>;

export function categoryOf(status: Status): StatusCategory {
  return STATUS_CATEGORY[status];
}

/** The statuses of the categories a caller named — the basis of `?open=`. */
export function statusesInCategories(categories: readonly StatusCategory[]): Status[] {
  return STATUS_CATALOGUE.filter((status) => categories.includes(STATUS_CATEGORY[status]));
}

/**
 * "Open" is `todo` or `in_progress` (docs/06 `open=true`); the complement is
 * everything the pipeline treats as closed.
 */
export const OPEN_STATUSES: Status[] = statusesInCategories(["todo", "in_progress"]);
export const CLOSED_STATUSES: Status[] = statusesInCategories(["done", "cancelled"]);

/**
 * Every project must enable these five. docs/04: "A project must include
 * open_questions, design, ready, executing, and done."
 */
export const REQUIRED_STATUSES = [
  "open_questions",
  "design",
  "ready",
  "executing",
  "done",
] as const satisfies readonly Status[];

/**
 * The pipeline a new project starts with — the settings example printed in
 * docs/04-status-pipeline.md.
 */
export const DEFAULT_STATUSES: Status[] = [
  "backlog",
  "open_questions",
  "design",
  "ready",
  "executing",
  "testing",
  "done",
];

const CATALOGUE_INDEX = new Map<string, number>(STATUS_CATALOGUE.map((s, i) => [s, i]));

export function isStatus(value: unknown): value is Status {
  return typeof value === "string" && CATALOGUE_INDEX.has(value);
}

/**
 * Sorts a set of statuses into catalogue order. The caller's order is never
 * preserved: docs/04 fixes the order of the pipeline.
 */
export function sortByCatalogue(statuses: readonly Status[]): Status[] {
  return [...statuses].sort((a, b) => CATALOGUE_INDEX.get(a)! - CATALOGUE_INDEX.get(b)!);
}

/**
 * Types shared by the server and the client. See docs/02-data-model.md.
 */

import type { FieldDef } from "./fields.js";
import type { Status } from "./statuses.js";

/** docs/12: five project types; the type picks the version source. */
export const PROJECT_TYPES = ["node", "python", "go", "rust", "generic"] as const;
export type ProjectType = (typeof PROJECT_TYPES)[number];

/** docs/02: active | archived. */
export const PROJECT_STATUSES = ["active", "archived"] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

/** docs/13 "Project identity colours" — the eight tones. */
export const PROJECT_COLORS = [
  "steel",
  "sage",
  "brass",
  "clay",
  "violet",
  "teal",
  "rose",
  "grey",
] as const;
export type ProjectColor = (typeof PROJECT_COLORS)[number];

/** docs/12 "Tests". */
export const TEST_FRAMEWORKS = ["jest", "vitest", "pytest", "go", "cargo", "custom"] as const;
export type TestFramework = (typeof TEST_FRAMEWORKS)[number];

/** docs/11 "Effort". */
export const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export type Effort = (typeof EFFORTS)[number];

/** docs/10 §4 "The three modes". */
export const SAFETY_MODES = ["allow_all", "ask_all", "ask_listed"] as const;
export type SafetyMode = (typeof SAFETY_MODES)[number];

/** docs/11 "Available models" — the default run and compose model. */
export const DEFAULT_MODEL = "claude-opus-5";

export interface SafetyPolicy {
  /** Glob patterns refused in every mode; a task cannot override them. */
  denyList: string[];
  mode: SafetyMode;
  /** Glob patterns that pause for approval under `ask_listed`. */
  askList: string[];
}

export interface ModelChoice {
  model: string;
  effort: Effort | null;
}

export interface RoutingConfig {
  /** `size`, a custom select field, or null — then every task uses `fallback`. */
  field: string | null;
  map: Record<string, ModelChoice>;
  fallback: ModelChoice;
}

/** docs/11 "Caps" — null means the service imposes no limit. */
export interface UsageCaps {
  fiveHour: number | null;
  weekly: number | null;
  fable: number | null;
}

/**
 * A custom field definition. Stored inside `projects.fieldSchema`; its shape
 * and its change rules live in ./fields.ts and src/server/fields/.
 */
export type { FieldDef };

/**
 * A regression test definition (docs/12 `TestDef`). Stored inside
 * `projects.regressionTests`; the testing gate owns its semantics.
 */
export type TestDef = Record<string, unknown>;

/** docs/02 "Task": five levels, `none` is the default. */
export const TASK_PRIORITIES = ["none", "low", "medium", "high", "urgent"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

/** docs/02 "Size": six values; `Epic` is the one that makes a task an epic. */
export const TASK_SIZES = ["XS", "S", "M", "L", "XL", "Epic"] as const;
export type TaskSize = (typeof TASK_SIZES)[number];

/** docs/02 "Epic": `kind` is derived from `size === 'Epic'`, never written directly. */
export const TASK_KINDS = ["task", "epic"] as const;
export type TaskKind = (typeof TASK_KINDS)[number];

/** docs/02 "Task" `staleReason`. */
export const STALE_REASONS = ["time", "dependency", "answers", "project_change"] as const;
export type StaleReason = (typeof STALE_REASONS)[number];

/**
 * A dependency question, a design option, a test run, and a review
 * (docs/02 `questions`, `designOptions`, `tests`, `reviews`). Their shapes
 * belong to the status-pipeline and testing-gate work; here they are only
 * JSON payloads a task carries.
 */
export type Question = Record<string, unknown>;
export type DesignOption = Record<string, unknown>;
export type TestRun = Record<string, unknown>;
export type Review = Record<string, unknown>;

/**
 * A task's schedule (docs/09 "Schedules"). Its shape belongs to the
 * schedules work; here it is only a JSON payload a task carries.
 */
export type Schedule = Record<string, unknown>;

/**
 * A task as stored and as returned by the API (docs/02 "Task"). Key
 * generation (the type-prefix counter) is T11's work; epic invariants,
 * status gates, dependencies, and staleness triggers belong to later specs
 * — this type only describes the record they read and write.
 */
export interface Task {
  id: string;
  /** The type prefix plus a per-project counter (docs/02 "Task keys"); permanent. */
  key: string;
  projectId: string;
  title: string;
  description: string;
  status: Status;
  priority: TaskPriority;
  size: TaskSize;
  kind: TaskKind;
  labels: string[];
  assignee: string | null;
  /** The epic that contains this task, or null. */
  parentId: string | null;
  /** Manual sort position. */
  order: number;
  /** Values for the project's custom fields (docs/03). */
  fields: Record<string, unknown>;
  /** null means the service selects it (docs/11). */
  model: string | null;
  effort: Effort | null;
  /** null means the project's policy applies (docs/02). */
  safety: SafetyPolicy | null;
  /** Epics only; children pass manual_review (docs/09). */
  childManualReview: boolean | null;
  schedule: Schedule | null;
  dependsOn: string[];
  questions: Question[];
  designOptions: DesignOption[];
  tests: TestRun[];
  reviews: Review[];
  /** The original text from the user (docs/05). */
  sourcePrompt: string;
  evaluatedAt: string | null;
  staleReason: StaleReason | null;
  /** Soft delete (docs/06 "The trash"); null means the task is not trashed. */
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
}

/**
 * A project as stored and as returned by the API. `version` is deliberately
 * absent: docs/02 reads it from the workspace and never stores it.
 */
export interface Project {
  id: string;
  slug: string;
  name: string;
  description: string;
  icon: string | null;
  color: ProjectColor | null;
  status: ProjectStatus;
  type: ProjectType;
  workspacePath: string | null;
  autoCommit: boolean;
  autoPush: boolean;
  statuses: Status[];
  fieldSchema: FieldDef[];
  testFramework: TestFramework | null;
  regressionTests: TestDef[];
  safety: SafetyPolicy;
  composeModel: ModelChoice;
  modelRouting: RoutingConfig;
  allowedModels: string[];
  usageCaps: UsageCaps;
  maxConcurrentRuns: number;
  trashRetentionDays: number;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

/**
 * A project as returned by the API: the stored record plus the workspace
 * version, read fresh (and cached by mtime) on every read — never stored.
 */
export type ProjectView = Project & { version: string | null };

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

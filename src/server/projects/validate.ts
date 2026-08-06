import { ApiError } from "../errors.js";
import {
  REQUIRED_STATUSES,
  isStatus,
  sortByCatalogue,
  type Status,
} from "../../shared/statuses.js";
import {
  EFFORTS,
  PROJECT_COLORS,
  PROJECT_STATUSES,
  PROJECT_TYPES,
  SAFETY_MODES,
  TEST_FRAMEWORKS,
  type Effort,
  type FieldDef,
  type ModelChoice,
  type Project,
  type RoutingConfig,
  type SafetyPolicy,
  type TestDef,
  type UsageCaps,
} from "../../shared/types.js";

/**
 * Everything about a project except its identity and timestamps — the part a
 * caller can write.
 */
export type ProjectSettings = Omit<
  Project,
  "id" | "slug" | "createdAt" | "updatedAt" | "archivedAt"
>;

/** Server-owned properties: present on reads, never accepted on writes. */
const READ_ONLY_PROPERTIES = new Set(["id", "createdAt", "updatedAt", "archivedAt", "version"]);

const WRITABLE_PROPERTIES = new Set([
  "name",
  "description",
  "icon",
  "color",
  "status",
  "type",
  "workspacePath",
  "autoCommit",
  "autoPush",
  "statuses",
  "fieldSchema",
  "testFramework",
  "regressionTests",
  "safety",
  "composeModel",
  "modelRouting",
  "allowedModels",
  "usageCaps",
  "maxConcurrentRuns",
  "trashRetentionDays",
]);

function invalid(field: string, message: string, extra?: Record<string, unknown>): never {
  throw new ApiError("VALIDATION_FAILED", 400, { field, ...extra }, `${field}: ${message}`);
}

export function asObject(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalid(field, "must be an object");
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown, field: string): string {
  if (typeof value !== "string") invalid(field, "must be a string");
  return value;
}

function asNonEmptyString(value: unknown, field: string): string {
  const s = asString(value, field).trim();
  if (s.length === 0) invalid(field, "must not be empty");
  return s;
}

/** A string, or null — `null` clears an optional value. */
function asNullableString(value: unknown, field: string): string | null {
  if (value === null) return null;
  const s = asString(value, field).trim();
  return s.length === 0 ? null : s;
}

function asBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") invalid(field, "must be a boolean");
  return value;
}

function asInteger(value: unknown, field: string, min: number): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    invalid(field, "must be an integer");
  }
  if (value < min) invalid(field, `must be at least ${min}`);
  return value;
}

function asNullableInteger(value: unknown, field: string, min: number): number | null {
  if (value === null) return null;
  return asInteger(value, field, min);
}

function asEnum<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
  const s = asString(value, field);
  if (!(allowed as readonly string[]).includes(s)) {
    invalid(field, `must be one of ${allowed.join(", ")}`, { allowed, value: s });
  }
  return s as T;
}

function asNullableEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  field: string,
): T | null {
  if (value === null) return null;
  return asEnum(value, allowed, field);
}

function asStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) invalid(field, "must be an array of strings");
  return value.map((entry, i) => asNonEmptyString(entry, `${field}[${i}]`));
}

function asObjectArray(value: unknown, field: string): Record<string, unknown>[] {
  if (!Array.isArray(value)) invalid(field, "must be an array of objects");
  return value.map((entry, i) => asObject(entry, `${field}[${i}]`));
}

/**
 * Validates the `statuses` field: a subset of the docs/04 catalogue that
 * contains the five required statuses, stored in catalogue order rather than
 * the caller's.
 */
export function normalizeStatuses(value: unknown): Status[] {
  if (!Array.isArray(value)) {
    throw new ApiError(
      "STATUSES_INVALID",
      422,
      { reason: "not_an_array" },
      "statuses must be an array of status names",
    );
  }

  const unknown = value.filter((s) => !isStatus(s));
  if (unknown.length > 0) {
    throw new ApiError(
      "STATUSES_INVALID",
      422,
      { unknown },
      `Unknown status: ${unknown.map((s) => JSON.stringify(s)).join(", ")}. ` +
        "A project selects from the catalogue; it cannot invent a status.",
    );
  }

  const selected = new Set(value as Status[]);
  const missing = REQUIRED_STATUSES.filter((s) => !selected.has(s));
  if (missing.length > 0) {
    throw new ApiError(
      "STATUSES_INVALID",
      422,
      { missing, required: [...REQUIRED_STATUSES] },
      `statuses must include the required statuses: ${missing.join(", ")}`,
    );
  }

  return sortByCatalogue([...selected]);
}

function mergeSafety(current: SafetyPolicy, value: unknown): SafetyPolicy {
  const patch = asObject(value, "safety");
  const next: SafetyPolicy = { ...current };
  for (const key of Object.keys(patch)) {
    switch (key) {
      case "denyList":
        next.denyList = asStringArray(patch["denyList"], "safety.denyList");
        break;
      case "askList":
        next.askList = asStringArray(patch["askList"], "safety.askList");
        break;
      case "mode":
        next.mode = asEnum(patch["mode"], SAFETY_MODES, "safety.mode");
        break;
      default:
        unknownProperty(`safety.${key}`);
    }
  }
  return next;
}

function mergeModelChoice(current: ModelChoice, value: unknown, field: string): ModelChoice {
  const patch = asObject(value, field);
  const next: ModelChoice = { ...current };
  for (const key of Object.keys(patch)) {
    switch (key) {
      case "model":
        next.model = asNonEmptyString(patch["model"], `${field}.model`);
        break;
      case "effort":
        next.effort = asNullableEnum<Effort>(patch["effort"], EFFORTS, `${field}.effort`);
        break;
      default:
        unknownProperty(`${field}.${key}`);
    }
  }
  return next;
}

function mergeRouting(current: RoutingConfig, value: unknown): RoutingConfig {
  const patch = asObject(value, "modelRouting");
  const next: RoutingConfig = { ...current, map: { ...current.map } };
  for (const key of Object.keys(patch)) {
    switch (key) {
      case "field":
        next.field = asNullableString(patch["field"], "modelRouting.field");
        break;
      case "fallback":
        next.fallback = mergeModelChoice(
          current.fallback,
          patch["fallback"],
          "modelRouting.fallback",
        );
        break;
      case "map": {
        // The map is replaced wholesale: a routing map is one decision, and a
        // merge would make an entry impossible to remove.
        const raw = asObject(patch["map"], "modelRouting.map");
        const map: Record<string, ModelChoice> = {};
        for (const entry of Object.keys(raw)) {
          map[entry] = mergeModelChoice(
            { model: current.fallback.model, effort: current.fallback.effort },
            raw[entry],
            `modelRouting.map.${entry}`,
          );
        }
        next.map = map;
        break;
      }
      default:
        unknownProperty(`modelRouting.${key}`);
    }
  }
  return next;
}

function mergeCaps(current: UsageCaps, value: unknown): UsageCaps {
  const patch = asObject(value, "usageCaps");
  const next: UsageCaps = { ...current };
  for (const key of Object.keys(patch)) {
    if (key !== "fiveHour" && key !== "weekly" && key !== "fable") {
      unknownProperty(`usageCaps.${key}`);
    }
    next[key] = asNullableInteger(patch[key], `usageCaps.${key}`, 0);
  }
  return next;
}

function unknownProperty(field: string): never {
  throw new ApiError("UNKNOWN_PROPERTY", 400, { field }, `Unknown property "${field}"`);
}

/**
 * Applies a partial write on top of `base` (the documented defaults on
 * create, the stored project on update) and returns the validated result.
 * Objects with their own sub-fields (`safety`, `composeModel`,
 * `modelRouting`, `usageCaps`) merge one level deep; arrays replace.
 */
export function applyProjectPatch(base: ProjectSettings, body: unknown): ProjectSettings {
  const patch = asObject(body, "body");
  const next: ProjectSettings = {
    ...base,
    statuses: [...base.statuses],
    fieldSchema: [...base.fieldSchema],
    regressionTests: [...base.regressionTests],
    allowedModels: [...base.allowedModels],
    safety: { ...base.safety },
    composeModel: { ...base.composeModel },
    modelRouting: { ...base.modelRouting, map: { ...base.modelRouting.map } },
    usageCaps: { ...base.usageCaps },
  };

  for (const key of Object.keys(patch)) {
    // `slug` is handled by the caller: on create it seeds the slug, on update
    // it is immutable (422 SLUG_IMMUTABLE).
    if (key === "slug") continue;

    if (READ_ONLY_PROPERTIES.has(key)) {
      throw new ApiError(
        "READ_ONLY_PROPERTY",
        400,
        { field: key },
        `"${key}" is set by the service and cannot be written`,
      );
    }
    if (!WRITABLE_PROPERTIES.has(key)) unknownProperty(key);

    const value = patch[key];
    switch (key) {
      case "name":
        next.name = asNonEmptyString(value, "name");
        break;
      case "description":
        next.description = value === null ? "" : asString(value, "description");
        break;
      case "icon":
        next.icon = asNullableString(value, "icon");
        break;
      case "color":
        next.color = asNullableEnum(value, PROJECT_COLORS, "color");
        break;
      case "status":
        next.status = asEnum(value, PROJECT_STATUSES, "status");
        break;
      case "type":
        next.type = asEnum(value, PROJECT_TYPES, "type");
        break;
      case "workspacePath":
        next.workspacePath = asNullableString(value, "workspacePath");
        break;
      case "autoCommit":
        next.autoCommit = asBoolean(value, "autoCommit");
        break;
      case "autoPush":
        next.autoPush = asBoolean(value, "autoPush");
        break;
      case "statuses":
        next.statuses = normalizeStatuses(value);
        break;
      case "fieldSchema":
        next.fieldSchema = asObjectArray(value, "fieldSchema") as FieldDef[];
        break;
      case "testFramework":
        next.testFramework = asNullableEnum(value, TEST_FRAMEWORKS, "testFramework");
        break;
      case "regressionTests":
        next.regressionTests = asObjectArray(value, "regressionTests") as TestDef[];
        break;
      case "safety":
        next.safety = mergeSafety(next.safety, value);
        break;
      case "composeModel":
        next.composeModel = mergeModelChoice(next.composeModel, value, "composeModel");
        break;
      case "modelRouting":
        next.modelRouting = mergeRouting(next.modelRouting, value);
        break;
      case "allowedModels":
        next.allowedModels = asStringArray(value, "allowedModels");
        break;
      case "usageCaps":
        next.usageCaps = mergeCaps(next.usageCaps, value);
        break;
      case "maxConcurrentRuns":
        next.maxConcurrentRuns = asInteger(value, "maxConcurrentRuns", 1);
        break;
      case "trashRetentionDays":
        next.trashRetentionDays = asInteger(value, "trashRetentionDays", 0);
        break;
      default:
        unknownProperty(key);
    }
  }

  // docs/12 "Git": the user cannot enable automatic push without automatic
  // commit — a push with nothing committed by the run has no meaning.
  if (next.autoPush && !next.autoCommit) {
    throw new ApiError(
      "AUTOPUSH_REQUIRES_AUTOCOMMIT",
      422,
      { autoCommit: next.autoCommit, autoPush: next.autoPush },
      "autoPush requires autoCommit",
    );
  }

  return next;
}

/**
 * The write surface of a task: which properties a caller may send, what each
 * one accepts, and what `null` means for it.
 *
 * docs/06 "Update semantics": a write performs a shallow merge on the core
 * fields, and `null` clears a value. "Clears" means back to the documented
 * empty value of that property — `null` for an optional reference, `""` for
 * text, `[]` for a list, the default for a value that cannot be absent
 * (`priority` → `none`).
 *
 * The `fields` object is not handled here: its rules need the project's
 * schema and the validator cache, so the task route owns it
 * (src/server/fields/values.ts, src/server/fields/validator.ts).
 */

import {
  asEnum,
  asNonEmptyString,
  asNullableBoolean,
  asNullableEnum,
  asNullableString,
  asNullableTimestamp,
  asNumber,
  asObject,
  asObjectArray,
  asString,
  asStringArray,
  readOnlyProperty,
  unknownProperty,
} from "../validate.js";
import { ApiError } from "../errors.js";
import type { Status } from "../../shared/statuses.js";
import {
  EFFORTS,
  SAFETY_MODES,
  STALE_REASONS,
  TASK_PRIORITIES,
  TASK_SIZES,
  type SafetyPolicy,
  type Task,
} from "../../shared/types.js";

/**
 * Everything about a task except its identity, its derived `kind`, its
 * custom `fields`, the trash marker and the timestamps — the part a caller
 * writes directly.
 */
export type TaskCore = Omit<
  Task,
  "id" | "key" | "projectId" | "kind" | "fields" | "deletedAt" | "createdAt" | "updatedAt"
>;

/**
 * docs/02 lists no default for `size`, and the column has no empty value:
 * the middle of the scale is the neutral choice for a task nobody sized.
 */
const DEFAULT_SIZE = "M" as const;

/** Server-owned properties: present on reads, never accepted on writes. */
const READ_ONLY_PROPERTIES = new Set([
  "id",
  "key",
  "projectId",
  // docs/02 "Epic": the service derives `kind` from `size`.
  "kind",
  "deletedAt",
  "createdAt",
  "updatedAt",
]);

const WRITABLE_PROPERTIES = new Set([
  "title",
  "description",
  "status",
  "priority",
  "size",
  "labels",
  "assignee",
  "parentId",
  "order",
  "fields",
  "model",
  "effort",
  "safety",
  "childManualReview",
  "schedule",
  "dependsOn",
  "questions",
  "designOptions",
  "tests",
  "reviews",
  "sourcePrompt",
  "evaluatedAt",
  "staleReason",
  "closedAt",
]);

/**
 * The status a new task starts in: the first status of the project's
 * pipeline. Every project enables `ready`, so it is the fallback when the
 * pipeline has no `backlog`.
 */
export function initialStatus(statuses: readonly Status[]): Status {
  return statuses.includes("backlog") ? "backlog" : "ready";
}

/** The documented empty task — every property a caller did not supply. */
export function defaultTaskCore(status: Status): TaskCore {
  return {
    title: "",
    description: "",
    status,
    priority: "none",
    size: DEFAULT_SIZE,
    labels: [],
    assignee: null,
    parentId: null,
    order: 0,
    model: null,
    effort: null,
    // null means the project's policy applies (docs/02).
    safety: null,
    childManualReview: null,
    schedule: null,
    dependsOn: [],
    questions: [],
    designOptions: [],
    tests: [],
    reviews: [],
    sourcePrompt: "",
    evaluatedAt: null,
    staleReason: null,
    closedAt: null,
  };
}

/** The writable half of a stored task — the base an update patch applies to. */
export function taskCore(task: Task): TaskCore {
  return {
    title: task.title,
    description: task.description,
    status: task.status,
    priority: task.priority,
    size: task.size,
    labels: task.labels,
    assignee: task.assignee,
    parentId: task.parentId,
    order: task.order,
    model: task.model,
    effort: task.effort,
    safety: task.safety,
    childManualReview: task.childManualReview,
    schedule: task.schedule,
    dependsOn: task.dependsOn,
    questions: task.questions,
    designOptions: task.designOptions,
    tests: task.tests,
    reviews: task.reviews,
    sourcePrompt: task.sourcePrompt,
    evaluatedAt: task.evaluatedAt,
    staleReason: task.staleReason,
    closedAt: task.closedAt,
  };
}

const EMPTY_SAFETY: SafetyPolicy = { denyList: [], mode: "ask_all", askList: [] };

/** A task's own safety policy: `null` hands the task back to the project's. */
function mergeSafety(current: SafetyPolicy | null, value: unknown): SafetyPolicy | null {
  if (value === null) return null;
  const patch = asObject(value, "safety");
  const next: SafetyPolicy = { ...(current ?? EMPTY_SAFETY) };
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

/**
 * A status a project does not enable is not a status this task can hold
 * (docs/02: "one of the project's statuses"). Which *moves* between enabled
 * statuses are legal is the pipeline's question, not this one.
 */
function asProjectStatus(value: unknown, statuses: readonly Status[]): Status {
  const status = asString(value, "status");
  if (!statuses.includes(status as Status)) {
    throw new ApiError(
      "STATUS_NOT_ENABLED",
      422,
      { status, statuses: [...statuses] },
      `The status "${status}" is not enabled for this project`,
    );
  }
  return status as Status;
}

export interface TaskPatchContext {
  /** The project's pipeline — the statuses a task of it may hold. */
  statuses: readonly Status[];
}

/**
 * Applies a partial write on top of `base` (the documented empty task on
 * create, the stored task on update) and returns the validated result.
 * `safety` merges one level deep; every array replaces.
 */
export function applyTaskPatch(
  base: TaskCore,
  body: unknown,
  context: TaskPatchContext,
): TaskCore {
  const patch = asObject(body, "body");
  const next: TaskCore = {
    ...base,
    labels: [...base.labels],
    dependsOn: [...base.dependsOn],
    questions: [...base.questions],
    designOptions: [...base.designOptions],
    tests: [...base.tests],
    reviews: [...base.reviews],
    safety: base.safety === null ? null : { ...base.safety },
  };

  for (const key of Object.keys(patch)) {
    // The custom fields are merged by the route, against the project schema.
    if (key === "fields") continue;

    if (READ_ONLY_PROPERTIES.has(key)) readOnlyProperty(key);
    if (!WRITABLE_PROPERTIES.has(key)) unknownProperty(key);

    const value = patch[key];
    switch (key) {
      case "title":
        next.title = asNonEmptyString(value, "title");
        break;
      case "description":
        next.description = value === null ? "" : asString(value, "description");
        break;
      case "status":
        next.status = asProjectStatus(value, context.statuses);
        break;
      case "priority":
        next.priority = value === null ? "none" : asEnum(value, TASK_PRIORITIES, "priority");
        break;
      case "size":
        next.size = value === null ? DEFAULT_SIZE : asEnum(value, TASK_SIZES, "size");
        break;
      case "labels":
        next.labels = value === null ? [] : asStringArray(value, "labels");
        break;
      case "assignee":
        next.assignee = asNullableString(value, "assignee");
        break;
      case "parentId":
        next.parentId = asNullableString(value, "parentId");
        break;
      case "order":
        next.order = value === null ? 0 : asNumber(value, "order");
        break;
      case "model":
        next.model = asNullableString(value, "model");
        break;
      case "effort":
        next.effort = asNullableEnum(value, EFFORTS, "effort");
        break;
      case "safety":
        next.safety = mergeSafety(next.safety, value);
        break;
      case "childManualReview":
        next.childManualReview = asNullableBoolean(value, "childManualReview");
        break;
      case "schedule":
        next.schedule = value === null ? null : asObject(value, "schedule");
        break;
      case "dependsOn":
        next.dependsOn = value === null ? [] : asStringArray(value, "dependsOn");
        break;
      case "questions":
        next.questions = value === null ? [] : asObjectArray(value, "questions");
        break;
      case "designOptions":
        next.designOptions = value === null ? [] : asObjectArray(value, "designOptions");
        break;
      case "tests":
        next.tests = value === null ? [] : asObjectArray(value, "tests");
        break;
      case "reviews":
        next.reviews = value === null ? [] : asObjectArray(value, "reviews");
        break;
      case "sourcePrompt":
        next.sourcePrompt = value === null ? "" : asString(value, "sourcePrompt");
        break;
      case "evaluatedAt":
        next.evaluatedAt = asNullableTimestamp(value, "evaluatedAt");
        break;
      case "staleReason":
        next.staleReason = asNullableEnum(value, STALE_REASONS, "staleReason");
        break;
      case "closedAt":
        next.closedAt = asNullableTimestamp(value, "closedAt");
        break;
      default:
        unknownProperty(key);
    }
  }

  return next;
}

/** Never written directly: docs/02 "kind is `epic` if and only if size is `Epic`". */
export function kindForSize(size: Task["size"]): Task["kind"] {
  return size === "Epic" ? "epic" : "task";
}

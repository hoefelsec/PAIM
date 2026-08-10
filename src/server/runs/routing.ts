/**
 * Model routing for a run (docs/11-models-and-limits.md "Model routing",
 * specs/09-ai-run.md, T55).
 *
 * A task runs on a **model** at an **effort**. Both values live on the task
 * and both are normally `null`, which means "the service selects the
 * value". Selecting it is what this module does, in the order docs/11
 * fixes:
 *
 *   1. the task's own override wins (`task.model`, `task.effort`);
 *   2. otherwise the project's routing field — `size`, or any custom
 *      `select` field — read off the task and looked up in `map`;
 *   3. otherwise `fallback`.
 *
 * The two overrides are independent: a task may pin the model and leave the
 * effort to the map, or the other way round, because docs/11 says "the user
 * can override the model and the effort for one task" and shows them as two
 * task columns, not one.
 *
 * Nothing is memoized on the task: the resolution reads the project's
 * current configuration every time, which is what makes docs/11's "a change
 * to the routing field re-routes the task, unless the user fixed the value
 * on that task" true without a migration.
 *
 * `allowedModels` is enforced here too (`422 MODEL_NOT_ALLOWED`), on
 * whichever value won — an override, a map entry, or the fallback.
 */

import { ApiError } from "../errors.js";
import { readFields } from "../fields/values.js";
import type { Effort, ModelChoice, Project, Task } from "../../shared/types.js";

/** Where a resolved value came from. Reported so the interface can style it. */
export type ModelSource = "task" | "map" | "fallback";

export interface ResolvedRunModel {
  model: string;
  /** null when neither the task, the map entry nor the fallback names one. */
  effort: Effort | null;
  modelSource: ModelSource;
  effortSource: ModelSource;
  /**
   * The value of the routing field that selected the map entry — `"XS"`,
   * `"backend"` — or null when the project routes nothing (no field, no
   * value on the task, or a value the map does not mention).
   */
  routingValue: string | null;
}

/**
 * The value of the project's routing field on this task, as a string, or
 * null when there is none to read.
 *
 * `size` is the built-in task column (docs/11: "The field is `size` or any
 * custom `select` field"); every other name is a custom field, read through
 * {@link readFields} so a task that never stored a value still routes on
 * the field's default (docs/03 rule 1).
 */
export function routingValueFor(project: Project, task: Task): string | null {
  const field = project.modelRouting.field;
  if (field === null || field === "") return null;
  if (field === "size") return task.size;

  const value = readFields(project.fieldSchema, task.fields)[field];
  return typeof value === "string" && value !== "" ? value : null;
}

/**
 * The choice the project's routing configuration makes for this task,
 * before the task's own overrides: the map entry for the routing value, or
 * `fallback` (docs/11: "A project with no routing field sends every task to
 * `fallback`").
 */
function routedChoice(
  project: Project,
  task: Task,
): { choice: ModelChoice; source: Exclude<ModelSource, "task">; routingValue: string | null } {
  const routingValue = routingValueFor(project, task);
  if (routingValue !== null) {
    const entry = project.modelRouting.map[routingValue];
    if (entry) return { choice: entry, source: "map", routingValue };
  }
  // A routing value the map does not mention is not an error: docs/11 maps
  // the values the project cares about and lets the rest fall back.
  return { choice: project.modelRouting.fallback, source: "fallback", routingValue: null };
}

/** The routing decision, without the `allowedModels` check. */
export function routeModel(project: Project, task: Task): ResolvedRunModel {
  const { choice, source, routingValue } = routedChoice(project, task);
  return {
    model: task.model ?? choice.model,
    effort: task.effort ?? choice.effort,
    modelSource: task.model !== null ? "task" : source,
    effortSource: task.effort !== null ? "task" : source,
    routingValue,
  };
}

/**
 * docs/11: "`allowedModels` in project settings limits which models a
 * project may use." An empty list is not an empty allowance — it is the
 * default of a new project (src/server/projects/defaults.ts), and a project
 * that may use no model at all could never run a task. An empty list
 * therefore means "no restriction"; a non-empty one is the whole list.
 */
export function isModelAllowed(project: Project, model: string): boolean {
  return project.allowedModels.length === 0 || project.allowedModels.includes(model);
}

/**
 * Refuses a model the project does not allow. specs/09 fixes the status:
 * `422 MODEL_NOT_ALLOWED` — the request is well formed, the service just
 * cannot process it against this project's settings.
 */
export function checkModelAllowed(
  project: Project,
  model: string,
  details: Record<string, unknown> = {},
): void {
  if (isModelAllowed(project, model)) return;
  throw new ApiError(
    "MODEL_NOT_ALLOWED",
    422,
    { model, allowedModels: [...project.allowedModels], project: project.slug, ...details },
    `The model "${model}" is not in the allowedModels of project "${project.slug}"`,
  );
}

/**
 * The model and effort a run of this task uses: {@link routeModel} plus the
 * `allowedModels` check. This is what the queue calls, at enqueue time (so
 * a task that can never run says so at once) and again at start time (so a
 * configuration change between the two is not missed).
 */
export function resolveRunModel(project: Project, task: Task): ResolvedRunModel {
  const resolved = routeModel(project, task);
  checkModelAllowed(project, resolved.model, {
    task: task.key,
    source: resolved.modelSource,
  });
  return resolved;
}

import { DEFAULT_STATUSES } from "../../shared/statuses.js";
import type { Project, ProjectType } from "../../shared/types.js";
import { DEFAULT_MODEL } from "../../shared/types.js";
import { seedAskList } from "../safety/askListSeeds.js";

/**
 * The documented defaults a project is created with (docs/02, docs/10,
 * docs/11, docs/12). Everything a caller does not supply comes from here.
 *
 * `type` selects the per-ecosystem ask-list seed (docs/12 "General": "[the
 * project type] gives a first ask list for that ecosystem"). Callers that
 * already know the project's type (e.g. from the create request body)
 * should pass it so the seeded list matches; it defaults to "generic".
 */
export function defaultSettings(
  type: ProjectType = "generic",
): Omit<Project, "id" | "slug" | "name" | "createdAt" | "updatedAt" | "archivedAt"> {
  return {
    description: "",
    icon: null,
    color: null,
    status: "active",
    type,
    workspacePath: null,
    autoCommit: false,
    // docs/12 "Git": automatic push is off by default.
    autoPush: false,
    statuses: [...DEFAULT_STATUSES],
    fieldSchema: [],
    testFramework: null,
    regressionTests: [],
    // docs/10 §4: "Ask everything. … This is the default." The deny list
    // starts empty; the ask list is seeded per ecosystem (docs/12 "General").
    safety: { denyList: [], mode: "ask_all", askList: seedAskList(type) },
    // docs/12 "The compose model".
    composeModel: { model: DEFAULT_MODEL, effort: "medium" },
    // docs/11: "A project with no routing field sends every task to fallback."
    modelRouting: { field: null, map: {}, fallback: { model: DEFAULT_MODEL, effort: "high" } },
    allowedModels: [],
    // docs/11 "Caps": a project without a cap has no limit from the service.
    usageCaps: { fiveHour: null, weekly: null, fable: null },
    // docs/12 "Concurrency".
    maxConcurrentRuns: 1,
    // docs/06 "The trash".
    trashRetentionDays: 30,
  };
}

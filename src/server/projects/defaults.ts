import { DEFAULT_STATUSES } from "../../shared/statuses.js";
import type { Project } from "../../shared/types.js";
import { DEFAULT_MODEL } from "../../shared/types.js";

/**
 * The documented defaults a project is created with (docs/02, docs/10,
 * docs/11, docs/12). Everything a caller does not supply comes from here.
 */
export function defaultSettings(): Omit<
  Project,
  "id" | "slug" | "name" | "createdAt" | "updatedAt" | "archivedAt"
> {
  return {
    description: "",
    icon: null,
    color: null,
    status: "active",
    type: "generic",
    workspacePath: null,
    autoCommit: false,
    // docs/12 "Git": automatic push is off by default.
    autoPush: false,
    statuses: [...DEFAULT_STATUSES],
    fieldSchema: [],
    testFramework: null,
    regressionTests: [],
    // docs/10 §4: "Ask everything. … This is the default." The per-ecosystem
    // seed ask lists belong to the safety work, so both lists start empty.
    safety: { denyList: [], mode: "ask_all", askList: [] },
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

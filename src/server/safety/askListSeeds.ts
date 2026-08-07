/**
 * Default ask-list seeds per project type (specs/08 "Default ask-list seeds
 * per project type (docs/12 General)", docs/12-project-settings.md
 * "General": "[the project type] gives a first ask list for that
 * ecosystem.").
 *
 * These are only a starting point offered when a project is created — the
 * user edits the list freely afterward (docs/10 §4). This module is pure:
 * it has no knowledge of when or whether a caller applies its result.
 */

import type { ProjectType } from "../../shared/types.js";

/** docs/10 §4's own example — dangerous, ecosystem-agnostic operations. */
const BASE_ASK_LIST = ["git push*", "git commit*", "rm *", "curl *", "*.env", "docker *"];

/** Package-manager publish/install commands that reach outside the workspace. */
const ASK_LIST_BY_TYPE: Record<ProjectType, string[]> = {
  node: [...BASE_ASK_LIST, "npm publish*", "npm install*", "npx *"],
  python: [...BASE_ASK_LIST, "pip install*", "pip uninstall*", "twine upload*"],
  go: [...BASE_ASK_LIST, "go install*", "go get*"],
  rust: [...BASE_ASK_LIST, "cargo publish*", "cargo install*"],
  generic: [...BASE_ASK_LIST],
};

/** The seed ask list offered for a project of the given type. */
export function seedAskList(type: ProjectType): string[] {
  return [...ASK_LIST_BY_TYPE[type]];
}

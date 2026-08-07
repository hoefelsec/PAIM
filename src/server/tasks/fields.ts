/**
 * The `fields` half of a task write. Three rules meet here:
 *
 * - docs/03 rule 4 — an unknown key is refused with `400 FIELD_UNKNOWN`
 *   unless `?allowUnknownFields=true` creates a hidden text field for it
 *   (src/server/fields/values.ts);
 * - docs/03 "Validation cache" — the values are type-checked against the
 *   project's cached Zod schema (src/server/fields/validator.ts);
 * - docs/06 "Update semantics" — the write is a shallow merge, and `null`
 *   clears one key.
 */

import type Database from "better-sqlite3";
import type { ZodTypeAny } from "zod";
import { updateProject } from "../db/projects.js";
import { ApiError } from "../errors.js";
import { getValidator, invalidateValidator } from "../fields/validator.js";
import { resolveFieldWrite } from "../fields/values.js";
import { asObject } from "../validate.js";
import type { Project } from "../../shared/types.js";

export interface FieldsWriteResult {
  /** The values to store on the task. */
  fields: Record<string, unknown>;
  /** The project, with the schema rule 4 may have extended. */
  project: Project;
  /** docs/03 rule 5: advisory, never a rejection. */
  warnings: string[];
}

function reportIssues(validator: ZodTypeAny, values: Record<string, unknown>): void {
  const result = validator.safeParse(values);
  if (result.success) return;

  const issues = result.error.issues.map((issue) => ({
    field: `fields.${issue.path.join(".")}`,
    message: issue.message,
  }));
  const first = issues[0];
  throw new ApiError(
    "VALIDATION_FAILED",
    400,
    { field: first?.field, issues },
    first ? `${first.field}: ${first.message}` : "The custom field values are not valid",
  );
}

/**
 * Validates a `fields` write and merges it onto `existing`. Returns the
 * merged values; when rule 4 created a field, the project row is updated and
 * its cached validator invalidated before the values are checked, so the
 * caller only has to store the task.
 */
export function applyFieldsWrite(
  db: Database.Database,
  project: Project,
  value: unknown,
  existing: Record<string, unknown>,
  allowUnknownFields: boolean,
): FieldsWriteResult {
  const incoming = value === undefined || value === null ? {} : asObject(value, "fields");

  const write = resolveFieldWrite(project.fieldSchema, incoming, {
    allowUnknownFields,
    existing,
  });

  let next = project;
  if (write.schemaChanged) {
    next = { ...project, fieldSchema: write.fieldSchema, updatedAt: new Date().toISOString() };
    updateProject(db, next);
    invalidateValidator(next.id);
  }

  reportIssues(getValidator(next.id, next.fieldSchema), incoming);

  // Shallow merge; `null` clears the key rather than storing a null value,
  // so a read reports the field's default again (docs/03 rule 1).
  const fields = { ...existing };
  for (const [key, entry] of Object.entries(incoming)) {
    if (entry === null) delete fields[key];
    else fields[key] = entry;
  }

  return { fields, project: next, warnings: write.warnings };
}

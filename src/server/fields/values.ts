/**
 * The two rules of docs/03 that apply to a write of field *values* rather
 * than to the schema itself:
 *
 *   4. an unknown key is refused with `400 FIELD_UNKNOWN`, unless
 *      `?allowUnknownFields=true`, which creates a hidden `text` field for it;
 *   5. `required` is advisory — the write succeeds and reports a warning.
 *
 * Task writes (and AI extraction) call {@link resolveFieldWrite} before they
 * store a `fields` object; {@link readFields} is the matching read.
 */

import { ApiError } from "../errors.js";
import { fieldView, humanizeKey, isFieldKey, type FieldDef } from "../../shared/fields.js";

export interface FieldWriteOptions {
  /** docs/03 rule 4: accept a key the schema does not define. */
  allowUnknownFields?: boolean;
  /** The values already stored on the record, for a partial update. */
  existing?: Record<string, unknown>;
}

export interface FieldWrite {
  /** The schema, extended with any auto-created field (rule 4). */
  fieldSchema: FieldDef[];
  /** Whether rule 4 added a field, so the caller knows to persist the schema. */
  schemaChanged: boolean;
  /** docs/06: reported to the caller; never a rejection (rule 5). */
  warnings: string[];
}

/**
 * Checks a `fields` write against the schema. Returns the schema to store
 * (unchanged unless rule 4 created a field) and the advisory warnings.
 * Throws `400 FIELD_UNKNOWN` for an undefined key without the parameter.
 */
export function resolveFieldWrite(
  schema: readonly FieldDef[],
  values: Record<string, unknown>,
  options: FieldWriteOptions = {},
): FieldWrite {
  const next = [...schema];
  const known = new Set(next.map((def) => def.key));
  const warnings: string[] = [];
  let schemaChanged = false;

  const unknown = Object.keys(values).filter((key) => !known.has(key));
  if (unknown.length > 0 && !options.allowUnknownFields) {
    throw new ApiError(
      "FIELD_UNKNOWN",
      400,
      { key: unknown[0], keys: unknown },
      `No field ${unknown.map((k) => `"${k}"`).join(", ")} in the schema of this project. ` +
        "Send ?allowUnknownFields=true to create it.",
    );
  }

  for (const key of unknown) {
    if (!isFieldKey(key)) {
      throw new ApiError(
        "VALIDATION_FAILED",
        400,
        { field: `fields.${key}`, key },
        `fields.${key}: a field key must be snake_case`,
      );
    }
    // Rule 4: the new field is text, and hidden — not a column, not a facet.
    next.push(
      fieldView({
        key,
        type: "text",
        label: humanizeKey(key),
        order: next.reduce((max, def) => Math.max(max, def.order ?? 0), 0) + 1,
        hidden: true,
      }),
    );
    known.add(key);
    schemaChanged = true;
    warnings.push(`field "${key}" was created as a hidden text field`);
  }

  // Rule 5: a missing required value is a warning, never a rejection.
  const merged = { ...(options.existing ?? {}), ...values };
  for (const def of next.map(fieldView)) {
    if (!def.required || def.hidden) continue;
    const value = merged[def.key] ?? def.default;
    if (value === undefined || value === null || value === "") {
      warnings.push(`field "${def.key}" is required and has no value`);
    }
  }

  return { fieldSchema: next, schemaChanged, warnings };
}

/**
 * The `fields` object of a read. Stored values survive the removal of their
 * field (rule 2), so every stored value is returned; a visible field with no
 * stored value reads as its `default`, or null (rule 1).
 */
export function readFields(
  schema: readonly FieldDef[],
  stored: Record<string, unknown> = {},
): Record<string, unknown> {
  const fields: Record<string, unknown> = { ...stored };
  for (const def of schema.map(fieldView)) {
    if (def.hidden) continue;
    if (fields[def.key] === undefined) fields[def.key] = def.default;
  }
  return fields;
}

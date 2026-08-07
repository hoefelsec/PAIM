/**
 * The schema engine: FieldDef parsing and the rules for change of
 * docs/03-custom-fields.md.
 *
 *   1. adding a field is always allowed;
 *   2. removing a field hides it (`hidden: true`) and never deletes values;
 *   3. a change of type is refused with `422 FIELD_TYPE_IMMUTABLE`.
 *
 * Rules 4 (unknown key on a write) and 5 (`required` is advisory) apply to
 * writes of field *values* and live in ./values.ts.
 */

import { ApiError } from "../errors.js";
import {
  FIELD_TYPES,
  TYPE_OPTIONS,
  fieldView,
  isFieldKey,
  isFieldType,
  isSelectType,
  type FieldDef,
  type FieldDefView,
  type FieldType,
} from "../../shared/fields.js";

/** Every property a caller may put in a FieldDef. `hidden` is set by rule 2. */
const FIELD_PROPERTIES = new Set([
  "key",
  "label",
  "type",
  "options",
  "required",
  "default",
  "order",
  "showInTable",
  "showAsFacet",
  "description",
  "hidden",
]);

function invalid(field: string, message: string, extra?: Record<string, unknown>): never {
  throw new ApiError("VALIDATION_FAILED", 400, { field, ...extra }, `${field}: ${message}`);
}

function asObject(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalid(field, "must be an object");
  }
  return value as Record<string, unknown>;
}

function fieldUnknown(key: string): never {
  throw new ApiError(
    "FIELD_UNKNOWN",
    400,
    { key },
    `No field "${key}" in the schema of this project`,
  );
}

function asKey(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) invalid(field, "must be a non-empty string");
  if (!isFieldKey(value)) {
    invalid(field, "must be snake_case (a lowercase letter, then lowercase, digits, _)", {
      value,
    });
  }
  return value;
}

function asType(value: unknown, field: string): FieldType {
  if (!isFieldType(value)) {
    invalid(field, `must be one of ${FIELD_TYPES.join(", ")}`, { allowed: [...FIELD_TYPES], value });
  }
  return value;
}

function asBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") invalid(field, "must be a boolean");
  return value;
}

function asOptions(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) invalid(field, "must be an array of strings");
  return value.map((entry, i) => {
    if (typeof entry !== "string" || entry.trim().length === 0) {
      invalid(`${field}[${i}]`, "must be a non-empty string");
    }
    return entry;
  });
}

/**
 * Validates options for a `type` field. The options must be a subset of the
 * predefined pool (docs/03).
 */
function validateTypeOptions(options: string[]): void {
  const poolSet = new Set(TYPE_OPTIONS);
  const unknownOptions = options.filter((opt) => !poolSet.has(opt));
  if (unknownOptions.length > 0) {
    throw new ApiError(
      "TYPE_OPTION_UNKNOWN",
      422,
      { options: unknownOptions, allowed: [...TYPE_OPTIONS] },
      `Invalid type options: ${unknownOptions.join(", ")}. ` +
        `Valid options are: ${[...TYPE_OPTIONS].join(", ")}`,
    );
  }
}

/**
 * Validates one field definition. The result keeps exactly the properties the
 * caller supplied — completion into a {@link FieldDefView} happens on read, so
 * a definition written through the project endpoint round-trips unchanged.
 */
export function parseFieldDef(value: unknown, field: string): FieldDef {
  const raw = asObject(value, field);

  for (const key of Object.keys(raw)) {
    if (!FIELD_PROPERTIES.has(key)) {
      throw new ApiError(
        "UNKNOWN_PROPERTY",
        400,
        { field: `${field}.${key}` },
        `Unknown property "${field}.${key}"`,
      );
    }
  }

  const def: FieldDef = {
    key: asKey(raw["key"], `${field}.key`),
    type: asType(raw["type"], `${field}.type`),
  };

  if (raw["label"] !== undefined) {
    if (typeof raw["label"] !== "string" || raw["label"].trim().length === 0) {
      invalid(`${field}.label`, "must be a non-empty string");
    }
    def.label = raw["label"];
  }
  if (raw["options"] !== undefined && raw["options"] !== null) {
    if (!isSelectType(def.type)) {
      invalid(`${field}.options`, "belongs to a select or multi_select field only", {
        type: def.type,
      });
    }
    def.options = asOptions(raw["options"], `${field}.options`);
    // The `type` field has a special constraint: options must come from the pool
    if (def.key === "type") {
      validateTypeOptions(def.options);
    }
  }
  if (raw["required"] !== undefined) def.required = asBoolean(raw["required"], `${field}.required`);
  if (raw["default"] !== undefined) def.default = raw["default"];
  if (raw["order"] !== undefined) {
    if (typeof raw["order"] !== "number" || !Number.isInteger(raw["order"])) {
      invalid(`${field}.order`, "must be an integer");
    }
    def.order = raw["order"];
  }
  if (raw["showInTable"] !== undefined) {
    def.showInTable = asBoolean(raw["showInTable"], `${field}.showInTable`);
  }
  if (raw["showAsFacet"] !== undefined) {
    def.showAsFacet = asBoolean(raw["showAsFacet"], `${field}.showAsFacet`);
  }
  if (raw["description"] !== undefined) {
    if (typeof raw["description"] !== "string") invalid(`${field}.description`, "must be a string");
    def.description = raw["description"];
  }
  if (raw["hidden"] !== undefined) def.hidden = asBoolean(raw["hidden"], `${field}.hidden`);

  return def;
}

/** Validates a whole `fieldSchema` array: definitions plus key uniqueness. */
export function parseFieldSchema(value: unknown, field = "fieldSchema"): FieldDef[] {
  if (!Array.isArray(value)) invalid(field, "must be an array of field definitions");

  const defs = value.map((entry, i) => parseFieldDef(entry, `${field}[${i}]`));
  const seen = new Set<string>();
  for (const def of defs) {
    if (seen.has(def.key)) {
      invalid(field, `holds the key "${def.key}" twice`, { key: def.key });
    }
    seen.add(def.key);
  }
  return defs;
}

/** Every definition completed with its defaults, in stored order. */
export function schemaView(schema: readonly FieldDef[]): FieldDefView[] {
  return schema.map(fieldView);
}

export function findField(schema: readonly FieldDef[], key: string): FieldDefView | undefined {
  const def = schema.find((entry) => entry.key === key);
  return def ? fieldView(def) : undefined;
}

/** docs/03: every field with `showInTable` is a column. Hidden fields are not. */
export function columnFields(schema: readonly FieldDef[]): FieldDefView[] {
  return schemaView(schema).filter((f) => !f.hidden && f.showInTable);
}

/** docs/03: every select / multi_select field with `showAsFacet` is a facet. */
export function facetFields(schema: readonly FieldDef[]): FieldDefView[] {
  return schemaView(schema).filter((f) => !f.hidden && f.showAsFacet && isSelectType(f.type));
}

export interface SchemaWrite {
  fieldSchema: FieldDef[];
  warnings: string[];
}

function nextOrder(schema: readonly FieldDef[]): number {
  return schema.reduce((max, def) => Math.max(max, def.order ?? 0), 0) + 1;
}

/** Merges one incoming definition onto the stored one, enforcing rule 3. */
function mergeField(current: FieldDefView, incoming: FieldDef): FieldDefView {
  if (incoming.type !== current.type) {
    throw new ApiError(
      "FIELD_TYPE_IMMUTABLE",
      422,
      { key: current.key, type: current.type, requested: incoming.type },
      `The type of "${current.key}" is ${current.type} and cannot change. ` +
        "Create a new field instead.",
    );
  }

  return {
    ...current,
    ...(incoming.label !== undefined ? { label: incoming.label } : {}),
    ...(incoming.options !== undefined && incoming.options !== null
      ? { options: incoming.options }
      : {}),
    ...(incoming.required !== undefined ? { required: incoming.required } : {}),
    ...(incoming.default !== undefined ? { default: incoming.default } : {}),
    ...(incoming.order !== undefined ? { order: incoming.order } : {}),
    ...(incoming.showInTable !== undefined ? { showInTable: incoming.showInTable } : {}),
    ...(incoming.showAsFacet !== undefined ? { showAsFacet: incoming.showAsFacet } : {}),
    ...(incoming.description !== undefined ? { description: incoming.description } : {}),
    // Rule 2 in reverse: a definition sent again shows the field, unless the
    // caller hides it in the same write.
    hidden: incoming.hidden ?? false,
  };
}

/**
 * Applies a write to `POST /api/projects/:project/schema`.
 *
 * The body is `{ fields?: FieldDef[], remove?: string[] }`; a bare array is
 * read as `fields`. Definitions are added or merged (rules 1 and 3), keys in
 * `remove` are hidden (rule 2).
 */
export function applySchemaWrite(current: readonly FieldDef[], body: unknown): SchemaWrite {
  const patch = Array.isArray(body) ? { fields: body } : asObject(body ?? {}, "body");

  for (const key of Object.keys(patch)) {
    if (key !== "fields" && key !== "remove") {
      throw new ApiError("UNKNOWN_PROPERTY", 400, { field: key }, `Unknown property "${key}"`);
    }
  }

  const incoming = patch["fields"] === undefined ? [] : parseFieldSchema(patch["fields"], "fields");
  const remove = parseRemove(patch["remove"]);
  if (incoming.length === 0 && remove.length === 0) {
    invalid("body", "must hold at least one of fields, remove");
  }

  const next = new Map<string, FieldDefView>(schemaView(current).map((def) => [def.key, def]));
  const warnings: string[] = [];

  for (const def of incoming) {
    const existing = next.get(def.key);
    if (existing) {
      next.set(def.key, mergeField(existing, def));
      continue;
    }
    // Rule 1: a new field is always safe — existing tasks have no value for it.
    const added = fieldView({ order: nextOrder([...next.values()]), ...def });
    next.set(def.key, added);
    if (added.required) {
      warnings.push(
        `field "${added.key}" is required; tasks written before now hold no value for it`,
      );
    }
  }

  for (const key of remove) {
    const existing = next.get(key);
    if (!existing) fieldUnknown(key);
    // Rule 2: removing hides the field. The values stay in the tasks.
    next.set(key, { ...existing, hidden: true });
    warnings.push(`field "${key}" is hidden; its values are kept and can be shown again`);
  }

  return { fieldSchema: [...next.values()], warnings };
}

function parseRemove(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) invalid("remove", "must be an array of field keys");
  return value.map((entry, i) => asKey(entry, `remove[${i}]`));
}

/**
 * Custom field definitions — the shape of `projects.fieldSchema`.
 * See docs/03-custom-fields.md.
 *
 * This module holds the vocabulary (types, key rule) and the completion of a
 * stored definition into the full view every surface reads. The change rules
 * live in src/server/fields/.
 */

/** docs/03 "Field types", release 1. Release 1.5 adds datetime, person, task_ref. */
export const FIELD_TYPES = [
  "text",
  "long_text",
  "number",
  "checkbox",
  "date",
  "select",
  "multi_select",
  "url",
] as const;

/**
 * docs/03: the `type` field's options come from a predefined pool.
 * Each option has a key prefix used in task.key (see docs/02 "Task keys").
 */
export const TYPE_POOL = {
  feature: "FEAT",
  bug: "BUG",
  chore: "CHORE",
  spike: "SPIKE",
  debt: "DEBT",
} as const;

export const TYPE_POOL_FALLBACK = "TASK" as const;

/** The set of valid type options for a `type` field. */
export const TYPE_OPTIONS = Object.keys(TYPE_POOL) as readonly string[];

export type FieldType = (typeof FIELD_TYPES)[number];

/** The two types whose values come from `options` — the only ones that are facets. */
export const SELECT_FIELD_TYPES = ["select", "multi_select"] as const satisfies readonly FieldType[];

/** docs/03: a key is snake_case and permanent. */
export const FIELD_KEY_PATTERN = /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/;

export function isFieldType(value: unknown): value is FieldType {
  return typeof value === "string" && (FIELD_TYPES as readonly string[]).includes(value);
}

export function isSelectType(type: FieldType): boolean {
  return (SELECT_FIELD_TYPES as readonly string[]).includes(type);
}

export function isFieldKey(value: unknown): value is string {
  return typeof value === "string" && FIELD_KEY_PATTERN.test(value);
}

/**
 * A field definition as stored inside `projects.fieldSchema`. Only `key` and
 * `type` are required; every other property has a documented default, so a
 * caller may store a sparse definition. Read one with {@link fieldView}.
 *
 * `hidden` is internal (docs/03 rule 2): removing a field sets it, which drops
 * the field from the columns and the facets but never touches stored values.
 */
export type FieldDef = {
  key: string;
  type: FieldType;
  label?: string;
  /** Select types only; `null` (or absent) everywhere else. */
  options?: string[] | null;
  required?: boolean;
  default?: unknown;
  order?: number;
  showInTable?: boolean;
  showAsFacet?: boolean;
  description?: string;
  hidden?: boolean;
};

/** A field definition with every property resolved — what the API returns. */
export interface FieldDefView {
  key: string;
  label: string;
  type: FieldType;
  options: string[] | null;
  required: boolean;
  default: unknown;
  order: number;
  showInTable: boolean;
  showAsFacet: boolean;
  description: string;
  hidden: boolean;
}

/** `layer_of_stack` → `Layer of stack`: the label a caller did not supply. */
export function humanizeKey(key: string): string {
  const words = key.replace(/_/g, " ").trim();
  return words.length === 0 ? key : words[0]!.toUpperCase() + words.slice(1);
}

/** Completes a stored definition with the documented defaults of docs/03. */
export function fieldView(def: FieldDef): FieldDefView {
  const select = isSelectType(def.type);
  return {
    key: def.key,
    label: def.label ?? humanizeKey(def.key),
    type: def.type,
    options: select ? (def.options ?? []) : null,
    required: def.required ?? false,
    default: def.default ?? null,
    order: def.order ?? 0,
    showInTable: def.showInTable ?? false,
    showAsFacet: def.showAsFacet ?? false,
    description: def.description ?? "",
    hidden: def.hidden ?? false,
  };
}

/**
 * The Zod validator cache of docs/03-custom-fields.md "Validation cache":
 *
 *   The service builds one Zod schema for each project. It caches the
 *   schema. It clears the cache entry when the schema changes and when the
 *   project is deleted.
 *
 * {@link getValidator} builds a project's schema from its `fieldSchema` the
 * first time it is asked for and returns the same cached object on every
 * later call — task writes (T12) and AI extraction (T36) rely on this to
 * avoid rebuilding a Zod schema per request. {@link invalidateValidator}
 * clears one project's entry; the schema route (on a schema write) and the
 * project route (on delete) call it so a recreated slug never inherits the
 * previous project's compiled schema.
 */

import { z, type ZodTypeAny } from "zod";
import type { FieldDef, FieldType } from "../../shared/fields.js";

/** One compiled schema per project id. */
const cache = new Map<string, ZodTypeAny>();

/** docs/03 lists no format for `date`; ISO calendar date is the stable choice. */
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function schemaForType(type: FieldType, options: readonly string[] | null | undefined): ZodTypeAny {
  const pool = options && options.length > 0 ? (options as [string, ...string[]]) : null;

  switch (type) {
    case "text":
    case "long_text":
      return z.string();
    case "number":
      return z.number();
    case "checkbox":
      return z.boolean();
    case "date":
      return z.string().regex(DATE_PATTERN, "must be an ISO date (YYYY-MM-DD)");
    case "url":
      return z.string().url();
    case "select":
      return pool ? z.enum(pool) : z.string();
    case "multi_select":
      return z.array(pool ? z.enum(pool) : z.string());
    default:
      // Unreachable for a valid FieldType, but keeps the builder total.
      return z.unknown();
  }
}

/**
 * Builds a fresh Zod schema from a project's `fieldSchema`. Never cached by
 * this function itself — call {@link getValidator} for the cached version.
 *
 * A hidden field (docs/03 rule 2) keeps its stored value but is dropped from
 * the schema that new writes are checked against, matching the fact that it
 * is no longer offered to a caller. Every other field is optional and
 * nullable here: `required` is advisory (rule 5) and enforced as a warning
 * elsewhere, not as a Zod rejection. Keys the schema does not know about are
 * passed through untouched — rule 4 (`FIELD_UNKNOWN` / `allowUnknownFields`)
 * is a concern of the field-value writer, not of this type check.
 */
export function buildFieldsSchema(schema: readonly FieldDef[]): ZodTypeAny {
  const shape: Record<string, ZodTypeAny> = {};
  for (const def of schema) {
    if (def.hidden) continue;
    shape[def.key] = schemaForType(def.type, def.options).nullable().optional();
  }
  return z.object(shape).passthrough();
}

/**
 * Returns the cached validator for `projectId`, building it from `schema`
 * on the first call. Later calls return the exact same object (`===`)
 * regardless of the `schema` argument, until {@link invalidateValidator}
 * clears the entry — callers pass the current schema so a cold cache always
 * builds a correct validator.
 */
export function getValidator(projectId: string, schema: readonly FieldDef[]): ZodTypeAny {
  const cached = cache.get(projectId);
  if (cached) return cached;

  const built = buildFieldsSchema(schema);
  cache.set(projectId, built);
  return built;
}

/**
 * Clears one project's cached validator. Called on a schema write and on
 * project delete (docs/03) — the next {@link getValidator} call rebuilds it.
 */
export function invalidateValidator(projectId: string): void {
  cache.delete(projectId);
}

/** Test-only: forget every cached validator so suites don't leak state. */
export function clearValidatorCache(): void {
  cache.clear();
}

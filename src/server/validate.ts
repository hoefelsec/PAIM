/**
 * The primitive coercers every write validator shares: they turn one JSON
 * value into a typed value or throw the documented error envelope
 * (`400 VALIDATION_FAILED` with `details.field`, `400 UNKNOWN_PROPERTY`,
 * `400 READ_ONLY_PROPERTY` — docs/06-rest-api.md "Status codes").
 *
 * The project write validator (src/server/projects/validate.ts) and the task
 * write validator (src/server/tasks/validate.ts) both build on these, so a
 * malformed value reads the same whichever record it was sent to.
 */

import { ApiError } from "./errors.js";

export function invalid(field: string, message: string, extra?: Record<string, unknown>): never {
  throw new ApiError("VALIDATION_FAILED", 400, { field, ...extra }, `${field}: ${message}`);
}

export function unknownProperty(field: string): never {
  throw new ApiError("UNKNOWN_PROPERTY", 400, { field }, `Unknown property "${field}"`);
}

/** A property the service owns: present on reads, refused on writes. */
export function readOnlyProperty(field: string): never {
  throw new ApiError(
    "READ_ONLY_PROPERTY",
    400,
    { field },
    `"${field}" is set by the service and cannot be written`,
  );
}

export function asObject(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalid(field, "must be an object");
  }
  return value as Record<string, unknown>;
}

export function asString(value: unknown, field: string): string {
  if (typeof value !== "string") invalid(field, "must be a string");
  return value;
}

export function asNonEmptyString(value: unknown, field: string): string {
  const s = asString(value, field).trim();
  if (s.length === 0) invalid(field, "must not be empty");
  return s;
}

/** A string, or null — `null` clears an optional value. */
export function asNullableString(value: unknown, field: string): string | null {
  if (value === null) return null;
  const s = asString(value, field).trim();
  return s.length === 0 ? null : s;
}

export function asBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") invalid(field, "must be a boolean");
  return value;
}

export function asNullableBoolean(value: unknown, field: string): boolean | null {
  if (value === null) return null;
  return asBoolean(value, field);
}

export function asNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) invalid(field, "must be a number");
  return value;
}

export function asInteger(value: unknown, field: string, min: number): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    invalid(field, "must be an integer");
  }
  if (value < min) invalid(field, `must be at least ${min}`);
  return value;
}

export function asNullableInteger(value: unknown, field: string, min: number): number | null {
  if (value === null) return null;
  return asInteger(value, field, min);
}

export function asEnum<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
  const s = asString(value, field);
  if (!(allowed as readonly string[]).includes(s)) {
    invalid(field, `must be one of ${allowed.join(", ")}`, { allowed, value: s });
  }
  return s as T;
}

export function asNullableEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  field: string,
): T | null {
  if (value === null) return null;
  return asEnum(value, allowed, field);
}

export function asStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) invalid(field, "must be an array of strings");
  return value.map((entry, i) => asNonEmptyString(entry, `${field}[${i}]`));
}

export function asObjectArray(value: unknown, field: string): Record<string, unknown>[] {
  if (!Array.isArray(value)) invalid(field, "must be an array of objects");
  return value.map((entry, i) => asObject(entry, `${field}[${i}]`));
}

/** An ISO-8601 timestamp, or null. */
export function asNullableTimestamp(value: unknown, field: string): string | null {
  if (value === null) return null;
  const s = asString(value, field);
  if (Number.isNaN(Date.parse(s))) invalid(field, "must be an ISO-8601 timestamp");
  return s;
}

/**
 * A `?flag=true|false` query parameter. Absent means false; anything other
 * than the two literals is a bad request rather than a silent false.
 */
export function parseBooleanFlag(value: unknown, field: string): boolean {
  if (value === undefined) return false;
  if (value === "true" || value === true) return true;
  if (value === "false" || value === false) return false;
  throw new ApiError("VALIDATION_FAILED", 400, { field }, `${field} must be true or false`);
}

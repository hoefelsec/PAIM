/**
 * The query surface of `GET /api/projects/:project/tasks`
 * (docs/06-rest-api.md "Query parameters for the list"):
 *
 *   status=ready,executing        open=true              priority=high,urgent
 *   label=backend                 assignee=edu           parent=FEAT-3
 *   size=M,L                      field.layer=backend    q=free text
 *   updatedSince=<ISO-8601>       sort=-updatedAt,order  limit=50&cursor=…
 *
 * This module turns the raw query object into a validated {@link TaskListSpec}.
 * The SQL it becomes lives in src/server/db/tasks.ts, so the two concerns —
 * "what did the caller ask for" and "how is that read from SQLite" — stay
 * apart.
 *
 * Every multi-value parameter is a comma-separated list, and a repeated
 * parameter (`?status=ready&status=done`) reads the same as one list. Values
 * of one parameter are OR-ed; different parameters are AND-ed.
 *
 * `include=children,comments` (also listed in docs/06) is not part of this
 * work and is ignored here, as is any other unknown parameter.
 */

import { createHash } from "node:crypto";
import { fieldView, isFieldKey, type FieldDef } from "../../shared/fields.js";
import { STATUS_CATALOGUE, type Status } from "../../shared/statuses.js";
import {
  TASK_PRIORITIES,
  TASK_SIZES,
  type TaskPriority,
  type TaskSize,
} from "../../shared/types.js";
import { ApiError } from "../errors.js";
import { invalid } from "../validate.js";

/** Parameters a caller may sort on. `id` is the internal tie-breaker. */
export const TASK_SORT_FIELDS = [
  "key",
  "title",
  "status",
  "priority",
  "size",
  "order",
  "assignee",
  "createdAt",
  "updatedAt",
  "closedAt",
] as const;

export type TaskSortField = (typeof TASK_SORT_FIELDS)[number] | "id";

export interface SortTerm {
  field: TaskSortField;
  direction: "asc" | "desc";
}

/** docs/06 default: the most recently touched task first. */
export const DEFAULT_SORT = "-updatedAt";

export const DEFAULT_LIMIT = 50;

/**
 * An upper bound on one page. The list is a paginated read, not a bulk
 * export: a caller who wants everything walks the cursor.
 */
export const MAX_LIMIT = 500;

/**
 * One `field.<key>=a,b` filter. `values` holds the text forms a stored value
 * may take (`true` also matches the JSON boolean, which SQLite reads as 1).
 * `matchesDefault` records that the filter also selects the field's default,
 * so tasks with no stored value for the key match too — docs/03 rule 1: "a
 * field with no stored value reads as its default".
 */
export interface FieldFilter {
  key: string;
  values: string[];
  matchesDefault: boolean;
}

export interface TaskListSpec {
  status: Status[] | null;
  /** true → the open categories, false → done and cancelled, null → no filter. */
  open: boolean | null;
  priority: TaskPriority[] | null;
  labels: string[] | null;
  assignees: string[] | null;
  /** The resolved id of the epic named by `parent`, or null for no filter. */
  parentId: string | null;
  sizes: TaskSize[] | null;
  fields: FieldFilter[];
  /** Substring of the title or the description, case-insensitive. */
  q: string | null;
  updatedSince: string | null;
  sort: SortTerm[];
  limit: number;
  /** The sort values of the last row of the previous page, in `sort` order. */
  after: unknown[] | null;
  /**
   * A fingerprint of everything but `limit` and `cursor`. A cursor carries
   * it, so a page-two request that also changed a filter is refused instead
   * of silently walking a different result set.
   */
  signature: string;
}

export interface TaskQueryContext {
  /** The project's custom fields — `field.<key>` reads their defaults. */
  fieldSchema: readonly FieldDef[];
  /** Resolves the `parent` reference (a key or a UUID) to a task id. */
  resolveParent(ref: string): string;
}

function cursorInvalid(reason: string): never {
  throw new ApiError("CURSOR_INVALID", 400, { field: "cursor", reason }, `cursor: ${reason}`);
}

/** Flattens a repeated and/or comma-separated parameter into its values. */
function csv(value: unknown, field: string): string[] {
  const entries = Array.isArray(value) ? value : [value];
  const out: string[] = [];
  for (const entry of entries) {
    if (typeof entry !== "string") invalid(field, "must be a string");
    for (const part of entry.split(",")) {
      const trimmed = part.trim();
      if (trimmed.length > 0) out.push(trimmed);
    }
  }
  if (out.length === 0) invalid(field, "must not be empty");
  return [...new Set(out)];
}

/** The last value of a repeated parameter — one scalar, whatever was sent. */
function scalar(value: unknown, field: string): string {
  const entries = Array.isArray(value) ? value : [value];
  const last = entries[entries.length - 1];
  if (typeof last !== "string") invalid(field, "must be a string");
  return last;
}

function enumCsv<T extends string>(value: unknown, allowed: readonly T[], field: string): T[] {
  return csv(value, field).map((entry) => {
    if (!(allowed as readonly string[]).includes(entry)) {
      invalid(field, `must be one of ${allowed.join(", ")}`, { allowed, value: entry });
    }
    return entry as T;
  });
}

function parseFlag(value: unknown, field: string): boolean {
  const raw = scalar(value, field);
  if (raw === "true") return true;
  if (raw === "false") return false;
  invalid(field, "must be true or false");
}

function parseLimit(value: unknown): number {
  if (value === undefined) return DEFAULT_LIMIT;
  const raw = scalar(value, "limit");
  const parsed = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isInteger(parsed)) invalid("limit", "must be an integer");
  if (parsed < 1 || parsed > MAX_LIMIT) invalid("limit", `must be between 1 and ${MAX_LIMIT}`);
  return parsed;
}

function parseSort(value: unknown): SortTerm[] {
  const terms = value === undefined ? [DEFAULT_SORT] : csv(value, "sort");
  const sort: SortTerm[] = [];
  const seen = new Set<string>();

  for (const term of terms) {
    const descending = term.startsWith("-");
    const field = descending ? term.slice(1) : term;
    if (!(TASK_SORT_FIELDS as readonly string[]).includes(field)) {
      invalid("sort", `must be one of ${TASK_SORT_FIELDS.join(", ")} (a "-" prefix descends)`, {
        allowed: [...TASK_SORT_FIELDS],
        value: field,
      });
    }
    // A repeated column would make the second one dead weight in ORDER BY
    // and add a useless term to every cursor.
    if (seen.has(field)) continue;
    seen.add(field);
    sort.push({ field: field as TaskSortField, direction: descending ? "desc" : "asc" });
  }

  // No sortable column of a task is unique, so every sort ends on the id:
  // without it two rows that tie could swap places between two pages and the
  // cursor walk would repeat or skip them.
  sort.push({ field: "id", direction: "asc" });
  return sort;
}

/**
 * The text forms one filter value may take in the JSON column. SQLite reads
 * a JSON `true` as 1 and `12.0` as 12, so a caller who writes the value the
 * way it was stored still matches.
 */
function valueCandidates(value: string): string[] {
  const candidates = [value];
  if (value === "true") candidates.push("1");
  if (value === "false") candidates.push("0");
  const asNumber = Number(value);
  if (value.trim() !== "" && Number.isFinite(asNumber)) candidates.push(String(asNumber));
  return [...new Set(candidates)];
}

/** Whether the filter selects the field's default, and so the absent value. */
function selectsDefault(def: FieldDef | undefined, candidates: readonly string[]): boolean {
  if (def === undefined) return false;
  const fallback = fieldView(def).default;
  if (fallback === null || fallback === undefined) return false;
  if (Array.isArray(fallback)) {
    return fallback.some((entry) => candidates.includes(String(entry)));
  }
  return candidates.includes(String(fallback));
}

function parseFieldFilters(
  query: Record<string, unknown>,
  schema: readonly FieldDef[],
): FieldFilter[] {
  const filters: FieldFilter[] = [];
  for (const name of Object.keys(query)) {
    if (!name.startsWith("field.")) continue;
    const key = name.slice("field.".length);
    if (!isFieldKey(key)) invalid(name, "a field key must be snake_case");

    const values = csv(query[name], name).flatMap(valueCandidates);
    filters.push({
      key,
      values: [...new Set(values)],
      matchesDefault: selectsDefault(
        schema.find((def) => def.key === key),
        values,
      ),
    });
  }
  // A stable order keeps the signature of two identical queries identical.
  return filters.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

function parseUpdatedSince(value: unknown): string {
  const raw = scalar(value, "updatedSince");
  if (Number.isNaN(Date.parse(raw))) invalid("updatedSince", "must be an ISO-8601 timestamp");
  // Stored timestamps are `Date#toISOString` output; comparing them as text
  // only works when both sides are in the same normal form.
  return new Date(raw).toISOString();
}

function signatureOf(spec: Omit<TaskListSpec, "limit" | "after" | "signature">): string {
  return createHash("sha256").update(JSON.stringify(spec)).digest("base64url").slice(0, 16);
}

export function encodeCursor(signature: string, values: readonly unknown[]): string {
  return Buffer.from(JSON.stringify({ s: signature, v: values }), "utf-8").toString("base64url");
}

function decodeCursor(raw: string, signature: string, length: number): unknown[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf-8"));
  } catch {
    cursorInvalid("not a cursor this service issued");
  }
  if (typeof parsed !== "object" || parsed === null) {
    cursorInvalid("not a cursor this service issued");
  }
  const { s, v } = parsed as { s?: unknown; v?: unknown };
  if (s !== signature) {
    cursorInvalid("belongs to a different set of filters or a different sort");
  }
  if (!Array.isArray(v) || v.length !== length) {
    cursorInvalid("does not match the sort of this request");
  }
  return v as unknown[];
}

/** Validates the raw query object of a list request. */
export function parseTaskListQuery(
  query: Record<string, unknown>,
  context: TaskQueryContext,
): TaskListSpec {
  const filters = {
    status:
      query["status"] === undefined ? null : enumCsv(query["status"], STATUS_CATALOGUE, "status"),
    open: query["open"] === undefined ? null : parseFlag(query["open"], "open"),
    priority:
      query["priority"] === undefined
        ? null
        : enumCsv(query["priority"], TASK_PRIORITIES, "priority"),
    labels: query["label"] === undefined ? null : csv(query["label"], "label"),
    assignees: query["assignee"] === undefined ? null : csv(query["assignee"], "assignee"),
    parentId:
      query["parent"] === undefined
        ? null
        : context.resolveParent(scalar(query["parent"], "parent")),
    sizes: query["size"] === undefined ? null : enumCsv(query["size"], TASK_SIZES, "size"),
    fields: parseFieldFilters(query, context.fieldSchema),
    q: query["q"] === undefined ? null : scalar(query["q"], "q").trim() || null,
    updatedSince:
      query["updatedSince"] === undefined ? null : parseUpdatedSince(query["updatedSince"]),
    sort: parseSort(query["sort"]),
  };

  const signature = signatureOf(filters);
  const after =
    query["cursor"] === undefined
      ? null
      : decodeCursor(scalar(query["cursor"], "cursor"), signature, filters.sort.length);

  return { ...filters, limit: parseLimit(query["limit"]), after, signature };
}

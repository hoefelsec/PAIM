/* The client side of the REST API (docs/06-rest-api.md).
 *
 * Every response is an envelope: `{ data }` for one record, `{ data, meta }`
 * for a list, `{ error: { code, message, details } }` for a failure. This
 * module is the only place that knows that, so a component reads records and
 * a failure carries a stable `code` rather than an HTTP status alone.
 */

export interface ListMeta {
  total: number;
  cursor: string | null;
  hasMore: boolean;
}

export interface ListEnvelope<T> {
  data: T[];
  meta: ListMeta;
}

/** A failed request. `code` is the stable one from docs/06, never a message. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

interface ErrorEnvelope {
  error?: { code?: string; message?: string; details?: unknown };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { accept: "application/json", ...(init?.headers ?? {}) },
  });

  const text = await res.text();
  let body: unknown = null;
  if (text !== "") {
    try {
      body = JSON.parse(text);
    } catch {
      throw new ApiError(res.status, "BAD_RESPONSE", `${path} did not answer JSON`);
    }
  }

  if (!res.ok) {
    const envelope = (body ?? {}) as ErrorEnvelope;
    throw new ApiError(
      res.status,
      envelope.error?.code ?? "HTTP_ERROR",
      envelope.error?.message ?? `${path} failed with ${res.status}`,
      envelope.error?.details,
    );
  }

  return body as T;
}

/** Reads one record and unwraps its envelope. */
export async function apiGet<T>(path: string): Promise<T> {
  const body = await request<{ data: T }>(path);
  return body.data;
}

/** Reads a list; the caller keeps `meta` for totals and paging. */
export function apiList<T>(path: string): Promise<ListEnvelope<T>> {
  return request<ListEnvelope<T>>(path);
}

/**
 * Creates a record and unwraps the one the service answers with (`201`, per
 * docs/06). Used by src/app/QuickCreate.tsx (T23) — the one write in the
 * client that is not an edit of an existing row.
 */
export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const envelope = await request<{ data: T }>(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return envelope.data;
}

/**
 * Writes a partial update and unwraps the record it answers with.
 *
 * `ifMatch` is the `updatedAt` the change was based on. docs/06 "Update
 * semantics": with the header the write is a compare-and-swap and answers
 * `409 IF_MATCH_FAILED` when the task moved underneath it; without it the
 * last write wins. An inline edit always sends it — the row on screen is the
 * version the user edited, and a silent overwrite of someone else's write is
 * exactly what the interface must not do.
 */
export async function apiPatch<T>(
  path: string,
  body: unknown,
  ifMatch?: string | null,
): Promise<T> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (ifMatch) headers["if-match"] = ifMatch;
  const envelope = await request<{ data: T }>(path, {
    method: "PATCH",
    headers,
    body: JSON.stringify(body),
  });
  return envelope.data;
}

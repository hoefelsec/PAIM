/**
 * Response envelopes shared by every route. See docs/06-rest-api.md.
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

export function listEnvelope<T>(data: T[], meta: ListMeta): ListEnvelope<T> {
  return { data, meta };
}

export interface ErrorBody {
  code: string;
  message: string;
  details?: unknown;
}

export interface ErrorEnvelope {
  error: ErrorBody;
}

export function errorEnvelope(code: string, message: string, details?: unknown): ErrorEnvelope {
  return {
    error: {
      code,
      message,
      ...(details !== undefined ? { details } : {}),
    },
  };
}

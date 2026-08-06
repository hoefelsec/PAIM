/**
 * Thrown anywhere in route handlers or services to produce a stable error
 * envelope. `code` is the stable machine-readable identifier clients read;
 * `status` is the HTTP status to send; `details` is optional structured
 * context (e.g. `{ key: "..." }`); `message` is a human-readable string
 * (defaults to `code` when omitted).
 */
export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: string, status: number, details?: unknown, message?: string) {
    super(message ?? code);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

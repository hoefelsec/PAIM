/**
 * The SSE utility: connection registry, heartbeat, frame formatting and
 * cleanup on disconnect (specs/06-events.md "SSE utility"). `GET /api/events`
 * is its first user; the run and activity streams of spec 09 reuse it.
 *
 * The hub knows nothing about what it carries — it takes a writable sink
 * (`reply.raw`) and JSON-serialisable payloads.
 */

/** specs/06: "heartbeat comment every 25 s". */
export const SSE_HEARTBEAT_MS = 25_000;

/** The headers a stream answers with, before the first frame. */
export const SSE_HEADERS: Record<string, string> = {
  "content-type": "text/event-stream; charset=utf-8",
  // No cache and no transform: a buffering proxy would hold the frames back.
  "cache-control": "no-cache, no-transform",
  connection: "keep-alive",
  "x-accel-buffering": "no",
};

/**
 * What the hub needs of a response: the writable half of `reply.raw`. Kept
 * this narrow so a test can hand it a plain object and no test needs a
 * socket.
 */
export interface SseSink {
  write(chunk: string): unknown;
  end(): unknown;
  on(event: "close", listener: () => void): unknown;
  readonly destroyed?: boolean;
}

export interface SseConnection {
  /** One `data:` frame carrying `payload` as JSON. */
  send(payload: unknown, name?: string): void;
  /** One `: text` comment frame — invisible to `EventSource` consumers. */
  comment(text: string): void;
  /** Ends the stream and leaves the registry. */
  close(): void;
  readonly closed: boolean;
}

export interface SseFrame {
  data: unknown;
  /** The `event:` name. Omitted frames arrive as `message`. */
  name?: string;
  id?: string | number;
}

/** A comment frame: `: text`, the shape a heartbeat takes. */
export function formatComment(text: string): string {
  return `: ${text.replace(/\n/g, " ")}\n\n`;
}

/**
 * One SSE frame. `data` is JSON, so it never contains a raw newline, but a
 * multi-line payload is still split across `data:` lines rather than
 * truncating the frame.
 */
export function formatFrame(frame: SseFrame): string {
  const lines: string[] = [];
  if (frame.id !== undefined) lines.push(`id: ${frame.id}`);
  if (frame.name !== undefined) lines.push(`event: ${frame.name}`);
  for (const line of JSON.stringify(frame.data).split("\n")) lines.push(`data: ${line}`);
  return `${lines.join("\n")}\n\n`;
}

export interface SseHubOptions {
  /** Overridden by tests only; production keeps {@link SSE_HEARTBEAT_MS}. */
  heartbeatMs?: number;
}

export interface SseAddOptions {
  /** A comment written as the first frame, so the stream opens immediately. */
  comment?: string;
}

/**
 * The connection registry. Every open stream is a member until it ends,
 * whether the server closed it or the client went away; a dropped connection
 * cleans itself out, so the registry cannot leak.
 */
export class SseHub {
  private readonly connections = new Set<SseConnection>();
  private readonly heartbeatMs: number;
  private nextId = 1;

  constructor(options: SseHubOptions = {}) {
    this.heartbeatMs = options.heartbeatMs ?? SSE_HEARTBEAT_MS;
  }

  /** How many streams are open. */
  get size(): number {
    return this.connections.size;
  }

  add(sink: SseSink, options: SseAddOptions = {}): SseConnection {
    let closed = false;
    const hub = this;

    const write = (chunk: string): void => {
      if (closed) return;
      try {
        sink.write(chunk);
      } catch {
        // A client that vanished mid-write (EPIPE) is simply gone; the
        // `close` listener may never fire for it, so drop it here.
        connection.close();
      }
    };

    const connection: SseConnection = {
      get closed() {
        return closed;
      },
      send(payload: unknown, name?: string): void {
        write(formatFrame({ data: payload, name, id: hub.nextId++ }));
      },
      comment(text: string): void {
        write(formatComment(text));
      },
      close(): void {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        hub.connections.delete(connection);
        try {
          sink.end();
        } catch {
          // Already torn down by the peer; nothing left to end.
        }
      },
    };

    const heartbeat = setInterval(() => {
      connection.comment("heartbeat");
    }, this.heartbeatMs);
    // The timer must never hold the process open on its own.
    if (typeof heartbeat.unref === "function") heartbeat.unref();

    this.connections.add(connection);
    // The peer hanging up is the usual end of a stream: leave the registry
    // and stop the heartbeat, without trying to write anything back.
    sink.on("close", () => {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      hub.connections.delete(connection);
    });

    if (options.comment !== undefined) connection.comment(options.comment);
    return connection;
  }

  /** Sends one frame to every open stream. Returns how many received it. */
  broadcast(payload: unknown, name?: string): number {
    const open = [...this.connections];
    for (const connection of open) connection.send(payload, name);
    return open.length;
  }

  /** Ends every stream — the app's `onClose`. */
  closeAll(): void {
    for (const connection of [...this.connections]) connection.close();
  }
}

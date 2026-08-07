/**
 * The SSE utility (specs/06-events.md "SSE utility"): frame format,
 * connection registry, the 25 s heartbeat and cleanup on disconnect.
 *
 * The hub writes to a sink, not to a socket, so none of this needs HTTP.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  formatComment,
  formatFrame,
  SSE_HEADERS,
  SSE_HEARTBEAT_MS,
  SseHub,
  type SseSink,
} from "../../../src/server/events/sse.js";

/** A response that records what was written to it and can hang up. */
class FakeSink implements SseSink {
  readonly chunks: string[] = [];
  ended = false;
  destroyed = false;
  /** Set to make every write fail, the way a vanished peer does (EPIPE). */
  failWrites = false;
  private readonly closeListeners: (() => void)[] = [];

  write(chunk: string): boolean {
    if (this.failWrites) throw new Error("EPIPE");
    this.chunks.push(chunk);
    return true;
  }

  end(): this {
    this.ended = true;
    return this;
  }

  on(_event: "close", listener: () => void): this {
    this.closeListeners.push(listener);
    return this;
  }

  /** The peer went away: what a real socket reports as `close`. */
  hangUp(): void {
    this.destroyed = true;
    for (const listener of this.closeListeners) listener();
  }

  get text(): string {
    return this.chunks.join("");
  }

  /** Every frame written, without the trailing blank line. */
  get frames(): string[] {
    return this.text
      .split("\n\n")
      .filter((frame) => frame.length > 0)
      .map((frame) => frame);
  }
}

afterEach(() => {
  vi.useRealTimers();
});

describe("frame format", () => {
  it("writes a JSON data frame terminated by a blank line", () => {
    expect(formatFrame({ data: { type: "task", change: "created" } })).toBe(
      'data: {"type":"task","change":"created"}\n\n',
    );
  });

  it("carries the id and the event name when they are given", () => {
    expect(formatFrame({ data: 1, id: 7, name: "change" })).toBe("id: 7\nevent: change\ndata: 1\n\n");
  });

  it("never lets a multi-line payload break the frame", () => {
    // JSON.stringify emits no raw newline, but a frame must survive one.
    const frame = formatFrame({ data: "a\nb" });
    for (const line of frame.trimEnd().split("\n")) expect(line.startsWith("data: ")).toBe(true);
  });

  it("writes a comment as a `:` frame with no data line", () => {
    expect(formatComment("heartbeat")).toBe(": heartbeat\n\n");
    expect(formatComment("two\nlines")).toBe(": two lines\n\n");
  });

  it("answers with the event-stream headers and no buffering", () => {
    expect(SSE_HEADERS["content-type"]).toBe("text/event-stream; charset=utf-8");
    expect(SSE_HEADERS["cache-control"]).toContain("no-cache");
    expect(SSE_HEADERS["x-accel-buffering"]).toBe("no");
  });
});

describe("registry", () => {
  it("registers a connection and writes the opening comment", () => {
    const hub = new SseHub();
    const sink = new FakeSink();

    hub.add(sink, { comment: "connected" });

    expect(hub.size).toBe(1);
    expect(sink.text).toBe(": connected\n\n");
  });

  it("gives every frame an id, increasing across the hub", () => {
    const hub = new SseHub();
    const sink = new FakeSink();
    const connection = hub.add(sink);

    connection.send({ n: 1 });
    connection.send({ n: 2 });

    expect(sink.frames).toEqual(['id: 1\ndata: {"n":1}', 'id: 2\ndata: {"n":2}']);
  });

  it("fans one event out to every open stream", () => {
    const hub = new SseHub();
    const sinks = Array.from({ length: 100 }, () => new FakeSink());
    for (const sink of sinks) hub.add(sink);

    const delivered = hub.broadcast({ type: "task", change: "created" });

    expect(delivered).toBe(100);
    expect(hub.size).toBe(100);
    for (const sink of sinks) {
      expect(sink.text).toContain('data: {"type":"task","change":"created"}');
    }
  });

  it("drops a connection when the client disconnects, and writes nothing more", () => {
    const hub = new SseHub();
    const sink = new FakeSink();
    const connection = hub.add(sink);

    sink.hangUp();

    expect(hub.size).toBe(0);
    expect(connection.closed).toBe(true);
    // No write is attempted on a socket the peer already closed.
    connection.send({ ignored: true });
    hub.broadcast({ ignored: true });
    expect(sink.text).toBe("");
  });

  it("leaks nothing after many connections come and go", () => {
    const hub = new SseHub();
    for (let i = 0; i < 50; i++) {
      const sink = new FakeSink();
      hub.add(sink, { comment: "connected" });
      hub.broadcast({ i });
      sink.hangUp();
    }
    expect(hub.size).toBe(0);
  });

  it("drops a connection whose write fails", () => {
    const hub = new SseHub();
    const sink = new FakeSink();
    const connection = hub.add(sink);

    sink.failWrites = true;
    connection.send({ n: 1 });

    expect(hub.size).toBe(0);
    expect(connection.closed).toBe(true);
  });

  it("ends the response when the server closes a stream", () => {
    const hub = new SseHub();
    const sink = new FakeSink();
    const connection = hub.add(sink);

    connection.close();

    expect(sink.ended).toBe(true);
    expect(hub.size).toBe(0);
    // Closing twice is harmless.
    connection.close();
  });

  it("closes every stream on closeAll", () => {
    const hub = new SseHub();
    const sinks = [new FakeSink(), new FakeSink(), new FakeSink()];
    for (const sink of sinks) hub.add(sink);

    hub.closeAll();

    expect(hub.size).toBe(0);
    for (const sink of sinks) expect(sink.ended).toBe(true);
  });
});

describe("heartbeat", () => {
  it("writes a comment every 25 s", () => {
    vi.useFakeTimers();
    expect(SSE_HEARTBEAT_MS).toBe(25_000);

    const hub = new SseHub();
    const sink = new FakeSink();
    hub.add(sink);

    vi.advanceTimersByTime(SSE_HEARTBEAT_MS - 1);
    expect(sink.frames).toEqual([]);

    vi.advanceTimersByTime(1);
    expect(sink.frames).toEqual([": heartbeat"]);

    vi.advanceTimersByTime(SSE_HEARTBEAT_MS);
    expect(sink.frames).toEqual([": heartbeat", ": heartbeat"]);
  });

  it("stops the heartbeat of a connection that went away", () => {
    vi.useFakeTimers();
    const hub = new SseHub({ heartbeatMs: 10 });
    const sink = new FakeSink();
    hub.add(sink);

    sink.hangUp();
    vi.advanceTimersByTime(100);

    expect(sink.text).toBe("");
    expect(vi.getTimerCount()).toBe(0);
  });
});

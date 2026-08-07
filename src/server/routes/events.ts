/**
 * `GET /api/events` — the data-change stream (docs/06-rest-api.md "The
 * events stream").
 *
 * One stream carries every change: tasks, projects, schemas and saved views.
 * The frames come from the storage layer's change bus
 * (src/server/events/changes.ts), so a write made by any route — or by a
 * script writing through the same storage functions — is on the stream.
 */

import type Database from "better-sqlite3";
import type { FastifyInstance, FastifyPluginOptions } from "fastify";
import { SSE_HEADERS, type SseHub } from "../events/sse.js";

export interface EventRoutesOptions extends FastifyPluginOptions {
  /** Resolved per request so the database opens lazily. */
  getDb(): Database.Database;
  hub: SseHub;
}

export async function eventRoutes(
  app: FastifyInstance,
  options: EventRoutesOptions,
): Promise<void> {
  const { getDb, hub } = options;

  app.get("/api/events", (_req, reply) => {
    // Opening the database is what subscribes the hub to the change bus
    // (see createApp), so it must happen before the stream is registered —
    // otherwise the first write after a cold start would miss it.
    getDb();

    // `Last-Event-ID` is accepted and ignored: the stream keeps no history
    // (specs/06 — "replay not required"). A client that reconnects
    // revalidates its queries instead.

    // Fastify must not try to send a response of its own: from here the
    // socket belongs to the hub.
    reply.hijack();
    reply.raw.writeHead(200, SSE_HEADERS);
    hub.add(reply.raw, { comment: "connected" });
  });
}

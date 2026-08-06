import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import Fastify, { type FastifyInstance } from "fastify";
import { ApiError } from "./errors.js";
import { errorEnvelope } from "./envelope.js";

const pkgPath = fileURLToPath(new URL("../../package.json", import.meta.url));
const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as { version: string };

/**
 * Builds the Fastify app without starting a listener, so tests can
 * `app.inject()` against it directly. See src/server/index.ts for the
 * process entry point that listens.
 */
export function createApp(): FastifyInstance {
  const app = Fastify({ logger: false });

  app.get("/api/health", async () => ({
    data: { ok: true, version: pkg.version },
  }));

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ApiError) {
      reply.status(err.status).send(errorEnvelope(err.code, err.message, err.details));
      return;
    }
    // Unknown errors never leak internals (message, stack) to the client.
    reply.status(500).send(errorEnvelope("INTERNAL", "Internal server error"));
  });

  app.setNotFoundHandler((_req, reply) => {
    reply.status(404).send(errorEnvelope("NOT_FOUND", "Not found"));
  });

  return app;
}

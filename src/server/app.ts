import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import Fastify, { type FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import { ApiError } from "./errors.js";
import { errorEnvelope } from "./envelope.js";
import { PORT } from "./config.js";

const pkgPath = fileURLToPath(new URL("../../package.json", import.meta.url));
const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as { version: string };

const DEFAULT_DIST_DIR = fileURLToPath(new URL("../../dist", import.meta.url));

/**
 * The only two `Host` header values a request may present. Anything else
 * (a hostile DNS-rebound name, another machine's hostname) is rejected
 * before routing — see docs/15-open-questions.md Q3 and
 * docs/10-execution-safety.md §1.
 */
const ALLOWED_HOSTS = new Set([`localhost:${PORT}`, `127.0.0.1:${PORT}`]);

export interface CreateAppOptions {
  /**
   * Directory the built client is served from. Defaults to `dist/` at the
   * repo root. Tests override this to point at a fixture directory so they
   * don't depend on a real client build.
   */
  staticDir?: string;
}

/**
 * Builds the Fastify app without starting a listener, so tests can
 * `app.inject()` against it directly. See src/server/index.ts for the
 * process entry point that listens.
 */
export function createApp(options: CreateAppOptions = {}): FastifyInstance {
  const app = Fastify({ logger: false });
  const staticDir = options.staticDir ?? DEFAULT_DIST_DIR;

  // Loopback-only binding (see src/server/index.ts) keeps other machines
  // out; this hook keeps a hostile page on the same machine from reaching
  // the API by way of DNS rebinding, since a rebound name stays in the
  // Host header even once it resolves to 127.0.0.1.
  app.addHook("onRequest", async (req) => {
    const host = req.headers.host;
    if (!host || !ALLOWED_HOSTS.has(host)) {
      throw new ApiError("HOST_NOT_ALLOWED", 403, { host: host ?? null }, "Host not allowed");
    }
  });

  app.get("/api/health", async () => ({
    data: { ok: true, version: pkg.version },
  }));

  if (existsSync(staticDir)) {
    app.register(fastifyStatic, {
      root: staticDir,
      wildcard: false,
    });
  }

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ApiError) {
      reply.status(err.status).send(errorEnvelope(err.code, err.message, err.details));
      return;
    }
    // Unknown errors never leak internals (message, stack) to the client.
    reply.status(500).send(errorEnvelope("INTERNAL", "Internal server error"));
  });

  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith("/api")) {
      reply.status(404).send(errorEnvelope("NOT_FOUND", "Not found"));
      return;
    }

    // SPA fallback: any non-/api path that isn't a static file resolves to
    // the client's index.html, so client-side routing owns it.
    const indexPath = `${staticDir}/index.html`;
    if (existsSync(indexPath)) {
      reply.status(200).type("text/html").send(readFileSync(indexPath, "utf-8"));
      return;
    }

    reply.status(404).send(errorEnvelope("NOT_FOUND", "Not found"));
  });

  return app;
}

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type Database from "better-sqlite3";
import Fastify, { type FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import { ApiError } from "./errors.js";
import { errorEnvelope } from "./envelope.js";
import { PORT } from "./config.js";
import { openDatabase } from "./db/index.js";
import { onChange } from "./events/changes.js";
import { SseHub } from "./events/sse.js";
import { activityRoutes } from "./routes/activity.js";
import { eventRoutes } from "./routes/events.js";
import { projectRoutes } from "./routes/projects.js";
import { runRoutes } from "./routes/runs.js";
import { schemaRoutes } from "./routes/schema.js";
import { taskRoutes } from "./routes/tasks.js";
import { createApprovalRegistry } from "./runs/approvals.js";
import { createRunControlRegistry } from "./runs/control.js";
import { createRunQueue, type RunQueue } from "./runs/queue.js";
import { RunStreamRegistry } from "./runs/streams.js";
import { createWriterSemaphore } from "./safety/semaphore.js";
import type { Agent } from "./runs/agent.js";

declare module "fastify" {
  interface FastifyInstance {
    /** The SSE connection registry behind `GET /api/events`. */
    sse: SseHub;
    /**
     * The run queue (src/server/runs/queue.ts). Decorated so the control
     * endpoints (T56) and the tests reach the same instance the routes use.
     */
    runQueue: RunQueue;
    /**
     * The run and activity streams (T59; src/server/runs/streams.ts).
     * Decorated so tests can inspect open-connection counts the same way
     * they inspect `app.sse`.
     */
    runStreams: RunStreamRegistry;
  }
}

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

  /**
   * An already-open database. Tests pass a temporary one; the process entry
   * point passes the real `data/paim.db`.
   */
  db?: Database.Database;

  /**
   * Path to open the database from when `db` is not given. Opened lazily on
   * the first request that needs it, so an app created only to serve the
   * client or `/api/health` never touches the filesystem.
   */
  dbPath?: string;

  /**
   * How often an open SSE stream writes its heartbeat comment. Defaults to
   * the 25 s of specs/06; a test shortens it rather than waiting.
   */
  sseHeartbeatMs?: number;

  /**
   * The run queue's seams (src/server/runs/queue.ts). A test passes a
   * scripted agent — and often `autoStart: false`, so a queued run stays
   * queued and nothing touches a workspace.
   */
  runs?: {
    createAgent?: () => Agent;
    autoStart?: boolean;
    /**
     * Where `data/restore/<runId>` is rooted (docs/09 "Restore"). Defaults
     * to `data/restore` at the repo root; a test points it at a temp
     * directory so no suite writes into `data/`.
     */
    restoreRoot?: string;
  };
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

  // Every data change reaches the open streams through the storage layer's
  // change bus (src/server/events/changes.ts), which hangs off the database
  // handle — so the subscription is made the first time the database is
  // resolved, and dropped when the app closes.
  const hub = new SseHub({ heartbeatMs: options.sseHeartbeatMs });
  app.decorate("sse", hub);

  // The run and activity streams (T59) read their own feed
  // (src/server/events/runFeed.ts), attached the same lazy way as the
  // change bus below.
  const runStreams = new RunStreamRegistry({ heartbeatMs: options.sseHeartbeatMs });
  app.decorate("runStreams", runStreams);

  let db = options.db;
  let unsubscribe: (() => void) | null = null;
  const getDb = (): Database.Database => {
    db ??= openDatabase(options.dbPath);
    unsubscribe ??= onChange(db, (event) => {
      hub.broadcast(event);
    });
    runStreams.attach(db);
    return db;
  };

  // One queue, one writer semaphore, one approval registry and one control
  // registry per app: the semaphore's counts (docs/10 §6), the parked
  // approvals (docs/10 §4) and the runs in flight (T56) are process state,
  // not request state. The queue itself is built on the first request that
  // needs it, for the same reason the database is opened lazily.
  const approvals = createApprovalRegistry();
  const controls = createRunControlRegistry();
  const semaphore = createWriterSemaphore();
  let queue: RunQueue | null = null;
  const getQueue = (): RunQueue => {
    queue ??= createRunQueue({
      db: getDb(),
      semaphore,
      approvals,
      controls,
      ...(options.runs?.createAgent ? { createAgent: options.runs.createAgent } : {}),
      ...(options.runs?.autoStart === undefined ? {} : { autoStart: options.runs.autoStart }),
      ...(options.runs?.restoreRoot === undefined ? {} : { restoreRoot: options.runs.restoreRoot }),
    });
    return queue;
  };
  app.decorate("runQueue", { getter: getQueue });

  app.addHook("onClose", async () => {
    unsubscribe?.();
    unsubscribe = null;
    hub.closeAll();
    runStreams.detach();
    runStreams.closeAll();
  });

  app.get("/api/health", async () => ({
    data: { ok: true, version: pkg.version },
  }));

  app.register(eventRoutes, { getDb, hub });
  app.register(projectRoutes, { getDb });
  app.register(schemaRoutes, { getDb });
  app.register(taskRoutes, { getDb });
  app.register(runRoutes, { getDb, getQueue, approvals, controls, streams: runStreams });
  app.register(activityRoutes, { getDb, streams: runStreams });

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
    // Fastify's own client-side errors (malformed JSON, a missing or wrong
    // Content-Type) already carry a 4xx status and a stable code; they are
    // the caller's fault, not an internal failure.
    const fastifyError = err as { statusCode?: number; code?: string; message?: string };
    const status = fastifyError.statusCode;
    if (typeof status === "number" && status >= 400 && status < 500) {
      reply
        .status(status)
        .send(
          errorEnvelope(fastifyError.code ?? "BAD_REQUEST", fastifyError.message ?? "Bad request"),
        );
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

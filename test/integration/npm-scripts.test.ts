import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// These tests exercise the actual `npm start` / `npm run dev` scripts end to
// end (specs/00-foundation.md, specs/TASKS.md T04) rather than the code they
// wire together — everything else in the suite already covers app.ts,
// migrate.ts, etc. in isolation. They run sequentially in this one file so
// they never fight over the fixed ports (4400/4401) that config.ts and
// vite.config.ts hard-code.

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));

const SERVER_URL = "http://127.0.0.1:4400";
const CLIENT_URL = "http://127.0.0.1:4401";

async function waitFor(url: string, timeoutMs: number): Promise<Response> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      return res;
    } catch (err) {
      lastError = err;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw new Error(`${url} never answered within ${timeoutMs}ms: ${String(lastError)}`);
}

/** Kills the whole process group so npm's child processes (tsx, vite,
 * concurrently) go down with it, then waits for the exit event. */
async function killTree(child: ChildProcess): Promise<void> {
  if (child.pid === undefined || child.exitCode !== null) return;
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    // already gone
  }
  const timedOut = await Promise.race([
    exited.then(() => false),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(true), 5_000)),
  ]);
  if (timedOut) {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      // already gone
    }
    await exited;
  }
}

describe("npm start", () => {
  it(
    "builds the client and serves both API and client on 127.0.0.1:4400",
    async () => {
      const child = spawn("npm", ["start"], {
        cwd: REPO_ROOT,
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let output = "";
      child.stdout?.on("data", (chunk: Buffer) => (output += chunk.toString()));
      child.stderr?.on("data", (chunk: Buffer) => (output += chunk.toString()));

      try {
        // `vite build` runs first, so give this a generous window.
        const health = await waitFor(`${SERVER_URL}/api/health`, 60_000);
        expect(health.status).toBe(200);
        const body = (await health.json()) as { data: { ok: boolean; version: string } };
        expect(body.data.ok).toBe(true);
        expect(typeof body.data.version).toBe("string");

        const home = await fetch(`${SERVER_URL}/`);
        expect(home.status).toBe(200);
        expect(home.headers.get("content-type")).toContain("text/html");
        const html = await home.text();
        expect(html).toContain("<div id=\"root\">");

        const missingApi = await fetch(`${SERVER_URL}/api/nope`);
        expect(missingApi.status).toBe(404);
      } catch (err) {
        throw new Error(`${String(err)}\n--- npm start output ---\n${output}`);
      } finally {
        await killTree(child);
      }
    },
    90_000,
  );
});

describe("npm run dev", () => {
  it(
    "hot-reload server proxies /api to 4400 from the Vite client on 4401",
    async () => {
      const child = spawn("npm", ["run", "dev"], {
        cwd: REPO_ROOT,
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let output = "";
      child.stdout?.on("data", (chunk: Buffer) => (output += chunk.toString()));
      child.stderr?.on("data", (chunk: Buffer) => (output += chunk.toString()));

      try {
        // The API server (tsx watch) should come up almost immediately.
        const directHealth = await waitFor(`${SERVER_URL}/api/health`, 30_000);
        expect(directHealth.status).toBe(200);

        // The Vite dev server on 4401 proxies /api/* straight through to it.
        const proxied = await waitFor(`${CLIENT_URL}/api/health`, 30_000);
        expect(proxied.status).toBe(200);
        const body = (await proxied.json()) as { data: { ok: boolean } };
        expect(body.data.ok).toBe(true);

        // And the client itself is being served by Vite, not the static dist build.
        const client = await waitFor(CLIENT_URL, 30_000);
        expect(client.status).toBe(200);
        const clientHtml = await client.text();
        expect(clientHtml).toContain("/src/main.tsx");
      } catch (err) {
        throw new Error(`${String(err)}\n--- npm run dev output ---\n${output}`);
      } finally {
        await killTree(child);
      }
    },
    60_000,
  );
});

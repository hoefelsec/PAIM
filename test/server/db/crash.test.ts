import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase } from "../../../src/server/db/index.js";

const CHILD_SCRIPT = fileURLToPath(new URL("./fixtures/crash-child.mjs", import.meta.url));

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "paim-crash-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("kill -9 mid-transaction", () => {
  it("leaves the database openable and consistent, with the crashed write rolled back", async () => {
    const dbPath = join(dir, "paim.db");

    const child = spawn(process.execPath, [CHILD_SCRIPT, dbPath], { stdio: ["ignore", "pipe", "inherit"] });

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("child never signalled READY")), 10_000);
      child.stdout.on("data", (chunk: Buffer) => {
        if (chunk.toString().includes("READY")) {
          clearTimeout(timeout);
          resolve();
        }
      });
      child.on("error", reject);
    });

    child.kill("SIGKILL");

    await new Promise<void>((resolve) => {
      child.on("exit", () => resolve());
    });

    // Reopening — with our normal bootstrap path — must succeed and apply
    // migrations without throwing, i.e. the WAL-mode file survived the hard
    // kill in a consistent state.
    const db = openDatabase(dbPath);

    const integrity = db.pragma("integrity_check", { simple: true });
    expect(integrity).toBe("ok");

    // The uncommitted insert from the killed transaction must not be visible.
    const row = db.prepare("SELECT COUNT(*) as n FROM crash_test").get() as { n: number } | undefined;
    expect(row?.n ?? 0).toBe(0);

    // And the db is still fully usable afterwards.
    db.exec("CREATE TABLE IF NOT EXISTS crash_test (id INTEGER PRIMARY KEY, value TEXT NOT NULL)");
    db.prepare("INSERT INTO crash_test (value) VALUES (?)").run("post-crash");
    const after = db.prepare("SELECT value FROM crash_test").get();
    expect(after).toEqual({ value: "post-crash" });

    db.close();
  });
});

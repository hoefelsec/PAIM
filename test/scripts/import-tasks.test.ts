import { readFileSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type Database from "better-sqlite3";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/server/app.js";
import { openDatabase } from "../../src/server/db/index.js";
import { clearValidatorCache } from "../../src/server/fields/validator.js";
import { clearVersionCache } from "../../src/server/projects/version.js";
import {
  importTasks,
  parseTasksMd,
  TASKS_MD_PATH,
  type HttpClient,
} from "../../scripts/import-tasks.js";

const HEADERS = { host: "localhost:4400" };

let dir: string;
let db: Database.Database;
let app: FastifyInstance;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "paim-import-tasks-"));
  db = openDatabase(join(dir, "paim.db"));
  app = createApp({ db });
  clearVersionCache();
  clearValidatorCache();
});

afterEach(async () => {
  await app.close();
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

function appClient(): HttpClient {
  return {
    async post(path, body) {
      const res = await app.inject({
        method: "POST",
        url: path,
        headers: HEADERS,
        payload: body as Record<string, unknown>,
      });
      return { status: res.statusCode, data: res.json() };
    },
    async get(path) {
      const res = await app.inject({ method: "GET", url: path, headers: HEADERS });
      return { status: res.statusCode, data: res.json() };
    },
  };
}

const REAL_TASKS_MD = readFileSync(TASKS_MD_PATH, "utf-8");

describe("parseTasksMd", () => {
  it("parses every ### T## section of the real TASKS.md", () => {
    const tasks = parseTasksMd(REAL_TASKS_MD);
    expect(tasks.length).toBe(82);
    expect(tasks.map((t) => t.code)).toEqual(tasks.map((_, i) => `T${String(i + 1).padStart(2, "0")}`));
  });

  it("parses T01 with no dependencies", () => {
    const [t01] = parseTasksMd(REAL_TASKS_MD);
    expect(t01).toBeDefined();
    expect(t01!.uuid).toBe("249c1e55-91fc-4e9e-a21e-fadd2578225a");
    expect(t01!.heading).toBe("Server skeleton: app factory, envelopes, errors, health");
    expect(t01!.priority).toBe("urgent");
    expect(t01!.size).toBe("S");
    expect(t01!.dependsOn).toEqual([]);
    expect(t01!.body).toContain("**Done:**");
    expect(t01!.body).toContain("createApp(): FastifyInstance");
  });

  it("resolves a multi-dependency dependsOn list to uuids, in order", () => {
    const tasks = parseTasksMd(REAL_TASKS_MD);
    const t25 = tasks.find((t) => t.code === "T25");
    expect(t25).toBeDefined();
    expect(t25!.uuid).toBe("86c32317-55db-466c-bc7b-229a7325539d");
    expect(t25!.dependsOn).toEqual([
      "e5a70aaa-e7ce-4a84-bedf-ed26e49c6c6e", // T16
      "5b7600ea-9db9-4fcc-aef9-b9c8d7fc3568", // T22
      "a4ddcd9a-b570-404d-b6ee-2a1c185764b8", // T23
      "285b3e63-1e2e-4ca9-bc8b-b3a6a6747023", // T24
    ]);
  });

  it("parses a minimal synthetic section", () => {
    const md = [
      "### T01 — First task",
      "- uuid: `11111111-1111-1111-1111-111111111111`",
      "- priority: urgent · size: S · dependsOn: —",
      "- refs: [specs/00-foundation.md](00-foundation.md)",
      "",
      "Some description.",
      "**Done:** it works.",
      "",
      "---",
      "",
      "### T02 — Second task",
      "- uuid: `22222222-2222-2222-2222-222222222222`",
      "- priority: high · size: M · dependsOn: [`11111111-1111-1111-1111-111111111111` T01]",
      "- refs: this file",
      "",
      "Depends on T01.",
      "**Done:** also works.",
    ].join("\n");

    const tasks = parseTasksMd(md);
    expect(tasks).toHaveLength(2);
    expect(tasks[0]!.dependsOn).toEqual([]);
    expect(tasks[1]!.dependsOn).toEqual(["11111111-1111-1111-1111-111111111111"]);
    expect(tasks[0]!.body).toBe("Some description.\n**Done:** it works.");
  });
});

describe("importTasks", () => {
  it("creates the paim project with a type field and imports every registry task", async () => {
    const result = await importTasks(appClient(), REAL_TASKS_MD, "/repo");

    expect(result.projectSlug).toBe("paim");
    expect(result.tasks).toHaveLength(82);

    const projectRes = await app.inject({
      method: "GET",
      url: "/api/projects/paim",
      headers: HEADERS,
    });
    expect(projectRes.statusCode).toBe(200);
    const project = projectRes.json().data;
    expect(project.type).toBe("node");
    expect(project.workspacePath).toBe("/repo");
    expect(project.fieldSchema.some((f: { key: string }) => f.key === "type")).toBe(true);

    const listRes = await app.inject({
      method: "GET",
      url: "/api/projects/paim/tasks?limit=200",
      headers: HEADERS,
    });
    expect(listRes.statusCode).toBe(200);
    expect(listRes.json().meta.total).toBe(82);
  });

  it("resolves each task's dependsOn to the real ids PAIM assigned", async () => {
    const result = await importTasks(appClient(), REAL_TASKS_MD, "/repo");

    const byCode = new Map(result.tasks.map((t) => [t.code, t]));
    const t16 = byCode.get("T16")!;
    const t22 = byCode.get("T22")!;
    const t23 = byCode.get("T23")!;
    const t24 = byCode.get("T24")!;
    const t25 = byCode.get("T25")!;

    const res = await app.inject({
      method: "GET",
      url: `/api/projects/paim/tasks/${t25.key}`,
      headers: HEADERS,
    });
    expect(res.statusCode).toBe(200);
    const task = res.json().data;
    expect(new Set(task.dependsOn)).toEqual(new Set([t16.id, t22.id, t23.id, t24.id]));
    expect(task.priority).toBe("urgent");
    expect(task.size).toBe("S");
    expect(task.fields.registry_uuid).toBe("86c32317-55db-466c-bc7b-229a7325539d");
    expect(task.title).toContain("T25");
    expect(task.description).toContain("**Done:**");
  });

  it("is idempotent about the project: a second run reuses it instead of failing", async () => {
    const client = appClient();
    const first = await importTasks(client, REAL_TASKS_MD, "/repo");
    // Running again would create duplicate tasks (task creation is not
    // idempotent), but it must not fail trying to create the project again.
    const listBefore = await app.inject({
      method: "GET",
      url: "/api/projects?status=all",
      headers: HEADERS,
    });
    expect(listBefore.json().data).toHaveLength(1);
    expect(first.projectSlug).toBe("paim");
  });
});

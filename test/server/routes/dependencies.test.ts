/**
 * T30 — dependsOn validation, at the HTTP surface
 * (specs/05-dependencies-and-reevaluation.md, docs/05-dependencies.md).
 *
 * Same project only (422 DEPENDENCY_CROSS_PROJECT), no self-reference, no
 * cycles (422 DEPENDENCY_CYCLE) — the write that closes the cycle is the one
 * rejected, not an earlier one.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type Database from "better-sqlite3";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../../src/server/app.js";
import { openDatabase } from "../../../src/server/db/index.js";
import { clearValidatorCache } from "../../../src/server/fields/validator.js";
import { clearVersionCache } from "../../../src/server/projects/version.js";
import type { ProjectView, Task } from "../../../src/shared/types.js";

const HEADERS = { host: "localhost:4400" };

let dir: string;
let db: Database.Database;
let app: FastifyInstance;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "paim-deps-routes-"));
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

async function createProject(body: Record<string, unknown> = {}): Promise<ProjectView> {
  const res = await app.inject({
    method: "POST",
    url: "/api/projects",
    headers: HEADERS,
    payload: { name: "PAIM", ...body },
  });
  expect(res.statusCode).toBe(201);
  return res.json().data as ProjectView;
}

function post(slug: string, body: Record<string, unknown>) {
  return app.inject({
    method: "POST",
    url: `/api/projects/${slug}/tasks`,
    headers: HEADERS,
    payload: body,
  });
}

async function createTask(slug: string, body: Record<string, unknown>): Promise<Task> {
  const res = await post(slug, body);
  expect(res.statusCode).toBe(201);
  return res.json().data as Task;
}

function patch(slug: string, ref: string, body: Record<string, unknown>) {
  return app.inject({
    method: "POST",
    url: `/api/projects/${slug}/tasks/${ref}`,
    headers: HEADERS,
    payload: body,
  });
}

describe("dependsOn validation (T30)", () => {
  it("accepts a dependency on another task in the same project", async () => {
    const project = await createProject();
    const a = await createTask(project.slug, { title: "A" });

    const b = await post(project.slug, { title: "B", dependsOn: [a.id] });

    expect(b.statusCode).toBe(201);
    expect(b.json().data.dependsOn).toEqual([a.id]);
  });

  it("refuses a dependency on a task from another project (422 DEPENDENCY_CROSS_PROJECT)", async () => {
    const project = await createProject();
    const other = await createProject({ name: "Other" });
    const foreign = await createTask(other.slug, { title: "Foreign" });

    const res = await post(project.slug, { title: "B", dependsOn: [foreign.id] });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("DEPENDENCY_CROSS_PROJECT");
  });

  it("refuses a dependency on a task that already exists cross-project, on update too", async () => {
    const project = await createProject();
    const other = await createProject({ name: "Other" });
    const task = await createTask(project.slug, { title: "A" });
    const foreign = await createTask(other.slug, { title: "Foreign" });

    const res = await patch(project.slug, task.key, { dependsOn: [foreign.id] });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("DEPENDENCY_CROSS_PROJECT");
  });

  it("refuses a self-reference (422 DEPENDENCY_CYCLE)", async () => {
    const project = await createProject();
    const task = await createTask(project.slug, { title: "A" });

    const res = await patch(project.slug, task.key, { dependsOn: [task.id] });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("DEPENDENCY_CYCLE");
  });

  it("rejects the write that closes a cycle, at the final write (422 DEPENDENCY_CYCLE)", async () => {
    const project = await createProject();
    const a = await createTask(project.slug, { title: "A" });
    const b = await createTask(project.slug, { title: "B", dependsOn: [a.id] });
    const c = await createTask(project.slug, { title: "C", dependsOn: [b.id] });

    // A -> B -> C is fine so far. Closing A -> C would make it a cycle.
    const res = await patch(project.slug, a.key, { dependsOn: [c.id] });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("DEPENDENCY_CYCLE");

    // The task at the far end of the chain (A) is untouched by the rejected
    // write.
    const reread = await app.inject({
      method: "GET",
      url: `/api/projects/${project.slug}/tasks/${a.key}`,
      headers: HEADERS,
    });
    expect(reread.json().data.dependsOn).toEqual([]);
  });

  it("allows removing a dependency (does not treat the emptied list as a cycle)", async () => {
    const project = await createProject();
    const a = await createTask(project.slug, { title: "A" });
    const b = await createTask(project.slug, { title: "B", dependsOn: [a.id] });

    const res = await patch(project.slug, b.key, { dependsOn: [] });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.dependsOn).toEqual([]);
  });

  it("still allows an unrelated update once a dependency is hard-deleted out from under it", async () => {
    const project = await createProject();
    const a = await createTask(project.slug, { title: "A" });
    const b = await createTask(project.slug, { title: "B", dependsOn: [a.id] });

    const del = await app.inject({
      method: "DELETE",
      url: `/api/projects/${project.slug}/tasks/${a.key}?hard=true`,
      headers: HEADERS,
    });
    expect(del.statusCode).toBe(200);

    // B still carries a dependsOn id that no longer resolves to any task.
    // A patch that doesn't touch dependsOn must not be bricked by it.
    const res = await patch(project.slug, b.key, { title: "B renamed" });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.title).toBe("B renamed");
    expect(res.json().data.dependsOn).toEqual([a.id]);
  });
});

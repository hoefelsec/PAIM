import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type Database from "better-sqlite3";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../../src/server/app.js";
import { openDatabase } from "../../../src/server/db/index.js";
import { getProjectBySlug } from "../../../src/server/db/projects.js";
import { columnFields, facetFields } from "../../../src/server/fields/schema.js";
import { getValidator } from "../../../src/server/fields/validator.js";
import { readFields, resolveFieldWrite } from "../../../src/server/fields/values.js";
import { DEFAULT_STATUSES } from "../../../src/shared/statuses.js";
import type { FieldDef, FieldDefView } from "../../../src/shared/fields.js";

const HEADERS = { host: "localhost:4400" };

let dir: string;
let db: Database.Database;
let app: FastifyInstance;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "paim-schema-"));
  db = openDatabase(join(dir, "paim.db"));
  app = createApp({ db });
  await app.inject({
    method: "POST",
    url: "/api/projects",
    headers: HEADERS,
    payload: { name: "PAIM" },
  });
});

afterEach(async () => {
  await app.close();
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

function getSchema(slug = "paim") {
  return app.inject({ method: "GET", url: `/api/projects/${slug}/schema`, headers: HEADERS });
}

function postSchema(body: unknown, slug = "paim") {
  return app.inject({
    method: "POST",
    url: `/api/projects/${slug}/schema`,
    headers: HEADERS,
    payload: body as Record<string, unknown>,
  });
}

async function fields(): Promise<FieldDefView[]> {
  const res = await getSchema();
  expect(res.statusCode).toBe(200);
  return res.json().data.fieldSchema as FieldDefView[];
}

/** The definitions as stored, straight from the database. */
function stored(slug = "paim"): FieldDef[] {
  return getProjectBySlug(db, slug)!.fieldSchema;
}

describe("GET /api/projects/:project/schema", () => {
  it("answers with the field schema and the pipeline", async () => {
    const res = await getSchema();

    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual({ fieldSchema: [], statuses: DEFAULT_STATUSES });
  });

  it("completes every stored definition with the documented defaults", async () => {
    await postSchema({ fields: [{ key: "notes", type: "long_text" }] });

    expect(await fields()).toEqual([
      {
        key: "notes",
        label: "Notes",
        type: "long_text",
        options: null,
        required: false,
        default: null,
        order: 1,
        showInTable: false,
        showAsFacet: false,
        description: "",
        hidden: false,
      },
    ]);
  });

  it("is 404 for a project that does not exist", async () => {
    const res = await getSchema("ghost");

    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("PROJECT_NOT_FOUND");
  });
});

describe("POST /api/projects/:project/schema", () => {
  it("adds a field and persists it (rule 1)", async () => {
    const res = await postSchema({
      fields: [
        {
          key: "layer",
          label: "Layer",
          type: "select",
          options: ["frontend", "backend"],
          showInTable: true,
          showAsFacet: true,
        },
      ],
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().warnings).toEqual([]);
    expect(res.json().data.fieldSchema).toHaveLength(1);
    expect(stored().map((f) => f.key)).toEqual(["layer"]);
    expect((await fields())[0]).toMatchObject({ key: "layer", options: ["frontend", "backend"] });
  });

  it("refuses a change of type with 422 FIELD_TYPE_IMMUTABLE (rule 3)", async () => {
    await postSchema({ fields: [{ key: "layer", type: "select" }] });

    const res = await postSchema({ fields: [{ key: "layer", type: "text" }] });

    expect(res.statusCode).toBe(422);
    expect(res.json().error).toMatchObject({
      code: "FIELD_TYPE_IMMUTABLE",
      details: { key: "layer", type: "select", requested: "text" },
    });
    expect((await fields())[0]).toMatchObject({ type: "select" });
  });

  it("hides a removed field instead of dropping it (rule 2)", async () => {
    await postSchema({ fields: [{ key: "layer", type: "select", showInTable: true }] });

    const res = await postSchema({ remove: ["layer"] });

    expect(res.statusCode).toBe(200);
    expect(res.json().warnings[0]).toContain("hidden");
    expect(await fields()).toHaveLength(1);
    expect((await fields())[0]).toMatchObject({ key: "layer", hidden: true });
  });

  it("refuses to remove a key the schema does not define", async () => {
    const res = await postSchema({ remove: ["estimate"] });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatchObject({
      code: "FIELD_UNKNOWN",
      details: { key: "estimate" },
    });
  });

  it("warns when the new field is required (rule 5 is never a rejection)", async () => {
    const res = await postSchema({ fields: [{ key: "layer", type: "text", required: true }] });

    expect(res.statusCode).toBe(200);
    expect(res.json().warnings).toHaveLength(1);
  });

  it("rejects a malformed definition without writing anything", async () => {
    const res = await postSchema({ fields: [{ key: "Layer", type: "text" }] });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_FAILED");
    expect(await fields()).toEqual([]);
  });

  it("is 404 for a project that does not exist", async () => {
    const res = await postSchema({ fields: [{ key: "layer", type: "text" }] }, "ghost");

    expect(res.statusCode).toBe(404);
  });

  it("bumps updatedAt on the project", async () => {
    const before = getProjectBySlug(db, "paim")!.updatedAt;
    await new Promise((resolve) => setTimeout(resolve, 2));
    await postSchema({ fields: [{ key: "layer", type: "text" }] });

    expect(getProjectBySlug(db, "paim")!.updatedAt >= before).toBe(true);
  });

  it("invalidates the project's cached validator (docs/03 validation cache)", async () => {
    const projectId = getProjectBySlug(db, "paim")!.id;
    const before = getValidator(projectId, stored());

    await postSchema({ fields: [{ key: "layer", type: "text" }] });

    const after = getValidator(projectId, stored());
    expect(after).not.toBe(before);
  });
});

describe("the hidden-field round trip", () => {
  it("keeps the value through a removal and surfaces the field on re-add", async () => {
    await postSchema({
      fields: [
        {
          key: "layer",
          type: "select",
          options: ["frontend", "backend"],
          showInTable: true,
          showAsFacet: true,
        },
      ],
    });

    // A task write stores a value for the field.
    const values = { layer: "backend" };
    expect(resolveFieldWrite(stored(), values).schemaChanged).toBe(false);

    // Remove: the definition is hidden, the surfaces drop it, the value stays.
    await postSchema({ remove: ["layer"] });
    expect(stored()[0]).toMatchObject({ key: "layer", hidden: true });
    expect(columnFields(stored())).toEqual([]);
    expect(facetFields(stored())).toEqual([]);
    expect(readFields(stored(), values)).toEqual({ layer: "backend" });

    // Re-add with the same key and type: the field is a column and a facet
    // again, and the stored value reads back through it.
    const res = await postSchema({ fields: [{ key: "layer", type: "select" }] });

    expect(res.statusCode).toBe(200);
    expect(columnFields(stored()).map((f) => f.key)).toEqual(["layer"]);
    expect(facetFields(stored()).map((f) => f.key)).toEqual(["layer"]);
    expect((await fields())[0]).toMatchObject({
      key: "layer",
      hidden: false,
      options: ["frontend", "backend"],
    });
    expect(readFields(stored(), values)).toEqual({ layer: "backend" });
  });
});

describe("fieldSchema written through the project endpoint", () => {
  async function patch(body: Record<string, unknown>) {
    return app.inject({
      method: "POST",
      url: "/api/projects/paim",
      headers: HEADERS,
      payload: body,
    });
  }

  it("is validated by the same rules", async () => {
    const res = await patch({ fieldSchema: [{ key: "Layer", type: "text" }] });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_FAILED");
  });

  it("reads back through the schema endpoint, completed", async () => {
    await patch({ fieldSchema: [{ key: "layer", label: "Layer", type: "select", order: 1 }] });

    expect((await fields())[0]).toMatchObject({
      key: "layer",
      label: "Layer",
      type: "select",
      options: [],
      hidden: false,
      order: 1,
    });
  });
});

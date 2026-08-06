import type Database from "better-sqlite3";
import type { FastifyInstance, FastifyPluginOptions } from "fastify";
import { updateProject } from "../db/projects.js";
import { applySchemaWrite, schemaView } from "../fields/schema.js";
import { requireProject } from "./projects.js";
import type { Project } from "../../shared/types.js";

export interface SchemaRoutesOptions extends FastifyPluginOptions {
  /** Resolved per request so the database opens lazily. */
  getDb(): Database.Database;
}

/** docs/06: the schema endpoints answer with the field schema and the pipeline. */
function schemaBody(project: Project) {
  return { fieldSchema: schemaView(project.fieldSchema), statuses: project.statuses };
}

export async function schemaRoutes(
  app: FastifyInstance,
  options: SchemaRoutesOptions,
): Promise<void> {
  const { getDb } = options;

  app.get<{ Params: { project: string } }>("/api/projects/:project/schema", async (req) => {
    return { data: schemaBody(requireProject(getDb(), req.params.project)) };
  });

  app.post<{ Params: { project: string } }>("/api/projects/:project/schema", async (req) => {
    const db = getDb();
    const current = requireProject(db, req.params.project);

    const { fieldSchema, warnings } = applySchemaWrite(current.fieldSchema, req.body ?? {});
    const next: Project = {
      ...current,
      fieldSchema,
      updatedAt: new Date().toISOString(),
    };
    updateProject(db, next);

    return { data: schemaBody(next), warnings };
  });
}

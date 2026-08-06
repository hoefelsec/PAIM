import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { FastifyInstance, FastifyPluginOptions } from "fastify";
import { listEnvelope } from "../envelope.js";
import { ApiError } from "../errors.js";
import {
  countProjectTasks,
  deleteProject,
  deleteProjectTasks,
  getProjectBySlug,
  insertProject,
  listProjects,
  slugExists,
  updateProject,
  type ProjectStatusFilter,
} from "../db/projects.js";
import { defaultSettings } from "../projects/defaults.js";
import { isValidSlug, slugify, uniqueSlug } from "../projects/slug.js";
import { applyProjectPatch, asObject, type ProjectSettings } from "../projects/validate.js";
import { readProjectVersion } from "../projects/version.js";
import type { Project, ProjectView } from "../../shared/types.js";

export interface ProjectRoutesOptions extends FastifyPluginOptions {
  /** Resolved per request so the database opens lazily. */
  getDb(): Database.Database;
}

const STATUS_FILTERS = new Set<ProjectStatusFilter>(["active", "archived", "all"]);

function parseStatusFilter(value: unknown): ProjectStatusFilter {
  // docs/02: the interface hides archived projects from the default lists.
  if (value === undefined) return "active";
  if (typeof value === "string" && STATUS_FILTERS.has(value as ProjectStatusFilter)) {
    return value as ProjectStatusFilter;
  }
  throw new ApiError(
    "VALIDATION_FAILED",
    400,
    { field: "status", allowed: ["active", "archived", "all"] },
    "status must be one of active, archived, all",
  );
}

function parseBooleanFlag(value: unknown, field: string): boolean {
  if (value === undefined) return false;
  if (value === "true" || value === true) return true;
  if (value === "false" || value === false) return false;
  throw new ApiError("VALIDATION_FAILED", 400, { field }, `${field} must be true or false`);
}

/** docs/02: `version` is read from the workspace on every read, never stored. */
function withVersion(project: Project): ProjectView {
  return { ...project, version: readProjectVersion(project) };
}

function requireProject(db: Database.Database, slug: string): Project {
  const project = getProjectBySlug(db, slug);
  if (!project) {
    throw new ApiError("PROJECT_NOT_FOUND", 404, { project: slug }, `No project "${slug}"`);
  }
  return project;
}

/**
 * Resolves the slug of a new project: an explicit one must be URL-safe and
 * free, a derived one gets a numeric suffix until it is free.
 */
function resolveSlug(db: Database.Database, body: Record<string, unknown>, name: string): string {
  const supplied = body["slug"];
  const taken = (candidate: string): boolean => slugExists(db, candidate);

  if (supplied === undefined || supplied === null) {
    return uniqueSlug(slugify(name), taken);
  }
  if (typeof supplied !== "string" || !isValidSlug(supplied)) {
    throw new ApiError(
      "VALIDATION_FAILED",
      400,
      { field: "slug", value: supplied },
      "slug must be lowercase alphanumerics separated by single hyphens",
    );
  }
  if (taken(supplied)) {
    throw new ApiError(
      "SLUG_TAKEN",
      409,
      { slug: supplied },
      `The slug "${supplied}" is already in use`,
    );
  }
  return supplied;
}

/**
 * Archiving is a status update (docs/02): `archivedAt` follows `status` and
 * is never written directly.
 */
function archivedAtFor(
  previous: Project | null,
  next: ProjectSettings,
  now: string,
): string | null {
  if (next.status !== "archived") return null;
  return previous?.status === "archived" ? previous.archivedAt : now;
}

export async function projectRoutes(
  app: FastifyInstance,
  options: ProjectRoutesOptions,
): Promise<void> {
  const { getDb } = options;

  app.get("/api/projects", async (req) => {
    const query = (req.query ?? {}) as Record<string, unknown>;
    const projects = listProjects(getDb(), parseStatusFilter(query["status"])).map(withVersion);
    return listEnvelope(projects, { total: projects.length, cursor: null, hasMore: false });
  });

  app.post("/api/projects", async (req, reply) => {
    const db = getDb();
    const body = asObject(req.body ?? {}, "body");

    if (body["name"] === undefined) {
      throw new ApiError("NAME_REQUIRED", 400, { field: "name" }, "name is required");
    }

    const settings = applyProjectPatch({ ...defaultSettings(), name: "" }, body);
    const now = new Date().toISOString();
    const project: Project = {
      id: randomUUID(),
      slug: resolveSlug(db, body, settings.name),
      ...settings,
      createdAt: now,
      updatedAt: now,
      archivedAt: archivedAtFor(null, settings, now),
    };

    insertProject(db, project);
    reply.status(201);
    return { data: withVersion(project) };
  });

  app.get<{ Params: { project: string } }>("/api/projects/:project", async (req) => {
    // An archived project stays readable through the API (docs/02).
    return { data: withVersion(requireProject(getDb(), req.params.project)) };
  });

  app.post<{ Params: { project: string } }>("/api/projects/:project", async (req) => {
    const db = getDb();
    const current = requireProject(db, req.params.project);
    const body = asObject(req.body ?? {}, "body");

    // The slug is permanent (docs/02). Re-sending the current one is a no-op;
    // any other value is refused.
    if (body["slug"] !== undefined && body["slug"] !== current.slug) {
      throw new ApiError(
        "SLUG_IMMUTABLE",
        422,
        { slug: current.slug, requested: body["slug"] },
        "The slug of a project is permanent and cannot be changed",
      );
    }

    const settings = applyProjectPatch(current, body);
    const now = new Date().toISOString();
    const next: Project = {
      ...settings,
      id: current.id,
      slug: current.slug,
      createdAt: current.createdAt,
      updatedAt: now,
      archivedAt: archivedAtFor(current, settings, now),
    };

    updateProject(db, next);
    return { data: withVersion(next) };
  });

  app.delete<{ Params: { project: string } }>("/api/projects/:project", async (req) => {
    const db = getDb();
    const project = requireProject(db, req.params.project);
    const query = (req.query ?? {}) as Record<string, unknown>;
    const force = parseBooleanFlag(query["force"], "force");

    const taskCount = countProjectTasks(db, project.id);
    if (taskCount > 0 && !force) {
      throw new ApiError(
        "PROJECT_HAS_TASKS",
        409,
        { tasks: taskCount },
        `The project "${project.slug}" holds ${taskCount} task(s). ` +
          "Send ?force=true to delete it with its tasks.",
      );
    }

    const removeAll = db.transaction(() => {
      deleteProjectTasks(db, project.id);
      deleteProject(db, project.id);
    });
    removeAll();

    return { data: { id: project.id, slug: project.slug, deleted: true, tasks: taskCount } };
  });
}

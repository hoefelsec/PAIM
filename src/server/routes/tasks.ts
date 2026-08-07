/**
 * Task create, read, update and delete (docs/06-rest-api.md "Tasks").
 *
 *   GET    /api/projects/:project/tasks       list: filters, sort, cursor
 *   POST   /api/projects/:project/tasks       create — `title` is the only
 *                                             required field
 *   GET    /api/projects/:project/tasks/:key  read one, by key or by UUID
 *   POST   /api/projects/:project/tasks/:key  partial update
 *   PATCH  /api/projects/:project/tasks/:key  the same handler
 *   DELETE /api/projects/:project/tasks/:key  ?hard=true skips the trash
 *
 * The trash listing and the restore endpoint, the bulk patch, the status
 * gates, the epic invariants and the change events all belong to later work.
 */

import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { FastifyInstance, FastifyPluginOptions, FastifyRequest } from "fastify";
import {
  countChildren,
  getTaskByRef,
  hardDeleteTask,
  insertTask,
  listTasks,
  nextTimestamp,
  updateTask,
} from "../db/tasks.js";
import { listEnvelope } from "../envelope.js";
import { ApiError } from "../errors.js";
import { readFields } from "../fields/values.js";
import { applyFieldsWrite } from "../tasks/fields.js";
import { nextTaskKey } from "../tasks/keys.js";
import { encodeCursor, parseTaskListQuery } from "../tasks/query.js";
import {
  applyTaskPatch,
  defaultTaskCore,
  initialStatus,
  kindForSize,
  taskCore,
} from "../tasks/validate.js";
import { asObject, parseBooleanFlag } from "../validate.js";
import { requireProject } from "./projects.js";
import type { Project, Task } from "../../shared/types.js";

export interface TaskRoutesOptions extends FastifyPluginOptions {
  /** Resolved per request so the database opens lazily. */
  getDb(): Database.Database;
}

interface TaskParams {
  project: string;
  key: string;
}

/**
 * A task as the API returns it: the stored record with its custom values
 * completed from the schema (docs/03 rule 1 — a field with no stored value
 * reads as its default).
 */
function taskView(project: Project, task: Task): Task {
  return { ...task, fields: readFields(project.fieldSchema, task.fields) };
}

/** Reads one task of a project by key or UUID, or fails with `404 TASK_NOT_FOUND`. */
function requireTask(db: Database.Database, project: Project, ref: string): Task {
  const task = getTaskByRef(db, project.id, ref);
  if (!task) {
    throw new ApiError(
      "TASK_NOT_FOUND",
      404,
      { task: ref, project: project.slug },
      `No task "${ref}" in project "${project.slug}"`,
    );
  }
  return task;
}

/**
 * docs/06 "Update semantics": `If-Match: <updatedAt>` makes the write a
 * compare-and-swap; without the header the last write wins. The value is
 * compared after stripping the optional entity-tag quoting, so a client that
 * follows the HTTP spelling of the header works too.
 */
function checkIfMatch(req: FastifyRequest, task: Task): void {
  const header = req.headers["if-match"];
  if (header === undefined) return;

  const raw = Array.isArray(header) ? header[0] : header;
  const expected = (raw ?? "").trim().replace(/^W\//, "").replace(/^"(.*)"$/, "$1");
  if (expected === "*" || expected === task.updatedAt) return;

  throw new ApiError(
    "IF_MATCH_FAILED",
    409,
    { expected, current: task.updatedAt },
    "The task changed since the version this write was based on",
  );
}

/**
 * Resolves a written `parentId` to a task id. The reference may be a key or a
 * UUID, like every other task reference in the API. Which tasks may be a
 * parent (an epic, one level only) is the epic work's question; a reference
 * to nothing at all is refused here so the write never reaches the foreign
 * key as an opaque failure.
 */
function resolveParent(db: Database.Database, project: Project, ref: string | null): string | null {
  if (ref === null) return null;
  const parent = getTaskByRef(db, project.id, ref);
  if (!parent) {
    throw new ApiError(
      "PARENT_NOT_FOUND",
      422,
      { parentId: ref },
      `No task "${ref}" in project "${project.slug}" to use as the parent`,
    );
  }
  return parent.id;
}

export async function taskRoutes(app: FastifyInstance, options: TaskRoutesOptions): Promise<void> {
  const { getDb } = options;

  app.get<{ Params: { project: string } }>("/api/projects/:project/tasks", async (req) => {
    const db = getDb();
    const project = requireProject(db, req.params.project);
    const spec = parseTaskListQuery((req.query ?? {}) as Record<string, unknown>, {
      fieldSchema: project.fieldSchema,
      // `parent=FEAT-3` names the epic the way every other reference does.
      // `resolveParent` returns null only for a null reference.
      resolveParent: (ref) => resolveParent(db, project, ref)!,
    });

    const page = listTasks(db, project.id, spec);
    return listEnvelope(
      page.tasks.map((task) => taskView(project, task)),
      {
        total: page.total,
        cursor: page.cursorValues === null ? null : encodeCursor(spec.signature, page.cursorValues),
        hasMore: page.hasMore,
      },
    );
  });

  app.post<{ Params: { project: string } }>(
    "/api/projects/:project/tasks",
    async (req, reply) => {
      const db = getDb();
      const project = requireProject(db, req.params.project);
      const body = asObject(req.body ?? {}, "body");
      const query = (req.query ?? {}) as Record<string, unknown>;
      const allowUnknownFields = parseBooleanFlag(query["allowUnknownFields"], "allowUnknownFields");

      // docs/02: "`title` is the only required field."
      if (body["title"] === undefined) {
        throw new ApiError("TITLE_REQUIRED", 400, { field: "title" }, "title is required");
      }

      const core = applyTaskPatch(defaultTaskCore(initialStatus(project.statuses)), body, {
        statuses: project.statuses,
      });
      const write = applyFieldsWrite(db, project, body["fields"], {}, allowUnknownFields);
      const parentId = resolveParent(db, project, core.parentId);

      const now = new Date().toISOString();
      const create = db.transaction((): Task => {
        const task: Task = {
          ...core,
          parentId,
          id: randomUUID(),
          // The counter moves inside this transaction, so a failed insert
          // gives the number back (docs/02 "Task keys").
          key: nextTaskKey(db, project.id, write.fields["type"]),
          projectId: project.id,
          kind: kindForSize(core.size),
          fields: write.fields,
          deletedAt: null,
          createdAt: now,
          updatedAt: now,
        };
        return insertTask(db, task);
      });

      reply.status(201);
      return { data: taskView(write.project, create()), warnings: write.warnings };
    },
  );

  app.get<{ Params: TaskParams }>("/api/projects/:project/tasks/:key", async (req) => {
    const db = getDb();
    const project = requireProject(db, req.params.project);
    return { data: taskView(project, requireTask(db, project, req.params.key)) };
  });

  const update = async (req: FastifyRequest<{ Params: TaskParams }>) => {
    const db = getDb();
    const project = requireProject(db, req.params.project);
    const current = requireTask(db, project, req.params.key);
    checkIfMatch(req, current);

    const body = asObject(req.body ?? {}, "body");
    const query = (req.query ?? {}) as Record<string, unknown>;
    const allowUnknownFields = parseBooleanFlag(query["allowUnknownFields"], "allowUnknownFields");

    const core = applyTaskPatch(taskCore(current), body, { statuses: project.statuses });
    const write = applyFieldsWrite(db, project, body["fields"], current.fields, allowUnknownFields);
    // A patch that says nothing about `parentId` keeps the stored link as it
    // is. Re-resolving it here would run the stored id back through a normal
    // read, which hides trashed tasks — so every write to the children of a
    // trashed epic would fail with PARENT_NOT_FOUND until the epic is
    // restored. Only a written reference is resolved, and one that names a
    // trashed task is still refused.
    const parentId =
      "parentId" in body ? resolveParent(db, project, core.parentId) : current.parentId;

    const next: Task = {
      ...current,
      ...core,
      parentId,
      kind: kindForSize(core.size),
      fields: write.fields,
      updatedAt: nextTimestamp(current.updatedAt),
    };
    updateTask(db, next);

    return { data: taskView(write.project, next), warnings: write.warnings };
  };

  app.post<{ Params: TaskParams }>("/api/projects/:project/tasks/:key", update);
  app.patch<{ Params: TaskParams }>("/api/projects/:project/tasks/:key", update);

  app.delete<{ Params: TaskParams }>("/api/projects/:project/tasks/:key", async (req) => {
    const db = getDb();
    const project = requireProject(db, req.params.project);
    const task = requireTask(db, project, req.params.key);
    const query = (req.query ?? {}) as Record<string, unknown>;
    const hard = parseBooleanFlag(query["hard"], "hard");

    if (!hard) {
      // docs/06 "The trash": a plain delete moves the task to the trash,
      // where the retention sweep and the restore endpoint find it.
      updateTask(db, {
        ...task,
        deletedAt: new Date().toISOString(),
        updatedAt: nextTimestamp(task.updatedAt),
      });
      return { data: { id: task.id, key: task.key, deleted: true, hard: false } };
    }

    // The row is about to disappear, and `parentId` points at it with a
    // foreign key: refuse rather than let SQLite fail the statement.
    const children = countChildren(db, task.id);
    if (children > 0) {
      throw new ApiError(
        "TASK_HAS_CHILDREN",
        409,
        { children },
        `The task "${task.key}" has ${children} child task(s)`,
      );
    }

    hardDeleteTask(db, task.id);
    return { data: { id: task.id, key: task.key, deleted: true, hard: true } };
  });
}

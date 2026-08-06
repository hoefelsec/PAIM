import type Database from "better-sqlite3";
import type { Status } from "../../shared/statuses.js";
import type {
  FieldDef,
  ModelChoice,
  Project,
  ProjectColor,
  ProjectStatus,
  ProjectType,
  RoutingConfig,
  SafetyPolicy,
  TestDef,
  TestFramework,
  UsageCaps,
} from "../../shared/types.js";

/** The raw shape of a `projects` row: JSON columns are still text here. */
interface ProjectRow {
  id: string;
  slug: string;
  name: string;
  description: string;
  icon: string | null;
  color: string | null;
  status: string;
  type: string;
  workspacePath: string | null;
  autoCommit: number;
  autoPush: number;
  statuses: string;
  fieldSchema: string;
  testFramework: string | null;
  regressionTests: string;
  safety: string;
  composeModel: string;
  modelRouting: string;
  allowedModels: string;
  usageCaps: string;
  maxConcurrentRuns: number;
  trashRetentionDays: number;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

const COLUMNS = [
  "id",
  "slug",
  "name",
  "description",
  "icon",
  "color",
  "status",
  "type",
  "workspacePath",
  "autoCommit",
  "autoPush",
  "statuses",
  "fieldSchema",
  "testFramework",
  "regressionTests",
  "safety",
  "composeModel",
  "modelRouting",
  "allowedModels",
  "usageCaps",
  "maxConcurrentRuns",
  "trashRetentionDays",
  "createdAt",
  "updatedAt",
  "archivedAt",
] as const;

function rowToProject(row: ProjectRow): Project {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    icon: row.icon,
    color: row.color as ProjectColor | null,
    status: row.status as ProjectStatus,
    type: row.type as ProjectType,
    workspacePath: row.workspacePath,
    autoCommit: row.autoCommit === 1,
    autoPush: row.autoPush === 1,
    statuses: JSON.parse(row.statuses) as Status[],
    fieldSchema: JSON.parse(row.fieldSchema) as FieldDef[],
    testFramework: row.testFramework as TestFramework | null,
    regressionTests: JSON.parse(row.regressionTests) as TestDef[],
    safety: JSON.parse(row.safety) as SafetyPolicy,
    composeModel: JSON.parse(row.composeModel) as ModelChoice,
    modelRouting: JSON.parse(row.modelRouting) as RoutingConfig,
    allowedModels: JSON.parse(row.allowedModels) as string[],
    usageCaps: JSON.parse(row.usageCaps) as UsageCaps,
    maxConcurrentRuns: row.maxConcurrentRuns,
    trashRetentionDays: row.trashRetentionDays,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    archivedAt: row.archivedAt,
  };
}

function projectToRow(project: Project): ProjectRow {
  return {
    id: project.id,
    slug: project.slug,
    name: project.name,
    description: project.description,
    icon: project.icon,
    color: project.color,
    status: project.status,
    type: project.type,
    workspacePath: project.workspacePath,
    autoCommit: project.autoCommit ? 1 : 0,
    autoPush: project.autoPush ? 1 : 0,
    statuses: JSON.stringify(project.statuses),
    fieldSchema: JSON.stringify(project.fieldSchema),
    testFramework: project.testFramework,
    regressionTests: JSON.stringify(project.regressionTests),
    safety: JSON.stringify(project.safety),
    composeModel: JSON.stringify(project.composeModel),
    modelRouting: JSON.stringify(project.modelRouting),
    allowedModels: JSON.stringify(project.allowedModels),
    usageCaps: JSON.stringify(project.usageCaps),
    maxConcurrentRuns: project.maxConcurrentRuns,
    trashRetentionDays: project.trashRetentionDays,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    archivedAt: project.archivedAt,
  };
}

export function insertProject(db: Database.Database, project: Project): Project {
  const row = projectToRow(project);
  const placeholders = COLUMNS.map((c) => `@${c}`).join(", ");
  db.prepare(`INSERT INTO projects (${COLUMNS.join(", ")}) VALUES (${placeholders})`).run(row);
  return project;
}

/** Rewrites every column of an existing row. `id` and `slug` never change. */
export function updateProject(db: Database.Database, project: Project): Project {
  const row = projectToRow(project);
  const assignments = COLUMNS.filter((c) => c !== "id")
    .map((c) => `${c} = @${c}`)
    .join(", ");
  db.prepare(`UPDATE projects SET ${assignments} WHERE id = @id`).run(row);
  return project;
}

export function getProjectBySlug(db: Database.Database, slug: string): Project | null {
  const row = db.prepare("SELECT * FROM projects WHERE slug = ?").get(slug) as
    | ProjectRow
    | undefined;
  return row ? rowToProject(row) : null;
}

export function getProjectById(db: Database.Database, id: string): Project | null {
  const row = db.prepare("SELECT * FROM projects WHERE id = ?").get(id) as ProjectRow | undefined;
  return row ? rowToProject(row) : null;
}

export function slugExists(db: Database.Database, slug: string): boolean {
  return db.prepare("SELECT 1 FROM projects WHERE slug = ?").get(slug) !== undefined;
}

export type ProjectStatusFilter = ProjectStatus | "all";

/**
 * Lists projects, newest first by name for a stable order. `filter` is the
 * `?status=` query parameter; `all` includes archived projects, which the
 * default list hides (docs/02).
 */
export function listProjects(db: Database.Database, filter: ProjectStatusFilter): Project[] {
  const order = "ORDER BY createdAt ASC, slug ASC";
  const rows =
    filter === "all"
      ? (db.prepare(`SELECT * FROM projects ${order}`).all() as ProjectRow[])
      : (db.prepare(`SELECT * FROM projects WHERE status = ? ${order}`).all(filter) as ProjectRow[]);
  return rows.map(rowToProject);
}

export function deleteProject(db: Database.Database, id: string): void {
  db.prepare("DELETE FROM projects WHERE id = ?").run(id);
}

function tableExists(db: Database.Database, name: string): boolean {
  return (
    db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name) !==
    undefined
  );
}

/**
 * How many tasks belong to a project — the number `DELETE` reports in
 * `409 PROJECT_HAS_TASKS`. The tasks table arrives with the tasks work; until
 * then every project counts zero.
 */
export function countProjectTasks(db: Database.Database, projectId: string): number {
  if (!tableExists(db, "tasks")) return 0;
  const row = db.prepare("SELECT COUNT(*) AS n FROM tasks WHERE projectId = ?").get(projectId) as
    | { n: number }
    | undefined;
  return row?.n ?? 0;
}

/** Removes a project's tasks along with the project (`?force=true`). */
export function deleteProjectTasks(db: Database.Database, projectId: string): void {
  if (!tableExists(db, "tasks")) return;
  db.prepare("DELETE FROM tasks WHERE projectId = ?").run(projectId);
}

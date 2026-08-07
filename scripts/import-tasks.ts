/**
 * T25 — Dogfood milestone: creates the `paim` project and imports every
 * task of specs/TASKS.md into it, so the remaining implementation work is
 * tracked in PAIM itself (docs/01-overview.md).
 *
 * Each registry task becomes one PAIM task:
 *   - title       "T01 — <heading text>"
 *   - description the task's markdown body, including its Done line
 *   - priority    the registry's priority (urgent | high | medium | low)
 *   - size        the registry's size (XS | S | M | L | XL)
 *   - fields.registryUuid  the registry uuid, so a task can be traced back
 *     to its line in TASKS.md
 *   - dependsOn   the registry's dependsOn uuids, resolved to the ids PAIM
 *     assigned the corresponding tasks
 *
 * TASKS.md lists tasks in an order where a task's dependencies are always
 * defined earlier in the file, so a single top-to-bottom pass can resolve
 * every dependency by the time it is needed.
 *
 * Run with the server already listening (`npm run dev` or `npm start`):
 *
 *   npx tsx scripts/import-tasks.ts
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { TYPE_OPTIONS } from "../src/shared/fields.js";

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(HERE, "..");
export const TASKS_MD_PATH = resolve(REPO_ROOT, "specs/TASKS.md");
export const BASE_URL = "http://127.0.0.1:4400";
export const PROJECT_NAME = "paim";

/** One task section of specs/TASKS.md, parsed. */
export interface ParsedTask {
  /** "T01" .. "T82". */
  code: string;
  /** The heading text after "T01 — ". */
  heading: string;
  uuid: string;
  priority: string;
  size: string;
  /** Registry uuids of the tasks this one depends on, in file order. */
  dependsOn: string[];
  /** The markdown body below the bullet lines: description plus Done line. */
  body: string;
}

const HEADING_RE = /^### (T\d+) — (.+)$/gm;
const UUID_G_RE = /`([0-9a-fA-F-]{36})`/g;
const STATS_RE = /^- priority: (\S+) · size: (\S+) · dependsOn: (.+)$/m;
const REFS_RE = /^- refs: .+$/m;

/** Parses every `### T##` section of `content` (specs/TASKS.md) in order. */
export function parseTasksMd(content: string): ParsedTask[] {
  const headings: { code: string; heading: string; start: number; end: number }[] = [];
  for (const match of content.matchAll(HEADING_RE)) {
    const code = match[1];
    const heading = match[2];
    if (!code || !heading || match.index === undefined) continue;
    headings.push({ code, heading, start: match.index, end: match.index + match[0].length });
  }

  return headings.map(({ code, heading, end }, i) => {
    const sectionEnd = headings[i + 1]?.start ?? content.length;
    const section = content.slice(end, sectionEnd);

    const uuidMatch = section.match(/^- uuid: `([0-9a-fA-F-]{36})`$/m);
    if (!uuidMatch?.[1]) {
      throw new Error(`${code}: no "- uuid:" line found`);
    }

    const statsMatch = section.match(STATS_RE);
    if (!statsMatch) {
      throw new Error(`${code}: no "- priority: ... · size: ... · dependsOn: ..." line found`);
    }
    const [, priority, size, dependsOnRaw] = statsMatch;
    if (!priority || !size || dependsOnRaw === undefined) {
      throw new Error(`${code}: malformed priority/size/dependsOn line`);
    }

    const dependsOn = dependsOnRaw.trim() === "—"
      ? []
      : [...dependsOnRaw.matchAll(UUID_G_RE)].map((m) => m[1]!);

    const refsMatch = section.match(REFS_RE);
    if (!refsMatch || refsMatch.index === undefined) {
      throw new Error(`${code}: no "- refs:" line found`);
    }
    let body = section.slice(refsMatch.index + refsMatch[0].length).trim();
    // The last task of a priority tier is followed by a "---" rule and the
    // next "## Priority: ..." heading before the next "### T##" section —
    // both belong to the registry's layout, not to this task's text.
    const ruleIndex = body.search(/\n---\s*$|\n---\n/);
    if (ruleIndex !== -1) body = body.slice(0, ruleIndex).trim();

    return {
      code,
      heading,
      uuid: uuidMatch[1],
      priority,
      size,
      dependsOn,
      body,
    };
  });
}

/** A minimal HTTP client — swapped for `app.inject()` in tests. */
export interface HttpClient {
  post(path: string, body: unknown): Promise<{ status: number; data: unknown }>;
  get(path: string): Promise<{ status: number; data: unknown }>;
}

/** A real client, talking to the running server over loopback HTTP. */
export function fetchClient(baseUrl: string): HttpClient {
  async function request(method: "GET" | "POST", path: string, body?: unknown) {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await res.json().catch(() => null);
    return { status: res.status, data };
  }
  return {
    post: (path, body) => request("POST", path, body),
    get: (path) => request("GET", path),
  };
}

export class ImportError extends Error {
  constructor(message: string, public readonly details: unknown) {
    super(message);
  }
}

function unwrap(res: { status: number; data: unknown }, what: string): any {
  if (res.status < 200 || res.status >= 300) {
    throw new ImportError(`${what} failed with status ${res.status}`, res.data);
  }
  return (res.data as { data: unknown }).data;
}

export interface ImportResult {
  projectSlug: string;
  projectId: string;
  /** One entry per imported task, in file order. */
  tasks: { code: string; uuid: string; id: string; key: string }[];
}

/**
 * Creates the `paim` project (unless a project with that slug already
 * exists) and imports every task of `tasksMdContent` into it.
 */
export async function importTasks(
  client: HttpClient,
  tasksMdContent: string,
  workspacePath: string,
): Promise<ImportResult> {
  const existing = unwrap(await client.get("/api/projects?status=all"), "list projects");
  const found = (existing as { slug: string; id: string }[]).find(
    (p) => p.slug === PROJECT_NAME,
  );

  let projectId: string;
  let projectSlug: string;
  if (found) {
    projectId = found.id;
    projectSlug = found.slug;
  } else {
    const project = unwrap(
      await client.post("/api/projects", {
        name: PROJECT_NAME,
        slug: PROJECT_NAME,
        type: "node",
        workspacePath,
        fieldSchema: [
          {
            key: "type",
            type: "select",
            options: [...TYPE_OPTIONS],
            showInTable: true,
            showAsFacet: true,
          },
          { key: "registry_uuid", type: "text", hidden: true },
        ],
      }),
      "create project",
    );
    projectId = project.id as string;
    projectSlug = project.slug as string;
  }

  const parsed = parseTasksMd(tasksMdContent);
  const uuidToId = new Map<string, string>();
  const tasks: ImportResult["tasks"] = [];

  for (const task of parsed) {
    const dependsOn = task.dependsOn.map((uuid) => {
      const id = uuidToId.get(uuid);
      if (!id) {
        throw new ImportError(
          `${task.code} depends on uuid ${uuid}, which was not imported before it`,
          { code: task.code, uuid },
        );
      }
      return id;
    });

    const created = unwrap(
      await client.post(`/api/projects/${projectSlug}/tasks`, {
        title: `${task.code} — ${task.heading}`,
        description: task.body,
        priority: task.priority,
        size: task.size,
        dependsOn,
        fields: { registry_uuid: task.uuid },
      }),
      `create task ${task.code}`,
    );

    uuidToId.set(task.uuid, created.id as string);
    tasks.push({ code: task.code, uuid: task.uuid, id: created.id as string, key: created.key as string });
  }

  return { projectSlug, projectId, tasks };
}

const isMain =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isMain) {
  const content = readFileSync(TASKS_MD_PATH, "utf-8");
  importTasks(fetchClient(BASE_URL), content, REPO_ROOT)
    .then((result) => {
      // eslint-disable-next-line no-console
      console.log(
        `Imported ${result.tasks.length} tasks into project "${result.projectSlug}" (${result.projectId}).`,
      );
    })
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error(err instanceof ImportError ? `${err.message}: ${JSON.stringify(err.details)}` : err);
      process.exit(1);
    });
}

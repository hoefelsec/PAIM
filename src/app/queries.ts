/* TanStack Query wiring.
 *
 * Query keys live here, not at the call sites: the events stream
 * (specs/06-events.md) will invalidate them from one subscriber, and it can
 * only do that if there is one list of them.
 */

import {
  QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from "@tanstack/react-query";
import { apiGet, apiList, apiPatch, type ListEnvelope } from "./api";
import { mergeTask, type TaskPatch } from "./edit";
import type { TaskView } from "./table";
import type { ProjectView } from "../shared/types.js";

export type ProjectFilter = "active" | "archived" | "all";

export const queryKeys = {
  projects: (filter: ProjectFilter) => ["projects", filter] as const,
  project: (slug: string) => ["project", slug] as const,
  /** Task tallies for one project: the grid card and the switcher read these. */
  projectStats: (slug: string) => ["project-stats", slug] as const,
  /** Every task of one project — what the table groups and draws. */
  tasks: (slug: string) => ["tasks", slug] as const,
  /** One task, by key — what the task view reads (docs/07 "The task view"). */
  task: (slug: string, key: string) => ["task", slug, key] as const,
};

/**
 * The service is on loopback, so a failed request is a real failure rather
 * than a flaky network: report it instead of retrying three times.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        refetchOnWindowFocus: false,
        staleTime: 5_000,
      },
    },
  });
}

export function useProjects(filter: ProjectFilter = "all"): UseQueryResult<ProjectView[]> {
  return useQuery({
    queryKey: queryKeys.projects(filter),
    queryFn: async () => (await apiList<ProjectView>(`/api/projects?status=${filter}`)).data,
  });
}

export function useProject(slug: string): UseQueryResult<ProjectView> {
  return useQuery({
    queryKey: queryKeys.project(slug),
    queryFn: () => apiGet<ProjectView>(`/api/projects/${encodeURIComponent(slug)}`),
  });
}

export interface ProjectStats {
  total: number;
  open: number;
  done: number;
}

/** A count without a page of rows: `limit=1` and read `meta.total`. */
async function countTasks(path: string): Promise<number> {
  return (await apiList<unknown>(path)).meta.total;
}

/**
 * The largest page `GET /api/projects/:project/tasks` will serve
 * (src/server/tasks/query.ts `MAX_LIMIT`). The table shows the whole project
 * grouped by status, so it walks the cursor to the end rather than paging on
 * screen: at one request per 500 tasks, a project the size of this one is
 * one round trip.
 */
const PAGE_SIZE = 500;

/** A ceiling on the walk, so a cursor the service never ends cannot spin. */
const MAX_PAGES = 40;

async function fetchAllTasks(slug: string): Promise<TaskView[]> {
  const base = `/api/projects/${encodeURIComponent(slug)}/tasks?limit=${PAGE_SIZE}`;
  const tasks: TaskView[] = [];
  let cursor: string | null = null;

  for (let page = 0; page < MAX_PAGES; page++) {
    // Annotated: `cursor` is read from the answer to this very request, and
    // the inference would be circular without a type on the way in.
    const path: string = cursor === null ? base : `${base}&cursor=${encodeURIComponent(cursor)}`;
    const envelope: ListEnvelope<TaskView> = await apiList<TaskView>(path);
    for (const task of envelope.data) tasks.push(task);
    if (!envelope.meta.hasMore || envelope.meta.cursor === null) break;
    cursor = envelope.meta.cursor;
  }

  return tasks;
}

export function useTasks(slug: string): UseQueryResult<TaskView[]> {
  return useQuery({
    queryKey: queryKeys.tasks(slug),
    queryFn: () => fetchAllTasks(slug),
  });
}

/**
 * One task, by key or by UUID (docs/06 accepts either as the reference).
 *
 * The task view reads this rather than picking a row out of the table's list:
 * a deep link into a task must load that one task without first walking every
 * page of the project (docs/07 "Routes").
 */
export function useTask(slug: string, key: string): UseQueryResult<TaskView> {
  return useQuery({
    queryKey: queryKeys.task(slug, key),
    queryFn: () =>
      apiGet<TaskView>(
        `/api/projects/${encodeURIComponent(slug)}/tasks/${encodeURIComponent(key)}`,
      ),
  });
}

/* ── writes ─────────────────────────────────────────────────────────────── */

/** One inline edit: the row the user was looking at, and the write it makes. */
export interface SaveTaskVars {
  task: TaskView;
  patch: TaskPatch;
}

/** The caches as they were before the optimistic change — what a refusal restores. */
interface SaveContext {
  previous: TaskView[] | undefined;
  /** The single-task cache the task view reads, when one is loaded. */
  previousTask: TaskView | undefined;
}

/** Replaces one task in the cached list, leaving the order alone. */
function replaceTask(rows: TaskView[] | undefined, id: string, next: (row: TaskView) => TaskView) {
  return rows?.map((row) => (row.id === id ? next(row) : row));
}

/**
 * Saves an inline edit (docs/07 "Editing").
 *
 * Optimistic: the cached list carries the new value before the request
 * leaves, so the cell never shows a stale value while a loopback round trip
 * completes. Then one of two things happens.
 *
 * - The service answers: the record it returns replaces the guess, timestamp
 *   included. That is the reconcile — the service, not the client, decides
 *   what the task now is.
 * - The service refuses: the snapshot taken before the change goes back, and
 *   the caller flashes the row (docs/13 "Motion").
 *
 * The mutation does not invalidate the list. A refetch of every row after
 * every keystroke-sized write is a waste on a loopback service, and the
 * events stream (T22) is what keeps the table current when another writer
 * moves the same task.
 */
export function useSaveTask(slug: string) {
  const client = useQueryClient();
  const key = queryKeys.tasks(slug);

  return useMutation<TaskView, Error, SaveTaskVars, SaveContext>({
    mutationFn: ({ task, patch }) =>
      apiPatch<TaskView>(
        `/api/projects/${encodeURIComponent(slug)}/tasks/${encodeURIComponent(task.key)}`,
        patch,
        task.updatedAt,
      ),

    onMutate: async ({ task, patch }) => {
      // A read in flight would land after the optimistic write and undo it.
      const single = queryKeys.task(slug, task.key);
      await Promise.all([
        client.cancelQueries({ queryKey: key }),
        client.cancelQueries({ queryKey: single }),
      ]);
      const previous = client.getQueryData<TaskView[]>(key);
      const previousTask = client.getQueryData<TaskView>(single);
      client.setQueryData<TaskView[]>(key, (rows) =>
        replaceTask(rows, task.id, (row) => mergeTask(row, patch)),
      );
      // The task view edits the same task through the same mutation, so its
      // own cache moves with the list — one write, one optimistic copy.
      if (previousTask) client.setQueryData<TaskView>(single, mergeTask(previousTask, patch));
      return { previous, previousTask };
    },

    onError: (_error, vars, context) => {
      if (context?.previous) client.setQueryData<TaskView[]>(key, context.previous);
      if (context?.previousTask) {
        client.setQueryData<TaskView>(queryKeys.task(slug, vars.task.key), context.previousTask);
      }
    },

    onSuccess: (record, vars) => {
      client.setQueryData<TaskView[]>(key, (rows) =>
        // Spread over the row: the list endpoint computes an epic's progress
        // (docs/02) and a single-task answer that omits it must not erase it.
        replaceTask(rows, record.id, (row) => ({ ...row, ...record })),
      );
      client.setQueryData<TaskView>(queryKeys.task(slug, vars.task.key), (current) =>
        current === undefined ? undefined : { ...current, ...record },
      );
    },
  });
}

export function useProjectStats(slug: string): UseQueryResult<ProjectStats> {
  return useQuery({
    queryKey: queryKeys.projectStats(slug),
    queryFn: async (): Promise<ProjectStats> => {
      const base = `/api/projects/${encodeURIComponent(slug)}/tasks?limit=1`;
      const [total, open, done] = await Promise.all([
        countTasks(base),
        countTasks(`${base}&open=true`),
        countTasks(`${base}&status=done`),
      ]);
      return { total, open, done };
    },
  });
}

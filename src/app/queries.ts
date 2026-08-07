/* TanStack Query wiring.
 *
 * Query keys live here, not at the call sites: the events stream
 * (specs/06-events.md) will invalidate them from one subscriber, and it can
 * only do that if there is one list of them.
 */

import { QueryClient, useQuery, type UseQueryResult } from "@tanstack/react-query";
import { apiGet, apiList, type ListEnvelope } from "./api";
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

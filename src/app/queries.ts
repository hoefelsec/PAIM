/* TanStack Query wiring.
 *
 * Query keys live here, not at the call sites: the events stream
 * (specs/06-events.md) will invalidate them from one subscriber, and it can
 * only do that if there is one list of them.
 */

import { QueryClient, useQuery, type UseQueryResult } from "@tanstack/react-query";
import { apiGet, apiList } from "./api";
import type { ProjectView } from "../shared/types.js";

export type ProjectFilter = "active" | "archived" | "all";

export const queryKeys = {
  projects: (filter: ProjectFilter) => ["projects", filter] as const,
  project: (slug: string) => ["project", slug] as const,
  /** Task tallies for one project: the grid card and the switcher read these. */
  projectStats: (slug: string) => ["project-stats", slug] as const,
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

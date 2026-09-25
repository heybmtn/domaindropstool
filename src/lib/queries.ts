import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  DashboardStats,
  QueueState,
  ResearchEnqueueResult,
  ResearchRequest,
  SavedFilterDto,
  SettingsDto,
} from "../../shared/api";
import type { DomainFilter, UserStatus } from "../../shared/filters";
import { api } from "./api";

/** Shared React Query hooks. */

export const keys = {
  stats: ["stats"] as const,
  domains: (query: string) => ["domains", query] as const,
  /** Count per filter (not per page/sort), shared by the table and the research modal. */
  domainCount: (filterQuery: string) => ["domains-count", filterQuery] as const,
  domain: (id: number) => ["domain", id] as const,
  queue: ["queue"] as const,
  settings: ["settings"] as const,
  filters: ["filters"] as const,
  imports: ["imports"] as const,
};

export function useStats() {
  return useQuery({ queryKey: keys.stats, queryFn: () => api.get<DashboardStats>("/stats") });
}

export function useQueueState(refetchInterval: number | false = false) {
  return useQuery({ queryKey: keys.queue, queryFn: () => api.get<QueueState>("/research/queue"), refetchInterval });
}

export function useSettings() {
  return useQuery({ queryKey: keys.settings, queryFn: () => api.get<SettingsDto>("/settings") });
}

export function useSavedFilters() {
  return useQuery({ queryKey: keys.filters, queryFn: () => api.get<{ items: SavedFilterDto[] }>("/filters") });
}

/** Invalidates everything that shows domain state after a mutation. */
export function useInvalidateDomains() {
  const client = useQueryClient();
  return () =>
    Promise.all([
      client.invalidateQueries({ queryKey: ["domains"] }),
      client.invalidateQueries({ queryKey: ["domains-count"] }),
      client.invalidateQueries({ queryKey: ["domain"] }),
      client.invalidateQueries({ queryKey: keys.stats }),
      client.invalidateQueries({ queryKey: keys.queue }),
    ]);
}

export function useEnqueueResearch() {
  const invalidate = useInvalidateDomains();
  return useMutation({
    mutationFn: (body: Partial<ResearchRequest>) => api.post<ResearchEnqueueResult>("/research", body),
    onSuccess: () => invalidate(),
  });
}

export function useShortlist() {
  const invalidate = useInvalidateDomains();
  return useMutation({
    mutationFn: (domainIds: number[]) => api.post<{ added: number }>("/shortlist", { domainIds }),
    onSuccess: () => invalidate(),
  });
}

export function useUnshortlist() {
  const invalidate = useInvalidateDomains();
  return useMutation({
    mutationFn: (domainId: number) => api.delete<void>(`/shortlist/${domainId}`),
    onSuccess: () => invalidate(),
  });
}

export function useSetUserStatus() {
  const invalidate = useInvalidateDomains();
  return useMutation({
    mutationFn: (body: { domainIds: number[]; userStatus: UserStatus }) => api.post<{ updated: number }>("/domains/status", body),
    onSuccess: () => invalidate(),
  });
}

export function useSaveFilter() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; configuration: DomainFilter }) => api.post<SavedFilterDto>("/filters", body),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.filters }),
  });
}

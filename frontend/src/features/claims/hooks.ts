import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LIVE_REFRESH_MS } from "@/lib/query-client";
import { refreshEverything } from "@/lib/refresh";
import { claimsApi, type ClaimActionBody, type ClaimFilters } from "./api";

export const claimKeys = {
  list: (filters: ClaimFilters) => ["claims", filters] as const,
  counts: ["claims", "counts"] as const,
  detail: (id: string) => ["claim", id] as const,
};

export function useClaims(filters: ClaimFilters) {
  return useQuery({
    queryKey: claimKeys.list(filters),
    queryFn: () => claimsApi.list(filters),
    placeholderData: keepPreviousData,
    refetchInterval: LIVE_REFRESH_MS,
  });
}

export function useClaimCounts() {
  return useQuery({
    queryKey: claimKeys.counts,
    queryFn: claimsApi.counts,
    refetchInterval: LIVE_REFRESH_MS,
  });
}

export function useClaim(id: string | undefined) {
  return useQuery({
    queryKey: claimKeys.detail(id ?? ""),
    queryFn: () => claimsApi.get(id ?? ""),
    enabled: !!id,
    refetchInterval: LIVE_REFRESH_MS,
  });
}

export function useClaimAction(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ClaimActionBody) => claimsApi.act(id, body),
    onSuccess: () => refreshEverything(qc),
  });
}

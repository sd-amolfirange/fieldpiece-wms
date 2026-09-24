import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LIVE_REFRESH_MS } from "@/lib/query-client";
import { refreshEverything } from "@/lib/refresh";
import type { PageParams } from "@/types";
import { adminApi, type IntegrationFilters } from "./api";

export const adminKeys = {
  users: (params: PageParams) => ["admin", "users", params] as const,
  policies: ["admin", "policies"] as const,
  settings: ["admin", "settings"] as const,
  integrations: (filters: IntegrationFilters) => ["integrations", filters] as const,
  withService: ["complaints", "with-service"] as const,
  submittedClaims: ["claims", "submitted"] as const,
};

// Legacy (out-of-scope screens).
export function useAdminUsers(params: PageParams) {
  return useQuery({ queryKey: adminKeys.users(params), queryFn: () => adminApi.users(params) });
}

export function useWarrantyPolicies() {
  return useQuery({ queryKey: adminKeys.policies, queryFn: adminApi.policies });
}

export function useIntegrations(filters: IntegrationFilters) {
  return useQuery({
    queryKey: adminKeys.integrations(filters),
    queryFn: () => adminApi.integrations(filters),
    placeholderData: keepPreviousData,
    refetchInterval: LIVE_REFRESH_MS,
  });
}

export function useRetryIntegration() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: adminApi.retryIntegration, onSuccess: () => refreshEverything(qc) });
}

export function useComplaintsWithService() {
  return useQuery({
    queryKey: adminKeys.withService,
    queryFn: adminApi.complaintsWithService,
    refetchInterval: LIVE_REFRESH_MS,
  });
}

export function useSubmittedClaims() {
  return useQuery({
    queryKey: adminKeys.submittedClaims,
    queryFn: adminApi.submittedClaims,
    refetchInterval: LIVE_REFRESH_MS,
  });
}

export function useSimulator() {
  const qc = useQueryClient();
  const onSuccess = () => refreshEverything(qc);
  return {
    jobResult: useMutation({ mutationFn: adminApi.simulateJobResult, onSuccess }),
    oemDecision: useMutation({ mutationFn: adminApi.simulateOemDecision, onSuccess }),
    reset: useMutation({ mutationFn: adminApi.resetDemo, onSuccess }),
  };
}

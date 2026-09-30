import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { LIVE_REFRESH_MS } from "@/lib/query-client";
import { dashboardApi } from "./api";

export const dashboardKeys = {
  summary: (dealerId?: string) => ["dashboard", "summary", dealerId ?? "all"] as const,
  finance: (dealerId?: string) => ["dashboard", "finance", dealerId ?? "all"] as const,
};

export function useDashboardSummary(dealerId?: string) {
  return useQuery({
    queryKey: dashboardKeys.summary(dealerId),
    queryFn: () => dashboardApi.summary(dealerId),
    placeholderData: keepPreviousData,
    refetchInterval: LIVE_REFRESH_MS,
  });
}

export function useFinanceSummary(dealerId?: string, enabled = true) {
  return useQuery({
    queryKey: dashboardKeys.finance(dealerId),
    queryFn: () => dashboardApi.finance(dealerId),
    placeholderData: keepPreviousData,
    refetchInterval: LIVE_REFRESH_MS,
    enabled,
  });
}

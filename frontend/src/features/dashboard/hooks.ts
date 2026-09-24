import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { LIVE_REFRESH_MS } from "@/lib/query-client";
import { dashboardApi } from "./api";

export const dashboardKeys = {
  summary: (dealerId?: string) => ["dashboard", "summary", dealerId ?? "all"] as const,
};

export function useDashboardSummary(dealerId?: string) {
  return useQuery({
    queryKey: dashboardKeys.summary(dealerId),
    queryFn: () => dashboardApi.summary(dealerId),
    placeholderData: keepPreviousData,
    refetchInterval: LIVE_REFRESH_MS,
  });
}

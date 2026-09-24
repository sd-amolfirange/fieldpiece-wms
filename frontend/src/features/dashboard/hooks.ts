import { useQuery } from "@tanstack/react-query";
import { LIVE_REFRESH_MS } from "@/lib/query-client";
import { dashboardApi } from "./api";

export const dashboardKeys = { summary: ["dashboard", "summary"] as const };

export function useDashboardSummary() {
  return useQuery({
    queryKey: dashboardKeys.summary,
    queryFn: dashboardApi.summary,
    refetchInterval: LIVE_REFRESH_MS,
  });
}

import { http } from "@/lib/http";
import type { DashboardSummary } from "./types";

// The API scopes the summary to the caller's role and account.
export const dashboardApi = {
  /** `dealerId`: a distributor's DL01 narrowed to one of its dealers. */
  summary: (dealerId?: string) =>
    http.get<DashboardSummary>("/dashboard/summary", { params: { dealerId } }).then((r) => r.data),
};

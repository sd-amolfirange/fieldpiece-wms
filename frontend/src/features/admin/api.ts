import type {
  ClaimView,
  ComplaintView,
  IntegrationDirection,
  IntegrationMessage,
  IntegrationStatus,
  IntegrationSystem,
  Paginated as DemoPaginated,
  PartType,
} from "@wms/domain";
import { http } from "@/lib/http";
import type { Paginated, PageParams, WarrantyPolicy } from "@/types";
import type { AdminUser, AppSettings } from "./types";

export interface IntegrationFilters extends PageParams {
  system?: IntegrationSystem;
  direction?: IntegrationDirection;
  status?: IntegrationStatus;
}

export const adminApi = {
  // Legacy (out-of-scope policies / settings screens, not routed).
  users: (params: PageParams) =>
    http.get<Paginated<AdminUser>>("/admin/users", { params }).then((r) => r.data),
  policies: () => http.get<WarrantyPolicy[]>("/admin/policies").then((r) => r.data),
  settings: () => http.get<AppSettings>("/admin/settings").then((r) => r.data),
  saveSettings: (body: AppSettings) => http.put<AppSettings>("/admin/settings", body).then((r) => r.data),

  // A12 Integration log
  integrations: (filters: IntegrationFilters) =>
    http.get<DemoPaginated<IntegrationMessage>>("/integrations", { params: filters }).then((r) => r.data),
  retryIntegration: (id: string) =>
    http.post<IntegrationMessage>(`/integrations/${encodeURIComponent(id)}/retry`).then((r) => r.data),

  // A13 Simulate panel (demo only): stand-ins for the service system and the OEM.
  complaintsWithService: () =>
    http
      .get<DemoPaginated<ComplaintView>>("/complaints", { params: { status: "WITH_SERVICE", pageSize: 100 } })
      .then((r) => r.data.items),
  submittedClaims: () =>
    http
      .get<DemoPaginated<ClaimView>>("/claims", { params: { status: "SUBMITTED", pageSize: 100 } })
      .then((r) => r.data.items),
  simulateJobResult: (body: { complaintId: string; partType?: Exclude<PartType, "UNIT"> }) =>
    http.post<ComplaintView>("/simulate/job-result", body).then((r) => r.data),
  simulateOemDecision: (body: { claimId: string; decision: "APPROVED" | "REJECTED"; reason?: string }) =>
    http.post<ClaimView>("/simulate/oem-decision", body).then((r) => r.data),
  resetDemo: () => http.post<{ ok: true }>("/simulate/reset").then((r) => r.data),
};

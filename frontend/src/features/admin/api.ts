import type {
  IntegrationDirection,
  IntegrationMessage,
  IntegrationStatus,
  IntegrationSystem,
  OrgStructure,
  Paginated as DemoPaginated,
  RegistrationView,
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

  // A11 Dealers & users: distributor -> dealer hierarchy and every login.
  org: () => http.get<OrgStructure>("/admin/org").then((r) => r.data),

  // A13 System events: stand-ins for the systems that send registrations (distributor ERP, the registration
  // mailbox, an online marketplace through the partner API).
  simulateErpInvoice: () => http.post<RegistrationView[]>("/simulate/erp-invoice").then((r) => r.data),
  simulateRegistrationEmail: () =>
    http.post<RegistrationView>("/simulate/registration-email").then((r) => r.data),
  simulateMarketplaceOrder: () =>
    http.post<RegistrationView[]>("/simulate/marketplace-order").then((r) => r.data),
  /** Fieldpiece's own apps registering products through the partner API. */
  simulateJobLinkRegistration: () =>
    http.post<RegistrationView[]>("/simulate/joblink-registration").then((r) => r.data),
  simulateOverwatchRegistration: () =>
    http.post<RegistrationView[]>("/simulate/overwatch-registration").then((r) => r.data),
  resetDemo: () => http.post<{ ok: true }>("/simulate/reset").then((r) => r.data),
};

import type {
  BulkImportView,
  IntakeInfo,
  ModelView,
  Paginated,
  PartnerClientView,
  RegistrationChannel,
  RegistrationFlag,
  RegistrationRowInput,
  RegistrationStatus,
  RegistrationView,
} from "@wms/domain";
import { env } from "@/lib/env";
import { http } from "@/lib/http";
import type { PageParams } from "@/types";

export interface RegistrationFilters extends PageParams {
  status?: RegistrationStatus;
  channel?: RegistrationChannel;
  flag?: RegistrationFlag;
}

/** Body for POST /registrations: dealer form (DL03), admin manual add, or customer self-registration (CU01). */
export interface NewRegistration extends RegistrationRowInput {
  placeOfPurchase?: string;
  dealerId?: string;
  attachmentIds: string[];
}

/** The public web form (no account): the fields plus the proof of purchase, sent as one multipart request. */
export interface PublicRegistration extends RegistrationRowInput {
  placeOfPurchase?: string;
  /** Honeypot: hidden from people, filled in by spam bots. */
  website?: string;
}

export interface NewPartnerClient {
  name: string;
  channel: PartnerClientView["channel"];
  dealerId?: string;
}

export const registrationsApi = {
  list: (filters: RegistrationFilters) =>
    http.get<Paginated<RegistrationView>>("/registrations", { params: filters }).then((r) => r.data),
  get: (id: string) =>
    http.get<RegistrationView>(`/registrations/${encodeURIComponent(id)}`).then((r) => r.data),
  create: (body: NewRegistration) => http.post<RegistrationView>("/registrations", body).then((r) => r.data),
  approve: (id: string) =>
    http.post<RegistrationView>(`/registrations/${encodeURIComponent(id)}/approve`).then((r) => r.data),
  reject: (id: string, reason: string) =>
    http
      .post<RegistrationView>(`/registrations/${encodeURIComponent(id)}/reject`, { reason })
      .then((r) => r.data),
  merge: (id: string) =>
    http.post<RegistrationView>(`/registrations/${encodeURIComponent(id)}/merge`).then((r) => r.data),
  bulkApprove: (ids: string[]) =>
    http
      .post<{ approved: number; skipped: number }>("/registrations/bulk-approve", { ids })
      .then((r) => r.data),
};

export const bulkImportsApi = {
  list: () => http.get<BulkImportView[]>("/bulk-imports").then((r) => r.data),
  get: (id: string) =>
    http.get<BulkImportView>(`/bulk-imports/${encodeURIComponent(id)}`).then((r) => r.data),
  upload: (file: File, dealerId: string | undefined) => {
    const form = new FormData();
    form.append("file", file, file.name);
    // Sent separately too: some FormData serialisers (jsdom) drop the file name.
    form.append("name", file.name);
    if (dealerId) form.append("dealerId", dealerId);
    return http
      .post<BulkImportView>("/bulk-imports", form, { headers: { "Content-Type": "multipart/form-data" } })
      .then((r) => r.data);
  },
  resubmit: (id: string, rows: { rowNumber: number; values: RegistrationRowInput }[]) =>
    http.put<BulkImportView>(`/bulk-imports/${encodeURIComponent(id)}/rows`, { rows }).then((r) => r.data),
  /** Plain links: the templates need no sign-in. */
  templateUrl: (kind: "xlsx" | "csv") => `${env.apiBaseUrl}/bulk-imports/template.${kind}`,
};

/** Registration channels (hub page), the public web form and partner API keys. */
export const intakeApi = {
  info: () => http.get<IntakeInfo>("/intake").then((r) => r.data),
  publicModels: () => http.get<ModelView[]>("/public/models").then((r) => r.data),
  publicRegister: (fields: PublicRegistration, proof: File) => {
    const form = new FormData();
    for (const [key, value] of Object.entries(fields)) if (typeof value === "string") form.append(key, value);
    form.append("file", proof, proof.name);
    return http
      .post<{ registrationId: string; status: "PENDING" }>("/public/registrations", form, {
        headers: { "Content-Type": "multipart/form-data" },
      })
      .then((r) => r.data);
  },
  partnerClients: () => http.get<PartnerClientView[]>("/admin/partner-clients").then((r) => r.data),
  createPartnerClient: (body: NewPartnerClient) =>
    http
      .post<{ client: PartnerClientView; apiKey: string }>("/admin/partner-clients", body)
      .then((r) => r.data),
  setPartnerActive: (id: string, active: boolean) =>
    http
      .patch<PartnerClientView>(`/admin/partner-clients/${encodeURIComponent(id)}`, { active })
      .then((r) => r.data),
};

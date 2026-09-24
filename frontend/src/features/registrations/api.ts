import type {
  BulkImportView,
  Paginated,
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
  purchaseDate?: string;
  location?: string;
  dealerId?: string;
  attachmentIds: string[];
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

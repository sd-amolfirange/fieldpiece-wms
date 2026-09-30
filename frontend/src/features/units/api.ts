import type {
  Coverage,
  ExtensionQuote,
  Paginated,
  RegistrationChannel,
  RegistrationView,
  UnitView,
  VoidReason,
  WarrantyStatus,
} from "@wms/domain";
import { filesApi } from "@/features/files";
import { saveBlob } from "@/lib/download";
import { http } from "@/lib/http";
import type { PageParams } from "@/types";

export interface UnitFilters extends PageParams {
  status?: WarrantyStatus;
  dealerId?: string;
  /** Registration channel, or "APPS" for Fieldpiece's apps (Overwatch or Job Link). */
  channel?: RegistrationChannel | "APPS";
}

// The server scopes every call: admin sees all products, dealers their own, distributors their dealers',
// customers theirs.
export const unitsApi = {
  list: (filters: UnitFilters) =>
    http.get<Paginated<UnitView>>("/units", { params: filters }).then((r) => r.data),
  get: (serial: string) => http.get<UnitView>(`/units/${encodeURIComponent(serial)}`).then((r) => r.data),
  /** Whether the product's warranty covers a claim today. */
  coverage: (serial: string) =>
    http.get<Coverage>(`/units/${encodeURIComponent(serial)}/coverage`).then((r) => r.data),
  downloadCertificate: (serial: string) =>
    filesApi
      .download(`/units/${encodeURIComponent(serial)}/certificate.pdf`)
      .then((blob) => saveBlob(blob, `warranty-${serial}.pdf`)),
  /** A05: admin voids the warranty with a reason and a note (recorded with user and date). */
  voidWarranty: (serial: string, body: { reason: VoidReason; note?: string }) =>
    http.post<UnitView>(`/units/${encodeURIComponent(serial)}/void`, body).then((r) => r.data),
  /** Extended-warranty offer for the product today (plans, prices, new end dates) or why it can't be extended. */
  extensionQuote: (serial: string) =>
    http.get<ExtensionQuote>(`/units/${encodeURIComponent(serial)}/extension`).then((r) => r.data),
  /** Buys / sells an extended warranty: moves the warranty end by `months`. */
  extend: (serial: string, months: number) =>
    http.post<UnitView>(`/units/${encodeURIComponent(serial)}/extensions`, { months }).then((r) => r.data),
  /** The signed-in customer's self-registrations still waiting for approval (CU02). */
  myPendingRegistrations: () =>
    http
      .get<Paginated<RegistrationView>>("/registrations", { params: { status: "PENDING", pageSize: 50 } })
      .then((r) => r.data),
};

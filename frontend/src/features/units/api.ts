import type { Paginated, RegistrationView, UnitView, WarrantyStatus } from "@wms/domain";
import { filesApi } from "@/features/files";
import { saveBlob } from "@/lib/download";
import { http } from "@/lib/http";
import type { PageParams } from "@/types";

export interface UnitFilters extends PageParams {
  status?: WarrantyStatus;
  dealerId?: string;
}

// The demo server scopes every call: admin sees all units, dealers their own, distributors their dealers',
// customers theirs.
export const unitsApi = {
  list: (filters: UnitFilters) =>
    http.get<Paginated<UnitView>>("/units", { params: filters }).then((r) => r.data),
  get: (serial: string) => http.get<UnitView>(`/units/${encodeURIComponent(serial)}`).then((r) => r.data),
  downloadCertificate: (serial: string) =>
    filesApi
      .download(`/units/${encodeURIComponent(serial)}/certificate.pdf`)
      .then((blob) => saveBlob(blob, `warranty-${serial}.pdf`)),
  /** The signed-in customer's self-registrations still waiting for approval (CU02). */
  myPendingRegistrations: () =>
    http
      .get<Paginated<RegistrationView>>("/registrations", { params: { status: "PENDING", pageSize: 50 } })
      .then((r) => r.data),
};

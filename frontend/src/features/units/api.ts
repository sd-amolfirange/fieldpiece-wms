import type { Paginated, UnitView, WarrantyStatus } from "@wms/domain";
import { downloadApiFile } from "@/lib/download";
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
    downloadApiFile(`/units/${encodeURIComponent(serial)}/certificate.pdf`, `warranty-${serial}.pdf`),
};

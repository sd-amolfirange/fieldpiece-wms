import type {
  ComplaintSource,
  ComplaintStatus,
  ComplaintView,
  Entitlement,
  Paginated,
  UnitView,
} from "@wms/domain";
import { http } from "@/lib/http";
import type { PageParams } from "@/types";

export interface ComplaintFilters extends PageParams {
  status?: ComplaintStatus;
  source?: ComplaintSource;
}

export interface NewComplaint {
  unitSerial: string;
  description: string;
  attachmentIds: string[];
}

// The demo server scopes complaints: admin sees all, dealers their units', customers their own.
export const complaintsApi = {
  list: (filters: ComplaintFilters) =>
    http.get<Paginated<ComplaintView>>("/complaints", { params: filters }).then((r) => r.data),
  get: (id: string) => http.get<ComplaintView>(`/complaints/${encodeURIComponent(id)}`).then((r) => r.data),
  create: (body: NewComplaint) => http.post<ComplaintView>("/complaints", body).then((r) => r.data),
  sendToService: (id: string) =>
    http.post<ComplaintView>(`/complaints/${encodeURIComponent(id)}/send-to-service`).then((r) => r.data),
  /** Units the caller may raise a complaint on. */
  units: () =>
    http
      .get<Paginated<UnitView>>("/units", { params: { pageSize: 100, sort: "serial" } })
      .then((r) => r.data),
  /** What a complaint on this unit would be entitled to today (shown before submitting). */
  entitlement: (serial: string) =>
    http.get<Entitlement>(`/units/${encodeURIComponent(serial)}/entitlement`).then((r) => r.data),
};

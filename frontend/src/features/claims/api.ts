import type {
  ClaimActionName,
  ClaimSource,
  ClaimStatus,
  Coverage,
  IssueType,
  Paginated,
  Resolution,
  UnitView,
  WarrantyClaimView,
} from "@wms/domain";
import { http } from "@/lib/http";
import type { PageParams } from "@/types";

export interface ClaimFilters extends PageParams {
  status?: ClaimStatus;
  source?: ClaimSource;
  issueType?: IssueType;
}

export interface NewClaim {
  unitSerial: string;
  issueType: IssueType;
  description: string;
  attachmentIds: string[];
}

export interface ClaimActionBody {
  action: ClaimActionName;
  resolution?: Resolution;
  creditAmount?: number;
  reason?: string;
  note?: string;
  replacementSerial?: string;
  replacementBatchNumber?: string;
}

// Warranty claims. Everyone files and follows the claims in their scope (the server decides which);
// only the warranty desk (admin) moves them on.
export const claimsApi = {
  list: (filters: ClaimFilters) =>
    http.get<Paginated<WarrantyClaimView>>("/claims", { params: filters }).then((r) => r.data),
  counts: () => http.get<Record<ClaimStatus, number>>("/claims/counts").then((r) => r.data),
  get: (id: string) => http.get<WarrantyClaimView>(`/claims/${encodeURIComponent(id)}`).then((r) => r.data),
  create: (body: NewClaim) => http.post<WarrantyClaimView>("/claims", body).then((r) => r.data),
  act: (id: string, body: ClaimActionBody) =>
    http.post<WarrantyClaimView>(`/claims/${encodeURIComponent(id)}/transitions`, body).then((r) => r.data),
  /** Products the caller may file a claim on. */
  units: () =>
    http
      .get<Paginated<UnitView>>("/units", { params: { pageSize: 100, sort: "serial" } })
      .then((r) => r.data),
  /** Whether the product's warranty covers a claim today (shown before submitting). */
  coverage: (serial: string) =>
    http.get<Coverage>(`/units/${encodeURIComponent(serial)}/coverage`).then((r) => r.data),
};

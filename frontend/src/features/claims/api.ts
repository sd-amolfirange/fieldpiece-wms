import type { ClaimActionName, ClaimStatus, ClaimView, Paginated } from "@wms/domain";
import { http } from "@/lib/http";
import type { PageParams } from "@/types";

export interface ClaimFilters extends PageParams {
  status?: ClaimStatus;
  brandId?: string;
}

export interface ClaimActionBody {
  action: ClaimActionName;
  rmaNumber?: string;
  amount?: number;
  reason?: string;
}

// Manufacturer claims. Admin acts on them; dealers and distributors may read their own (view only).
export const claimsApi = {
  list: (filters: ClaimFilters) =>
    http.get<Paginated<ClaimView>>("/claims", { params: filters }).then((r) => r.data),
  counts: () => http.get<Record<ClaimStatus, number>>("/claims/counts").then((r) => r.data),
  get: (id: string) => http.get<ClaimView>(`/claims/${encodeURIComponent(id)}`).then((r) => r.data),
  act: (id: string, body: ClaimActionBody) =>
    http.post<ClaimView>(`/claims/${encodeURIComponent(id)}/transitions`, body).then((r) => r.data),
};

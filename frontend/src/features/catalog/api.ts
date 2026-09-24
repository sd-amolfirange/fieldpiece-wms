import type { Brand, DealerView, ModelView } from "@wms/domain";
import { http } from "@/lib/http";

// Product master and dealer list, shared by several screens.
export const catalogApi = {
  models: () => http.get<ModelView[]>("/models").then((r) => r.data),
  brands: () => http.get<Brand[]>("/brands").then((r) => r.data),
  /** Dealers the caller may act for (admin: all, distributor: its dealers, dealer: itself). */
  dealers: () => http.get<DealerView[]>("/dealers").then((r) => r.data),
};

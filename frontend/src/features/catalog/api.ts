import type { DealerView, ModelView, ProductCategory } from "@wms/domain";
import { http } from "@/lib/http";

// Product catalog and dealer list, shared by several screens.
export const catalogApi = {
  models: () => http.get<ModelView[]>("/models").then((r) => r.data),
  categories: () => http.get<ProductCategory[]>("/categories").then((r) => r.data),
  /** Dealers the caller may act for (admin: all, distributor: its dealers, dealer: itself). */
  dealers: () => http.get<DealerView[]>("/dealers").then((r) => r.data),
};

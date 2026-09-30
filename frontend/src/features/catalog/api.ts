import type { DealerView, ModelView, ProductCategory } from "@wms/domain";
import { http } from "@/lib/http";

export type ModelFinance = Pick<ModelView, "listPrice" | "repairCost" | "warrantyBudget" | "claimQuota">;

// Product catalog and dealer list, shared by several screens.
export const catalogApi = {
  models: () => http.get<ModelView[]>("/models").then((r) => r.data),
  /** A06: the warranty desk sets a model's prices and warranty quota. */
  updateModelFinance: (id: string, body: ModelFinance) =>
    http.patch<ModelView>(`/models/${encodeURIComponent(id)}`, body).then((r) => r.data),
  categories: () => http.get<ProductCategory[]>("/categories").then((r) => r.data),
  /** Dealers the caller may act for (admin: all, distributor: its dealers, dealer: itself). */
  dealers: () => http.get<DealerView[]>("/dealers").then((r) => r.data),
};

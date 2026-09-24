import { useQuery } from "@tanstack/react-query";
import type { DealerView, ModelView } from "@wms/domain";
import { http } from "./http";
import { useCurrentRole } from "./session";

// Product master and dealer list, shared by several screens. Both change rarely, so they're cached for a while.

export function useModels() {
  return useQuery({
    queryKey: ["models"],
    queryFn: () => http.get<ModelView[]>("/models").then((r) => r.data),
    staleTime: 5 * 60_000,
  });
}

/** Dealers the signed-in user may act for (admin: all, distributor: its dealers, dealer: itself). */
export function useDealers() {
  const role = useCurrentRole();
  return useQuery({
    queryKey: ["dealers"],
    queryFn: () => http.get<DealerView[]>("/dealers").then((r) => r.data),
    enabled: role === "admin" || role === "distributor" || role === "dealer",
    staleTime: 5 * 60_000,
  });
}

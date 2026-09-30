import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCurrentRole } from "@/lib/session";
import { catalogApi, type ModelFinance } from "./api";

// These change rarely, so they're cached for a while.
const STALE = 5 * 60_000;

export function useModels() {
  return useQuery({ queryKey: ["models"], queryFn: catalogApi.models, staleTime: STALE });
}

export function useUpdateModelFinance(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ModelFinance) => catalogApi.updateModelFinance(id, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["models"] });
      void qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

export function useCategories() {
  return useQuery({ queryKey: ["categories"], queryFn: catalogApi.categories, staleTime: STALE });
}

export function useDealers() {
  const role = useCurrentRole();
  return useQuery({
    queryKey: ["dealers"],
    queryFn: catalogApi.dealers,
    enabled: role === "admin" || role === "distributor" || role === "dealer",
    staleTime: STALE,
  });
}

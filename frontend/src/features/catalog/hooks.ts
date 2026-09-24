import { useQuery } from "@tanstack/react-query";
import { useCurrentRole } from "@/lib/session";
import { catalogApi } from "./api";

// These change rarely, so they're cached for a while.
const STALE = 5 * 60_000;

export function useModels() {
  return useQuery({ queryKey: ["models"], queryFn: catalogApi.models, staleTime: STALE });
}

export function useBrands() {
  return useQuery({ queryKey: ["brands"], queryFn: catalogApi.brands, staleTime: STALE });
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

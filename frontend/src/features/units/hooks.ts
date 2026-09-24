import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { LIVE_REFRESH_MS } from "@/lib/query-client";
import { unitsApi, type UnitFilters } from "./api";

export const unitKeys = {
  all: ["units"] as const,
  list: (filters: UnitFilters) => ["units", filters] as const,
  detail: (serial: string) => ["unit", serial] as const,
};

export function useUnits(filters: UnitFilters) {
  return useQuery({
    queryKey: unitKeys.list(filters),
    queryFn: () => unitsApi.list(filters),
    placeholderData: keepPreviousData,
    refetchInterval: LIVE_REFRESH_MS,
  });
}

export function useUnit(serial: string | undefined) {
  return useQuery({
    queryKey: unitKeys.detail(serial ?? ""),
    queryFn: () => unitsApi.get(serial ?? ""),
    enabled: !!serial,
    refetchInterval: LIVE_REFRESH_MS,
  });
}

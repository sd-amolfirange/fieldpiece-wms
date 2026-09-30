import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { VoidReason } from "@wms/domain";
import { LIVE_REFRESH_MS } from "@/lib/query-client";
import { refreshEverything } from "@/lib/refresh";
import { unitsApi, type UnitFilters } from "./api";

export const unitKeys = {
  all: ["units"] as const,
  list: (filters: UnitFilters) => ["units", filters] as const,
  detail: (serial: string) => ["unit", serial] as const,
  coverage: (serial: string) => ["unit", serial, "coverage"] as const,
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

export function useCoverage(serial: string | undefined) {
  return useQuery({
    queryKey: unitKeys.coverage(serial ?? ""),
    queryFn: () => unitsApi.coverage(serial ?? ""),
    enabled: !!serial,
  });
}

export function useVoidWarranty(serial: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { reason: VoidReason; note?: string }) => unitsApi.voidWarranty(serial, body),
    onSuccess: () => refreshEverything(qc),
  });
}

export function useExtensionQuote(serial: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ["units", serial, "extension"],
    queryFn: () => unitsApi.extensionQuote(serial ?? ""),
    enabled: !!serial && enabled,
  });
}

export function useExtendWarranty(serial: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (months: number) => unitsApi.extend(serial, months),
    onSuccess: () => refreshEverything(qc),
  });
}

export function useMyPendingRegistrations() {
  return useQuery({
    queryKey: ["registrations", { mine: true, status: "PENDING" }],
    queryFn: unitsApi.myPendingRegistrations,
    refetchInterval: LIVE_REFRESH_MS,
  });
}

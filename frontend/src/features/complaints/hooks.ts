import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LIVE_REFRESH_MS } from "@/lib/query-client";
import { refreshEverything } from "@/lib/refresh";
import { complaintsApi, type ComplaintFilters, type NewComplaint } from "./api";

export const complaintKeys = {
  list: (filters: ComplaintFilters) => ["complaints", filters] as const,
  detail: (id: string) => ["complaint", id] as const,
  entitlement: (serial: string) => ["entitlement", serial] as const,
};

export function useComplaints(filters: ComplaintFilters) {
  return useQuery({
    queryKey: complaintKeys.list(filters),
    queryFn: () => complaintsApi.list(filters),
    placeholderData: keepPreviousData,
    refetchInterval: LIVE_REFRESH_MS,
  });
}

export function useComplaint(id: string | undefined) {
  return useQuery({
    queryKey: complaintKeys.detail(id ?? ""),
    queryFn: () => complaintsApi.get(id ?? ""),
    enabled: !!id,
    refetchInterval: LIVE_REFRESH_MS,
  });
}

export function useEntitlement(serial: string | undefined) {
  return useQuery({
    queryKey: complaintKeys.entitlement(serial ?? ""),
    queryFn: () => complaintsApi.entitlement(serial ?? ""),
    enabled: !!serial,
  });
}

export function useCreateComplaint() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: NewComplaint) => complaintsApi.create(body),
    onSuccess: () => refreshEverything(qc),
  });
}

export function useSendToService(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => complaintsApi.sendToService(id),
    onSuccess: () => refreshEverything(qc),
  });
}

/** Registered units the caller can raise a complaint on (the server scopes them to the caller). */
export function useUnitsForComplaint() {
  return useQuery({
    queryKey: ["units", "for-complaint"],
    queryFn: () => complaintsApi.units().then((page) => page.items.filter((u) => u.status !== "PENDING")),
  });
}

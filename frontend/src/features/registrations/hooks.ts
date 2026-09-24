import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { LIVE_REFRESH_MS } from "@/lib/query-client";
import { bulkImportsApi, registrationsApi, type NewRegistration, type RegistrationFilters } from "./api";

export const registrationKeys = {
  all: ["registrations"] as const,
  list: (filters: RegistrationFilters) => ["registrations", filters] as const,
  detail: (id: string) => ["registration", id] as const,
  bulk: ["bulk-imports"] as const,
  bulkDetail: (id: string) => ["bulk-import", id] as const,
};

/** A registration decision changes units, counts and the dashboard, so refresh all of them. */
const refreshAfterChange = (qc: QueryClient) =>
  Promise.all(
    [registrationKeys.all, ["registration"], ["units"], ["unit"], ["dashboard"], registrationKeys.bulk].map(
      (queryKey) => qc.invalidateQueries({ queryKey }),
    ),
  );

export function useRegistrations(filters: RegistrationFilters) {
  return useQuery({
    queryKey: registrationKeys.list(filters),
    queryFn: () => registrationsApi.list(filters),
    placeholderData: keepPreviousData,
    refetchInterval: LIVE_REFRESH_MS,
  });
}

export function useRegistration(id: string | undefined) {
  return useQuery({
    queryKey: registrationKeys.detail(id ?? ""),
    queryFn: () => registrationsApi.get(id ?? ""),
    enabled: !!id,
  });
}

export function useCreateRegistration() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: NewRegistration) => registrationsApi.create(body),
    onSuccess: () => refreshAfterChange(qc),
  });
}

export function useRegistrationDecision(id: string) {
  const qc = useQueryClient();
  const onSuccess = () => refreshAfterChange(qc);
  return {
    approve: useMutation({ mutationFn: () => registrationsApi.approve(id), onSuccess }),
    reject: useMutation({ mutationFn: (reason: string) => registrationsApi.reject(id, reason), onSuccess }),
    merge: useMutation({ mutationFn: () => registrationsApi.merge(id), onSuccess }),
  };
}

export function useBulkApprove() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: registrationsApi.bulkApprove, onSuccess: () => refreshAfterChange(qc) });
}

export function useBulkImports() {
  return useQuery({ queryKey: registrationKeys.bulk, queryFn: bulkImportsApi.list });
}

export function useBulkImport(id: string | undefined) {
  return useQuery({
    queryKey: registrationKeys.bulkDetail(id ?? ""),
    queryFn: () => bulkImportsApi.get(id ?? ""),
    enabled: !!id,
  });
}

export function useUploadBulk() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ file, dealerId }: { file: File; dealerId?: string }) =>
      bulkImportsApi.upload(file, dealerId),
    onSuccess: (batch) => {
      qc.setQueryData(registrationKeys.bulkDetail(batch.id), batch);
      return refreshAfterChange(qc);
    },
  });
}

export function useResubmitBulk(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (rows: Parameters<typeof bulkImportsApi.resubmit>[1]) => bulkImportsApi.resubmit(id, rows),
    onSuccess: (batch) => {
      qc.setQueryData(registrationKeys.bulkDetail(batch.id), batch);
      return refreshAfterChange(qc);
    },
  });
}

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LIVE_REFRESH_MS } from "@/lib/query-client";
import { useSession } from "@/lib/session";
import { notificationsApi } from "./api";

const KEY = ["notifications"] as const;

export function useNotifications() {
  const signedIn = useSession((s) => s.status === "authenticated");
  return useQuery({
    queryKey: KEY,
    queryFn: notificationsApi.list,
    enabled: signedIn,
    refetchInterval: LIVE_REFRESH_MS,
  });
}

export function useMarkNotificationsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids?: string[]) => notificationsApi.markRead(ids),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Notification } from "@wms/domain";
import { http } from "@/lib/http";
import { LIVE_REFRESH_MS } from "@/lib/query-client";
import { useSession } from "@/lib/session";

const KEY = ["notifications"] as const;

export function useNotifications() {
  const signedIn = useSession((s) => s.status === "authenticated");
  return useQuery({
    queryKey: KEY,
    queryFn: () => http.get<Notification[]>("/notifications").then((r) => r.data),
    enabled: signedIn,
    refetchInterval: LIVE_REFRESH_MS,
  });
}

export function useMarkNotificationsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids?: string[]) => http.post("/notifications/read", { ids }).then(() => undefined),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

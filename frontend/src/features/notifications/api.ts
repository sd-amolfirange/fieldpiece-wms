import type { Notification } from "@wms/domain";
import { http } from "@/lib/http";

// In-app notifications for the signed-in user (bell in the header).
export const notificationsApi = {
  list: () => http.get<Notification[]>("/notifications").then((r) => r.data),
  /** Marks the given notifications read, or all of them without ids. */
  markRead: (ids?: string[]) => http.post("/notifications/read", { ids }).then(() => undefined),
};

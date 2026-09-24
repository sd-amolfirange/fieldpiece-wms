import type { ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Button, Popover } from "@/components/ui";
import { cn } from "@/lib/cn";
import { formatDateTime } from "@/lib/format";
import { useMarkNotificationsRead, useNotifications } from "./hooks";

// Bell popover for every role. The header keeps its existing bell button (passed in as `trigger`); this adds
// the list of recent in-app messages behind it.

export function NotificationsBell({ trigger }: { trigger: (unread: number) => ReactElement }) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const notifications = useNotifications();
  const markRead = useMarkNotificationsRead();
  const items = notifications.data ?? [];
  const unread = items.filter((n) => !n.read).length;

  const open = (id: string, link?: string) => {
    markRead.mutate([id]);
    if (link) {
      // Close the popover (Radix closes on Escape), then go to the linked record.
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      navigate(link);
    }
  };

  return (
    <Popover trigger={trigger(unread)} align="end">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="font-semibold">{t("notifications.title")}</p>
        {unread ? (
          <Button variant="ghost" size="sm" onClick={() => markRead.mutate(undefined)}>
            {t("notifications.markAllRead")}
          </Button>
        ) : null}
      </div>
      {items.length ? (
        <ul className="max-h-72 space-y-1 overflow-y-auto">
          {items.map((n) => (
            <li key={n.id}>
              <button
                type="button"
                className="block w-full rounded px-2 py-2 text-start hover:bg-ink-50"
                onClick={() => open(n.id, n.link)}
              >
                <span className={cn("block text-sm", !n.read && "font-semibold")}>
                  {t(`notifications.${n.key}`, n.params)}
                </span>
                <span className="block text-xs text-text-muted">
                  {formatDateTime(n.createdAt, i18n.language)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-text-muted">{t("notifications.empty")}</p>
      )}
    </Popover>
  );
}

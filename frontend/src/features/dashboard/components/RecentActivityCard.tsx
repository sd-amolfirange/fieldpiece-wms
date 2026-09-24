import type { ActivityItem } from "@wms/domain";
import { ArrowRightLeft, Ban, ClipboardList, MessageSquare, ShieldCheck, FilePlus2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Card, Timeline, type TimelineItem } from "@/components/ui";
import { formatDateTime } from "@/lib/format";

// A01 recent activity: the latest unit events (registrations, replacements, voids, complaints, claims).

const icon = {
  registered: ShieldCheck,
  part_replaced: ArrowRightLeft,
  voided: Ban,
  complaint_raised: MessageSquare,
  claim_created: ClipboardList,
  note: FilePlus2,
} as const;

export function RecentActivityCard({ items }: { items: ActivityItem[] }) {
  const { t, i18n } = useTranslation();
  const timeline: TimelineItem[] = items.map((e, index) => ({
    id: `${e.at}-${index}`,
    icon: icon[e.type],
    actor: e.byName,
    action: (
      <>
        {e.type === "voided" && e.reason
          ? t("units.history.voidedBecause", { reason: t(`units.voidReason.${e.reason}`) })
          : t(`units.history.${e.type}`, { ref: e.refId ?? "" })}{" "}
        ·{" "}
        <Link to={`/units/${e.serial}`} className="font-mono underline-offset-2 hover:underline">
          {e.serial}
        </Link>
      </>
    ),
    timestamp: formatDateTime(e.at, i18n.language),
  }));
  return (
    <Card title={t("dashboard.recentActivity")}>
      {timeline.length ? (
        <Timeline items={timeline} />
      ) : (
        <p className="text-sm text-text-muted">{t("units.noHistory")}</p>
      )}
    </Card>
  );
}

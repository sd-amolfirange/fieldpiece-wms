import type { ExpiringUnit } from "@wms/domain";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Card, MonoId } from "@/components/ui";
import { formatDate } from "@/lib/format";

// A01 expiring-soon list: the units whose warranty ends first (within 30 days), each linking to its unit.

export function ExpiringSoonCard({ units }: { units: ExpiringUnit[] }) {
  const { t, i18n } = useTranslation();
  return (
    <Card
      title={t("dashboard.expiringSoonList")}
      actions={
        <Link to="/units?status=EXPIRING_SOON" className="text-sm underline-offset-2 hover:underline">
          {t("common.viewAll")}
        </Link>
      }
    >
      {units.length ? (
        <ul className="divide-y divide-ink-100">
          {units.map((u) => (
            <li key={u.serial} className="flex items-center justify-between gap-4 py-2 text-sm">
              <span>
                <Link to={`/units/${u.serial}`} className="underline-offset-2 hover:underline">
                  <MonoId>{u.serial}</MonoId>
                </Link>
                <span className="block text-text-muted">
                  {[u.modelName, u.customerName, u.dealerName].filter(Boolean).join(" · ")}
                </span>
              </span>
              <span className="text-end">
                <span className="block font-semibold">
                  {t("dashboard.daysLeft", { count: u.daysRemaining })}
                </span>
                <span className="block text-text-muted">{formatDate(u.warrantyEnd, i18n.language)}</span>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-text-muted">{t("dashboard.noneExpiring")}</p>
      )}
    </Card>
  );
}

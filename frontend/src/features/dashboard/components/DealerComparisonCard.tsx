import type { DealerStats } from "@wms/domain";
import { useTranslation } from "react-i18next";
import { Card } from "@/components/ui";

// DL01 for a distributor: its dealers side by side, to spot the ones behind on registering sales.
// Same table markup as the charts' "View data" tables.

export function DealerComparisonCard({ dealers }: { dealers: DealerStats[] }) {
  const { t } = useTranslation();
  return (
    <Card title={t("dashboard.dealerComparison")}>
      <table className="w-full text-sm">
        <caption className="sr-only">{t("dashboard.dealerComparison")}</caption>
        <thead>
          <tr className="text-overline text-ink-600">
            <th scope="col" className="py-2 text-start">
              {t("dashboard.dealer")}
            </th>
            <th scope="col" className="py-2 text-end">
              {t("dashboard.tiles.registrationsThisMonth")}
            </th>
            <th scope="col" className="py-2 text-end">
              {t("dashboard.tiles.pending")}
            </th>
            <th scope="col" className="py-2 text-end">
              {t("dashboard.tiles.openComplaints")}
            </th>
          </tr>
        </thead>
        <tbody>
          {dealers.map((d) => (
            <tr key={d.dealerId} className="border-t border-ink-100">
              <td className="py-2">{d.dealerName}</td>
              <td className="py-2 text-end font-mono">{d.registrationsThisMonth}</td>
              <td className="py-2 text-end font-mono">{d.pending}</td>
              <td className="py-2 text-end font-mono">{d.openComplaints}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

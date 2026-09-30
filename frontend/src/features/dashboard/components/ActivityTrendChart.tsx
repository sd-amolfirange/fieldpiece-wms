import type { MonthlyTrend } from "@wms/domain";
import { useTranslation } from "react-i18next";
import { ChartCard, TrendChart } from "./charts";

// Registrations (area) and warranty claims (line) per month over the last 12 months, with the claim rate
// (claims per 100 registrations) in the "View data" table.

export function ActivityTrendChart({ data, className }: { data: MonthlyTrend[]; className?: string }) {
  const { t, i18n } = useTranslation();
  const month = (m: string) =>
    new Date(`${m}-01T00:00:00Z`).toLocaleDateString(i18n.language, {
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    });
  const registrations = data.reduce((n, d) => n + d.registrations, 0);
  const claims = data.reduce((n, d) => n + d.claims, 0);
  const rate = registrations ? Math.round((claims / registrations) * 1000) / 10 : 0;

  return (
    <ChartCard
      title={t("dashboard.activityTrend")}
      subtitle={t("dashboard.activityTrendHint", { registrations, claims, rate })}
      className={className}
      rows={data}
      rowKey={(r) => r.month}
      columns={[
        { header: t("dashboard.month"), cell: (r) => month(r.month) },
        { header: t("dashboard.registrations"), cell: (r) => r.registrations, numeric: true },
        { header: t("dashboard.claims"), cell: (r) => r.claims, numeric: true },
      ]}
    >
      <TrendChart
        data={data}
        lang={i18n.language}
        ariaLabel={t("dashboard.activityTrend")}
        series={[
          {
            key: "registrations",
            label: t("dashboard.registrations"),
            color: "var(--brand-500)",
            type: "area",
          },
          { key: "claims", label: t("dashboard.claims"), color: "var(--ink-900)", type: "line" },
        ]}
      />
    </ChartCard>
  );
}

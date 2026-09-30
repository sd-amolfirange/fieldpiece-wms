import type { CategoryCount } from "@wms/domain";
import { useTranslation } from "react-i18next";
import { ChartCard, HorizontalBarChart } from "./charts";
import { pct } from "./chart-utils";

// A01 Claims by product category: where warranty claims come from, as horizontal bars labelled with the count and
// the category's share of all claims, largest first; categories without claims are left out of the bars (the
// "View data" table lists them all). One colour, because categories aren't statuses.

export function ClaimsByCategoryChart({ data }: { data: CategoryCount[] }) {
  const { t } = useTranslation();
  const total = data.reduce((n, d) => n + d.count, 0);
  const rows = [...data].sort((a, b) => b.count - a.count || a.categoryName.localeCompare(b.categoryName));

  return (
    <ChartCard
      title={t("dashboard.claimsByCategory")}
      rows={rows}
      rowKey={(r) => r.categoryId}
      columns={[
        { header: t("dashboard.category"), cell: (r) => r.categoryName },
        { header: "%", cell: (r) => `${pct(r.count, total)}%`, numeric: true },
        { header: "#", cell: (r) => r.count, numeric: true },
      ]}
    >
      <HorizontalBarChart
        ariaLabel={t("dashboard.claimsByCategory")}
        data={rows
          .filter((r) => r.count > 0)
          .map((r) => ({
            key: r.categoryId,
            label: r.categoryName,
            value: r.count,
            color: "var(--ink-900)",
          }))}
      />
    </ChartCard>
  );
}

import type { WarrantyStatus } from "@wms/domain";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { ChartCard, DonutChart } from "./charts";
import { pct } from "./chart-utils";

// Products by warranty status today, as a donut with each status's share. A segment opens the product list with
// that status (when `linkBase` is given). Status colours as the badges.

const warrantyStatusColor: Record<WarrantyStatus, string> = {
  ACTIVE: "var(--success)",
  EXPIRING_SOON: "var(--brand-500)",
  EXPIRED: "var(--danger)",
  VOID: "var(--ink-400)",
  PENDING: "var(--info)",
};

const ORDER: WarrantyStatus[] = ["ACTIVE", "EXPIRING_SOON", "EXPIRED", "PENDING", "VOID"];

export function WarrantyStatusChart({
  data,
  title,
  linkBase,
}: {
  data: { status: WarrantyStatus; count: number }[];
  title?: string;
  /** e.g. "/units" -> segments open /units?status=ACTIVE. */
  linkBase?: string;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const counts = new Map(data.map((d) => [d.status, d.count]));
  const rows = ORDER.map((status) => ({
    status,
    count: counts.get(status) ?? 0,
    label: t(`status.warranty.${status}`),
  })).filter((r) => r.count > 0 || r.status === "ACTIVE");
  const total = rows.reduce((n, r) => n + r.count, 0);
  const heading = title ?? t("dashboard.warrantyStatus");

  return (
    <ChartCard
      title={heading}
      rows={rows}
      rowKey={(r) => r.status}
      columns={[
        { header: t("claims.columns.status"), cell: (r) => r.label },
        { header: "%", cell: (r) => `${pct(r.count, total)}%`, numeric: true },
        { header: "#", cell: (r) => r.count, numeric: true },
      ]}
    >
      <DonutChart
        ariaLabel={heading}
        centerLabel={t("dashboard.products")}
        data={rows.map((r) => ({
          key: r.status,
          label: r.label,
          value: r.count,
          color: warrantyStatusColor[r.status],
          onSelect: linkBase ? () => navigate(`${linkBase}?status=${r.status}`) : undefined,
        }))}
      />
    </ChartCard>
  );
}

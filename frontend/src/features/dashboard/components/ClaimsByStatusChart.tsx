import type { ClaimStatus } from "@wms/domain";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { ChartCard, DonutChart } from "./charts";
import { pct } from "./chart-utils";

// Claims by status as a donut with each status's share; status colours as the badges. A segment opens the claims
// in that status. Used on A01 and DL01 (scoped by the server).

const claimStatusColor: Record<ClaimStatus, string> = {
  SUBMITTED: "var(--info)",
  IN_REVIEW: "var(--brand-500)",
  APPROVED: "var(--success)",
  REJECTED: "var(--danger)",
  CLOSED: "var(--ink-400)",
};

export function ClaimsByStatusChart({ data }: { data: { status: ClaimStatus; count: number }[] }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const total = data.reduce((n, d) => n + d.count, 0);
  const rows = data.map((d) => ({ ...d, label: t(`status.claim.${d.status}`) }));

  return (
    <ChartCard
      title={t("dashboard.claimsByStatus")}
      rows={rows}
      rowKey={(r) => r.status}
      columns={[
        { header: t("claims.columns.status"), cell: (r) => r.label },
        { header: "%", cell: (r) => `${pct(r.count, total)}%`, numeric: true },
        { header: "#", cell: (r) => r.count, numeric: true },
      ]}
    >
      <DonutChart
        ariaLabel={t("dashboard.claimsByStatus")}
        centerLabel={t("dashboard.claims")}
        data={rows.map((r) => ({
          key: r.status,
          label: r.label,
          value: r.count,
          color: claimStatusColor[r.status],
          onSelect: () => navigate(`/claims?status=${r.status}`),
        }))}
      />
    </ChartCard>
  );
}

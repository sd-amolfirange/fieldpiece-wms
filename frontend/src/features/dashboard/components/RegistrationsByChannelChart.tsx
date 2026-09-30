import type { ChannelCount } from "@wms/domain";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { ChartCard, DonutChart } from "./charts";
import { pct } from "./chart-utils";

// A01 "Registrations by channel": approved registrations per source (bulk uploads count under Dealer), as a donut
// with each channel's share. A segment opens the registrations from that channel. Colours follow each channel's
// badge variant (see status-styles.ts); the "View data" table keeps the count in its last column.

const channelColor: Record<ChannelCount["channel"], string> = {
  DEALER: "var(--brand-500)",
  PORTAL: "var(--info)",
  WEB: "var(--success)",
  EMAIL: "var(--ink-400)",
  ERP: "var(--ink-900)",
  API: "var(--brand-800)",
  RETAIL: "var(--warning)",
  OVERWATCH: "var(--danger)",
  JOBLINK: "var(--ink-600)",
};

export function RegistrationsByChannelChart({ data }: { data: ChannelCount[] }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const total = data.reduce((n, d) => n + d.count, 0);
  const rows = data.map((d) => ({ ...d, label: t(`status.channel.${d.channel}`) }));

  return (
    <ChartCard
      title={t("dashboard.registrationsByChannel")}
      rows={rows}
      rowKey={(r) => r.channel}
      columns={[
        { header: t("dashboard.channel"), cell: (r) => r.label },
        { header: "%", cell: (r) => `${pct(r.count, total)}%`, numeric: true },
        { header: "#", cell: (r) => r.count, numeric: true },
      ]}
    >
      <DonutChart
        ariaLabel={t("dashboard.registrationsByChannel")}
        centerLabel={t("dashboard.registrations")}
        data={rows.map((r) => ({
          key: r.channel,
          label: r.label,
          value: r.count,
          color: channelColor[r.channel],
          onSelect: () => navigate(`/registrations?channel=${r.channel}`),
        }))}
      />
    </ChartCard>
  );
}

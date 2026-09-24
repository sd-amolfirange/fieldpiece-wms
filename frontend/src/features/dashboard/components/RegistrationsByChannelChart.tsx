import type { ChannelCount } from "@wms/domain";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Button, Card } from "@/components/ui";

// A01 "Registrations by channel": approved registrations per source (bulk uploads count under Dealer).
// Same axes, grid and "View data" table as ClaimsByStatusChart.

export function RegistrationsByChannelChart({ data }: { data: ChannelCount[] }) {
  const { t } = useTranslation();
  const [showTable, setShowTable] = useState(false);
  const rows = data.map((d) => ({ ...d, label: t(`status.channel.${d.channel}`) }));

  return (
    <Card
      title={t("dashboard.registrationsByChannel")}
      actions={
        <Button variant="ghost" size="sm" onClick={() => setShowTable((v) => !v)} aria-pressed={showTable}>
          {showTable ? t("dashboard.viewChart") : t("dashboard.viewData")}
        </Button>
      }
    >
      {showTable ? (
        <table className="w-full text-sm">
          <caption className="sr-only">{t("dashboard.registrationsByChannel")}</caption>
          <thead>
            <tr className="text-overline text-ink-600">
              <th scope="col" className="py-2 text-start">
                {t("dashboard.channel")}
              </th>
              <th scope="col" className="py-2 text-end">
                #
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.channel} className="border-t border-ink-100">
                <td className="py-2">{r.label}</td>
                <td className="py-2 text-end font-mono">{r.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="h-72" role="img" aria-label={t("dashboard.registrationsByChannel")}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 8, left: -16 }}>
              <CartesianGrid stroke="var(--ink-200)" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 12, fill: "var(--ink-500)" }}
                stroke="var(--ink-200)"
              />
              <YAxis
                allowDecimals={false}
                tick={{ fontSize: 12, fill: "var(--ink-500)" }}
                stroke="var(--ink-200)"
              />
              <Tooltip cursor={{ fill: "var(--brand-50)" }} />
              <Bar
                dataKey="count"
                name={t("dashboard.registrations")}
                fill="var(--info)"
                radius={[2, 2, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  );
}

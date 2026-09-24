import type { BrandCount } from "@wms/domain";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Button, Card } from "@/components/ui";

// A01 Claims by brand: what is receivable from each manufacturer. Same chart, axes and "View data" table as
// ClaimsByStatusChart; one colour, because brands aren't statuses.

export function ClaimsByBrandChart({ data }: { data: BrandCount[] }) {
  const { t } = useTranslation();
  const [showTable, setShowTable] = useState(false);
  const rows = data.map((d) => ({ ...d, label: d.brandName }));

  return (
    <Card
      title={t("dashboard.claimsByBrand")}
      actions={
        <Button variant="ghost" size="sm" onClick={() => setShowTable((v) => !v)} aria-pressed={showTable}>
          {showTable ? t("dashboard.viewChart") : t("dashboard.viewData")}
        </Button>
      }
    >
      {showTable ? (
        <table className="w-full text-sm">
          <caption className="sr-only">{t("dashboard.claimsByBrand")}</caption>
          <thead>
            <tr className="text-overline text-ink-600">
              <th scope="col" className="py-2 text-start">
                {t("claims.columns.brand")}
              </th>
              <th scope="col" className="py-2 text-end">
                #
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.brandId} className="border-t border-ink-100">
                <td className="py-2">{r.label}</td>
                <td className="py-2 text-end font-mono">{r.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="h-72" role="img" aria-label={t("dashboard.claimsByBrand")}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 8, left: -16 }}>
              <CartesianGrid stroke="var(--ink-200)" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 12, fill: "var(--ink-500)" }}
                stroke="var(--ink-200)"
                interval={0}
                angle={-30}
                textAnchor="end"
                height={60}
              />
              <YAxis
                allowDecimals={false}
                tick={{ fontSize: 12, fill: "var(--ink-500)" }}
                stroke="var(--ink-200)"
              />
              <Tooltip cursor={{ fill: "var(--brand-50)" }} />
              <Bar dataKey="count" radius={[2, 2, 0, 0]}>
                {rows.map((r) => (
                  <Cell key={r.brandId} fill="var(--brand-500)" />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  );
}

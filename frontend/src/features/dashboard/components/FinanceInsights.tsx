import type { FinanceSummary, Resolution } from "@wms/domain";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { ErrorState, Skeleton } from "@/components/feedback";
import { Card, KpiTile, ProductThumb } from "@/components/ui";
import { formatDate, formatMoney } from "@/lib/format";
import { useFinanceSummary } from "../hooks";
import { ChartCard, DonutChart, Gauge, HorizontalBarChart, Meter, TrendChart } from "./charts";
import { pct } from "./chart-utils";

// Finance insights (A01 for the warranty desk, DL01 for dealers and distributors, scoped by the server): the
// warranty cost of the last 12 months against the models' warranty budgets, what extended warranties brought in,
// where the money went (by resolution and category), month by month, and each product's quota use.

const resolutionColor: Record<Resolution, string> = {
  REPAIR: "var(--info)",
  REPLACE: "var(--brand-500)",
  CREDIT: "var(--ink-900)",
};

export function FinanceInsights({
  dealerId,
  showQuotas = true,
}: {
  dealerId?: string;
  showQuotas?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const finance = useFinanceSummary(dealerId);

  if (finance.error) return <ErrorState error={finance.error} onRetry={() => void finance.refetch()} />;
  if (!finance.data)
    return (
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-32" />
        ))}
      </div>
    );
  return <FinanceBody data={finance.data} lang={i18n.language} t={t} showQuotas={showQuotas} />;
}

function FinanceBody({
  data,
  lang,
  t,
  showQuotas,
}: {
  data: FinanceSummary;
  lang: string;
  t: ReturnType<typeof useTranslation>["t"];
  showQuotas: boolean;
}) {
  const money = (n: number) => formatMoney(n, data.currency, lang);
  const compact = (n: number) =>
    new Intl.NumberFormat(lang, { style: "currency", currency: data.currency, notation: "compact" }).format(
      n,
    );
  const costTotal = data.costByResolution.reduce((n, r) => n + r.amount, 0);
  const categoryRows = data.costByCategory.filter((c) => c.amount > 0).sort((a, b) => b.amount - a.amount);
  const period = t("finance.period", {
    from: formatDate(data.periodStart, lang),
    to: formatDate(data.periodEnd, lang),
  });
  const overBudget = data.quotas.filter((q) => q.budgetUsedPct > 100 || q.claimQuotaUsedPct > 100).length;

  return (
    <section aria-labelledby="finance-heading" className="space-y-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="finance-heading" className="text-h2">
          {t("finance.title")}
        </h2>
        <p className="text-sm text-text-muted">{period}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiTile label={t("finance.warrantyCost")} value={money(data.warrantyCost)} />
        <KpiTile label={t("finance.extensionRevenue")} value={money(data.extensionRevenue)} />
        <KpiTile
          label={t("finance.netCost")}
          value={money(data.netWarrantyCost)}
          tone={data.netWarrantyCost > data.budget ? "danger" : "default"}
        />
        <KpiTile label={t("finance.averageClaimCost")} value={money(data.averageClaimCost)} />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card title={t("finance.budgetUse")}>
          <Gauge value={data.budgetUsedPct} label={t("finance.ofBudget", { budget: money(data.budget) })} />
          <dl className="mt-4 grid grid-cols-2 gap-2 text-sm">
            <dt className="text-text-muted">{t("finance.spent")}</dt>
            <dd className="text-end font-mono">{money(data.warrantyCost)}</dd>
            <dt className="text-text-muted">{t("finance.remaining")}</dt>
            <dd className="text-end font-mono">{money(Math.max(0, data.budget - data.warrantyCost))}</dd>
            <dt className="text-text-muted">{t("finance.extensionsSold")}</dt>
            <dd className="text-end font-mono">{data.extensionsSold}</dd>
            <dt className="text-text-muted">{t("finance.creditsIssued")}</dt>
            <dd className="text-end font-mono">{money(data.creditsIssued)}</dd>
          </dl>
        </Card>

        <ChartCard
          className="lg:col-span-2"
          title={t("finance.monthly")}
          subtitle={t("finance.monthlyHint")}
          rows={data.monthly}
          rowKey={(r) => r.month}
          columns={[
            {
              header: t("dashboard.month"),
              cell: (r) =>
                new Date(`${r.month}-01T00:00:00Z`).toLocaleDateString(lang, {
                  month: "short",
                  year: "numeric",
                  timeZone: "UTC",
                }),
            },
            { header: t("finance.warrantyCost"), cell: (r) => money(r.cost), numeric: true },
            { header: t("finance.extensionRevenue"), cell: (r) => money(r.extensionRevenue), numeric: true },
          ]}
        >
          <TrendChart
            data={data.monthly}
            lang={lang}
            ariaLabel={t("finance.monthly")}
            format={compact}
            series={[
              { key: "cost", label: t("finance.warrantyCost"), color: "var(--ink-900)", type: "bar" },
              {
                key: "extensionRevenue",
                label: t("finance.extensionRevenue"),
                color: "var(--brand-500)",
                type: "area",
              },
            ]}
          />
        </ChartCard>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <ChartCard
          title={t("finance.byResolution")}
          rows={data.costByResolution}
          rowKey={(r) => r.resolution}
          columns={[
            { header: t("finance.resolution"), cell: (r) => t(`claims.resolution.${r.resolution}`) },
            { header: t("dashboard.claims"), cell: (r) => r.count, numeric: true },
            { header: "%", cell: (r) => `${pct(r.amount, costTotal)}%`, numeric: true },
            { header: t("finance.amount"), cell: (r) => money(r.amount), numeric: true },
          ]}
        >
          <DonutChart
            ariaLabel={t("finance.byResolution")}
            centerLabel={t("finance.warrantyCost")}
            format={compact}
            data={data.costByResolution.map((r) => ({
              key: r.resolution,
              label: `${t(`claims.resolution.${r.resolution}`)} (${r.count})`,
              value: r.amount,
              color: resolutionColor[r.resolution],
            }))}
          />
        </ChartCard>
        <ChartCard
          title={t("finance.byCategory")}
          rows={categoryRows}
          rowKey={(r) => r.categoryId}
          columns={[
            { header: t("dashboard.category"), cell: (r) => r.categoryName },
            { header: "%", cell: (r) => `${pct(r.amount, costTotal)}%`, numeric: true },
            { header: t("finance.amount"), cell: (r) => money(r.amount), numeric: true },
          ]}
        >
          {categoryRows.length ? (
            <HorizontalBarChart
              ariaLabel={t("finance.byCategory")}
              format={compact}
              data={categoryRows.map((c) => ({
                key: c.categoryId,
                label: c.categoryName,
                value: c.amount,
                color: "var(--brand-500)",
              }))}
            />
          ) : (
            <p className="py-8 text-center text-sm text-text-muted">{t("finance.noCost")}</p>
          )}
        </ChartCard>
      </div>

      {showQuotas ? (
        <Card
          title={t("finance.quotas")}
          actions={
            overBudget ? (
              <span className="text-sm text-danger">{t("finance.overQuota", { count: overBudget })}</span>
            ) : null
          }
        >
          <p className="-mt-2 mb-4 text-sm text-text-muted">{t("finance.quotasHint")}</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">{t("finance.quotas")}</caption>
              <thead>
                <tr className="text-overline text-ink-600">
                  <th scope="col" className="py-2 text-start">
                    {t("finance.model")}
                  </th>
                  <th scope="col" className="py-2 text-end">
                    {t("dashboard.products")}
                  </th>
                  <th scope="col" className="py-2 ps-4 text-start">
                    {t("finance.budgetColumn")}
                  </th>
                  <th scope="col" className="py-2 ps-4 text-start">
                    {t("finance.claimQuotaColumn")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.quotas.map((q) => (
                  <tr key={q.modelId} className="border-t border-ink-100">
                    <td className="py-2">
                      <Link to={`/models/${q.modelId}`} className="flex items-center gap-3 hover:underline">
                        <ProductThumb imageUrl={q.imageUrl} size="sm" />
                        <span className="min-w-0">
                          <span className="block font-semibold">{q.modelCode}</span>
                          <span className="block truncate text-xs text-text-muted">{q.modelName}</span>
                        </span>
                      </Link>
                    </td>
                    <td className="py-2 text-end font-mono">{q.units}</td>
                    <td className="py-2 ps-4">
                      <Meter
                        value={q.budgetUsedPct}
                        label={t("finance.budgetMeter", { model: q.modelCode })}
                      />
                      <span className="text-xs text-text-muted">
                        {money(q.spent)} / {money(q.budget)}
                      </span>
                    </td>
                    <td className="py-2 ps-4">
                      <Meter
                        value={q.claimQuotaUsedPct}
                        label={t("finance.claimMeter", { model: q.modelCode })}
                      />
                      <span className="text-xs text-text-muted">
                        {t("finance.claimsOfQuota", { claims: q.claims, quota: q.claimQuota })}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}
    </section>
  );
}

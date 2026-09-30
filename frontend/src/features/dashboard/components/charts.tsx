import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  LabelList,
  Legend,
  Line,
  Pie,
  PieChart,
  PolarAngleAxis,
  RadialBar,
  RadialBarChart,
  ResponsiveContainer,
  Sector,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Button, Card } from "@/components/ui";
import { cn } from "@/lib/cn";
import { formatNumber } from "@/lib/format";
import { pct, usageColor } from "./chart-utils";

// Dashboard chart kit (Section 8.2): donut, trend (area + line), horizontal bar, gauge and meters, all from the token
// colours, axes and gridlines ink-200, labels text-xs ink-500. Every chart shows shares as a percentage and has a
// "View data" table alternative (Sections 8.7 and 10). Segments and bars can be clicked to open the list behind them.
// Each chart is one labelled image for assistive tech; the SVG inside is hidden (its legend and table say the same).

const AXIS = { fontSize: 12, fill: "var(--ink-500)" };
const TOOLTIP_STYLE = {
  borderRadius: 4,
  border: "1px solid var(--ink-100)",
  background: "var(--surface)",
  color: "var(--text)",
  fontSize: 13,
};

export interface Slice {
  key: string;
  label: string;
  value: number;
  color: string;
  /** List behind the number, opened on click. */
  onSelect?: () => void;
}

// ── Card with the chart / table toggle ─────────────────────────────────────────────────────────────────────────

export interface DataColumn<T> {
  header: string;
  cell: (row: T) => ReactNode;
  numeric?: boolean;
}

export function ChartCard<T>({
  title,
  subtitle,
  rows,
  columns,
  rowKey,
  className,
  children,
}: {
  title: string;
  subtitle?: string;
  rows: T[];
  columns: DataColumn<T>[];
  rowKey: (row: T) => string;
  className?: string;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const [showTable, setShowTable] = useState(false);
  return (
    <Card
      title={title}
      className={className}
      actions={
        <Button variant="ghost" size="sm" onClick={() => setShowTable((v) => !v)} aria-pressed={showTable}>
          {showTable ? t("dashboard.viewChart") : t("dashboard.viewData")}
        </Button>
      }
    >
      {subtitle ? <p className="-mt-2 mb-4 text-sm text-text-muted">{subtitle}</p> : null}
      {showTable ? (
        <table className="w-full text-sm">
          <caption className="sr-only">{title}</caption>
          <thead>
            <tr className="text-overline text-ink-600">
              {columns.map((c) => (
                <th key={c.header} scope="col" className={cn("py-2", c.numeric ? "text-end" : "text-start")}>
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={rowKey(r)} className="border-t border-ink-100">
                {columns.map((c) => (
                  <td key={c.header} className={cn("py-2", c.numeric && "text-end font-mono")}>
                    {c.cell(r)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        children
      )}
    </Card>
  );
}

// ── Donut ──────────────────────────────────────────────────────────────────────────────────────────────────────

/** Donut with the total in the middle and a legend with counts and percentages; hover highlights a segment. */
export function DonutChart({
  data,
  ariaLabel,
  centerLabel,
  format = (n) => String(n),
}: {
  data: Slice[];
  ariaLabel: string;
  centerLabel: string;
  format?: (n: number) => string;
}) {
  const [active, setActive] = useState<number | undefined>(undefined);
  const total = data.reduce((n, d) => n + d.value, 0);
  const shown = data.filter((d) => d.value > 0);
  const focus = active !== undefined ? shown[active] : undefined;

  return (
    <div className="grid items-center gap-4 sm:grid-cols-2">
      <div className="relative h-64" role="img" aria-label={ariaLabel}>
        <div className="h-full w-full" aria-hidden>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={shown.length ? shown : [{ key: "none", label: "", value: 1, color: "var(--ink-100)" }]}
                dataKey="value"
                nameKey="label"
                innerRadius="62%"
                outerRadius="88%"
                paddingAngle={shown.length > 1 ? 2 : 0}
                stroke="none"
                rootTabIndex={-1}
                activeIndex={active}
                activeShape={(props: object) => (
                  <Sector
                    {...(props as Record<string, unknown>)}
                    outerRadius={(props as { outerRadius: number }).outerRadius + 6}
                  />
                )}
                onMouseEnter={(_, i) => setActive(i)}
                onMouseLeave={() => setActive(undefined)}
                onClick={(_, i) => shown[i]?.onSelect?.()}
                isAnimationActive={false}
              >
                {(shown.length ? shown : [{ key: "none", color: "var(--ink-100)" }]).map((d) => (
                  <Cell key={d.key} fill={d.color} className={shown.length ? "cursor-pointer" : undefined} />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="font-mono text-h2 tabular-nums">{format(focus ? focus.value : total)}</span>
          <span className="max-w-[8rem] text-xs text-text-muted">
            {focus ? `${focus.label} · ${pct(focus.value, total)}%` : centerLabel}
          </span>
        </div>
      </div>
      <ul className="space-y-2 text-sm">
        {data.map((d) => {
          const i = shown.indexOf(d);
          const content = (
            <>
              <span className="h-3 w-3 shrink-0 rounded-sm" style={{ background: d.color }} aria-hidden />
              <span className="min-w-0 flex-1">{d.label}</span>
              <span className="font-mono tabular-nums">{format(d.value)}</span>
              <span className="w-10 text-end font-mono tabular-nums text-text-muted">
                {pct(d.value, total)}%
              </span>
            </>
          );
          return (
            <li key={d.key}>
              {d.onSelect ? (
                <button
                  type="button"
                  onClick={d.onSelect}
                  onMouseEnter={() => setActive(i >= 0 ? i : undefined)}
                  onMouseLeave={() => setActive(undefined)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded px-1 py-0.5 text-start hover:bg-brand-50",
                    focus === d && "bg-brand-50",
                  )}
                >
                  {content}
                </button>
              ) : (
                <div className="flex items-center gap-2 px-1 py-0.5">{content}</div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ── Trend (area + line + bar, one or more series over months) ──────────────────────────────────────────────────

export interface Series {
  key: string;
  label: string;
  color: string;
  type: "area" | "line" | "bar";
}

export function TrendChart<T extends { month: string }>({
  data,
  series,
  ariaLabel,
  format = (n) => String(n),
  lang,
}: {
  data: T[];
  series: Series[];
  ariaLabel: string;
  format?: (n: number) => string;
  lang: string;
}) {
  const monthLabel = (m: string) =>
    new Date(`${m}-01T00:00:00Z`).toLocaleDateString(lang, { month: "short", timeZone: "UTC" });
  return (
    <div className="h-72" role="img" aria-label={ariaLabel}>
      <div className="h-full w-full" aria-hidden>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
            <defs>
              {series
                .filter((s) => s.type === "area")
                .map((s) => (
                  <linearGradient key={s.key} id={`fill-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={s.color} stopOpacity={0.45} />
                    <stop offset="100%" stopColor={s.color} stopOpacity={0.04} />
                  </linearGradient>
                ))}
            </defs>
            <CartesianGrid stroke="var(--ink-200)" vertical={false} />
            <XAxis dataKey="month" tickFormatter={monthLabel} tick={AXIS} stroke="var(--ink-200)" />
            <YAxis
              allowDecimals={false}
              tick={AXIS}
              stroke="var(--ink-200)"
              tickFormatter={(v: number) => format(v)}
              width={64}
            />
            <Tooltip
              contentStyle={TOOLTIP_STYLE}
              labelFormatter={(m: string) =>
                new Date(`${m}-01T00:00:00Z`).toLocaleDateString(lang, {
                  month: "long",
                  year: "numeric",
                  timeZone: "UTC",
                })
              }
              formatter={(v: number, name: string) => [format(v), name]}
            />
            <Legend iconType="circle" wrapperStyle={{ fontSize: 12, color: "var(--ink-500)" }} />
            {series.map((s) =>
              s.type === "area" ? (
                <Area
                  key={s.key}
                  type="monotone"
                  dataKey={s.key}
                  name={s.label}
                  stroke={s.color}
                  strokeWidth={2}
                  fill={`url(#fill-${s.key})`}
                  isAnimationActive={false}
                />
              ) : s.type === "line" ? (
                <Line
                  key={s.key}
                  type="monotone"
                  dataKey={s.key}
                  name={s.label}
                  stroke={s.color}
                  strokeWidth={2}
                  dot={{ r: 3 }}
                  activeDot={{ r: 5 }}
                  isAnimationActive={false}
                />
              ) : (
                <Bar
                  key={s.key}
                  dataKey={s.key}
                  name={s.label}
                  fill={s.color}
                  radius={[2, 2, 0, 0]}
                  barSize={18}
                  isAnimationActive={false}
                />
              ),
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ── Horizontal bars with value and share ───────────────────────────────────────────────────────────────────────

export function HorizontalBarChart({
  data,
  ariaLabel,
  format = (n) => String(n),
}: {
  data: Slice[];
  ariaLabel: string;
  format?: (n: number) => string;
}) {
  const total = data.reduce((n, d) => n + d.value, 0);
  const rows = data.map((d) => ({ ...d, share: `${format(d.value)} · ${pct(d.value, total)}%` }));
  return (
    <div style={{ height: Math.max(160, rows.length * 38 + 16) }} role="img" aria-label={ariaLabel}>
      <div className="h-full w-full" aria-hidden>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 96, bottom: 0, left: 8 }}>
            <CartesianGrid stroke="var(--ink-200)" horizontal={false} />
            <XAxis type="number" hide allowDecimals={false} />
            <YAxis type="category" dataKey="label" tick={AXIS} stroke="var(--ink-200)" width={150} />
            <Tooltip
              cursor={{ fill: "var(--brand-50)" }}
              contentStyle={TOOLTIP_STYLE}
              formatter={(v: number) => [`${format(v)} (${pct(v, total)}%)`, ""]}
            />
            <Bar
              dataKey="value"
              radius={[0, 2, 2, 0]}
              barSize={20}
              onClick={(_, i) => rows[i]?.onSelect?.()}
              isAnimationActive={false}
            >
              {rows.map((r) => (
                <Cell key={r.key} fill={r.color} className={r.onSelect ? "cursor-pointer" : undefined} />
              ))}
              <LabelList dataKey="share" position="right" style={{ fontSize: 12, fill: "var(--ink-500)" }} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ── Gauge and meters (quota use) ───────────────────────────────────────────────────────────────────────────────

/** Half-circle gauge of a percentage (capped at 100 in the arc, the label shows the real value). */
export function Gauge({ value, label, sublabel }: { value: number; label: string; sublabel?: string }) {
  const { i18n } = useTranslation();
  return (
    <div className="relative h-48" role="img" aria-label={`${label}: ${value}%`}>
      <div className="h-full w-full" aria-hidden>
        <ResponsiveContainer width="100%" height="100%">
          <RadialBarChart
            data={[{ value: Math.min(value, 100) }]}
            startAngle={180}
            endAngle={0}
            cy="80%"
            innerRadius="95%"
            outerRadius="140%"
            barSize={18}
          >
            <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
            <RadialBar
              dataKey="value"
              background={{ fill: "var(--ink-100)" }}
              cornerRadius={9}
              fill={usageColor(value)}
              isAnimationActive={false}
            />
          </RadialBarChart>
        </ResponsiveContainer>
      </div>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-end pb-2">
        <span className="font-mono text-h1 tabular-nums">{formatNumber(value, i18n.language)}%</span>
        <span className="text-xs text-text-muted">{label}</span>
        {sublabel ? <span className="text-xs text-text-muted">{sublabel}</span> : null}
      </div>
    </div>
  );
}

/** Thin progress bar for a used-share, with the percentage. */
export function Meter({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex items-center gap-2" title={`${label}: ${value}%`}>
      <div
        className="h-2 flex-1 overflow-hidden rounded-sm bg-ink-100"
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.min(value, 100)}
        aria-valuetext={`${value}%`}
      >
        <div
          className="h-full rounded-sm"
          style={{ width: `${Math.min(value, 100)}%`, background: usageColor(value) }}
        />
      </div>
      <span className="w-12 text-end font-mono text-xs tabular-nums">{value}%</span>
    </div>
  );
}

import type { AppChannelStats, FieldpieceAppChannel } from "@wms/domain";
import { ExternalLink, Link2, Radar, type LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Card } from "@/components/ui";
import { env } from "@/lib/env";
import { formatNumber } from "@/lib/format";
import { pct } from "./chart-utils";

// A01 "Fieldpiece apps": warranties registered from Overwatch and Job Link, per app: registered products, their
// warranty status today (stacked bar with shares), new in the last 30 days, registrations waiting for review and
// claims. Links open the filtered lists and the app itself.

const APP: Record<FieldpieceAppChannel, { icon: LucideIcon; url: string }> = {
  OVERWATCH: { icon: Radar, url: env.overwatchUrl },
  JOBLINK: { icon: Link2, url: env.jobLinkUrl },
};

export function FieldpieceAppsCard({ apps }: { apps: AppChannelStats[] }) {
  const { t, i18n } = useTranslation();
  const n = (v: number) => formatNumber(v, i18n.language);

  return (
    <Card title={t("dashboard.apps.title")}>
      <p className="-mt-2 mb-4 text-sm text-text-muted">{t("dashboard.apps.help")}</p>
      <div className="grid gap-6 lg:grid-cols-2">
        {apps.map((a) => {
          const { icon: Icon, url } = APP[a.channel];
          const name = t(`status.channel.${a.channel}`);
          const other = Math.max(0, a.units - a.active - a.expiringSoon - a.expired);
          const segments = [
            { key: "active", value: a.active, color: "var(--success)", label: t("status.warranty.ACTIVE") },
            {
              key: "expiring",
              value: a.expiringSoon,
              color: "var(--brand-500)",
              label: t("status.warranty.EXPIRING_SOON"),
            },
            { key: "expired", value: a.expired, color: "var(--danger)", label: t("status.warranty.EXPIRED") },
            { key: "other", value: other, color: "var(--ink-400)", label: t("dashboard.apps.other") },
          ].filter((s) => s.value > 0);
          return (
            <article key={a.channel} className="rounded border border-border p-4" aria-label={name}>
              <header className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded bg-brand-50" aria-hidden>
                  <Icon size={20} strokeWidth={1.75} />
                </span>
                <h4 className="flex-1 text-h3">{name}</h4>
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-sm underline-offset-2 hover:underline"
                >
                  {t("dashboard.apps.open")}
                  <ExternalLink size={16} strokeWidth={1.75} aria-hidden />
                </a>
              </header>

              <p className="mt-4">
                <span className="font-mono text-h1 tabular-nums">{n(a.units)}</span>{" "}
                <span className="text-sm text-text-muted">{t("dashboard.apps.registered")}</span>
              </p>

              <div
                className="mt-3 flex h-3 overflow-hidden rounded-sm bg-ink-100"
                role="img"
                aria-label={segments.map((s) => `${s.label} ${pct(s.value, a.units)}%`).join(", ")}
              >
                {segments.map((s) => (
                  <div key={s.key} style={{ width: `${pct(s.value, a.units)}%`, background: s.color }} />
                ))}
              </div>
              <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-muted">
                {segments.map((s) => (
                  <li key={s.key} className="inline-flex items-center gap-1">
                    <span className="h-3 w-3 rounded-sm" style={{ background: s.color }} aria-hidden />
                    {s.label} {n(s.value)} · {pct(s.value, a.units)}%
                  </li>
                ))}
              </ul>

              <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
                <div>
                  <dt className="text-overline text-text-muted">{t("dashboard.apps.last30")}</dt>
                  <dd className="font-mono text-h3 tabular-nums">{n(a.last30Days)}</dd>
                </div>
                <div>
                  <dt className="text-overline text-text-muted">{t("dashboard.apps.pending")}</dt>
                  <dd className="font-mono text-h3 tabular-nums">{n(a.pendingRegistrations)}</dd>
                </div>
                <div>
                  <dt className="text-overline text-text-muted">{t("dashboard.apps.claims")}</dt>
                  <dd className="font-mono text-h3 tabular-nums">{n(a.claims)}</dd>
                </div>
              </dl>

              <div className="mt-4 flex flex-wrap gap-4 text-sm">
                <Link to={`/units?channel=${a.channel}`} className="underline-offset-2 hover:underline">
                  {t("dashboard.apps.viewProducts", { app: name })}
                </Link>
                {a.pendingRegistrations ? (
                  <Link
                    to={`/registrations?channel=${a.channel}&status=PENDING`}
                    className="underline-offset-2 hover:underline"
                  >
                    {t("dashboard.apps.review", { count: a.pendingRegistrations })}
                  </Link>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>
    </Card>
  );
}

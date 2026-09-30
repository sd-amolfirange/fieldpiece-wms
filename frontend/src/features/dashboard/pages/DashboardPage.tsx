import { ShieldCheck, Upload } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router-dom";
import { ErrorState, Skeleton } from "@/components/feedback";
import { PageHeader } from "@/components/layout";
import { buttonVariants, KpiTile, NativeSelect, Tabs } from "@/components/ui";
import { useDealers } from "@/features/catalog";
import { can } from "@/lib/permissions";
import { useCurrentUser } from "@/lib/session";
import { ActivityTrendChart } from "../components/ActivityTrendChart";
import { ClaimsByCategoryChart } from "../components/ClaimsByCategoryChart";
import { ClaimsByStatusChart } from "../components/ClaimsByStatusChart";
import { DealerComparisonCard } from "../components/DealerComparisonCard";
import { ExpiringSoonCard } from "../components/ExpiringSoonCard";
import { FieldpieceAppsCard } from "../components/FieldpieceAppsCard";
import { FinanceInsights } from "../components/FinanceInsights";
import { RecentActivityCard } from "../components/RecentActivityCard";
import { RegistrationsByChannelChart } from "../components/RegistrationsByChannelChart";
import { WarrantyStatusChart } from "../components/WarrantyStatusChart";
import type { DashboardSummary } from "../types";
import { useDashboardSummary } from "../hooks";

// Role home: A01 (admin) and DL01 (dealer / distributor). Customers get CU02 My products (app/pages/HomePage).
// The server scopes the numbers to the signed-in account; a distributor can narrow them to one dealer.
// Two views under the KPI tiles: Overview (12-month trend, status donuts, channel and category breakdowns) and
// Finance (warranty cost against budget, extension revenue, per-product quotas). The view is kept in the URL
// (?view=finance), so it can be linked and survives a reload.

interface Tile {
  key: string;
  value: number;
  /** The list behind the number. */
  to?: string;
  /** Last 12 months, for the tile's sparkline. */
  sparkline?: number[];
}

function tiles(summary: DashboardSummary): Tile[] {
  switch (summary.role) {
    case "admin":
      // Products counts every product in the Registered products list, so the status cards always add up to it:
      // active + expiring + expired + awaiting registration + void.
      return [
        {
          key: "units",
          value: summary.units,
          to: "/units",
          sparkline: summary.trend.map((m) => m.registrations),
        },
        { key: "active", value: summary.active, to: "/units?status=ACTIVE" },
        { key: "expiring30", value: summary.expiring30, to: "/units?status=EXPIRING_SOON" },
        { key: "expired", value: summary.expired, to: "/units?status=EXPIRED" },
        ...(summary.pending
          ? [{ key: "awaitingRegistration", value: summary.pending, to: "/units?status=PENDING" }]
          : []),
        ...(summary.voided ? [{ key: "voided", value: summary.voided, to: "/units?status=VOID" }] : []),
        {
          key: "openClaims",
          value: summary.openClaims,
          to: "/claims",
          sparkline: summary.trend.map((m) => m.claims),
        },
        {
          key: "pendingRegistrations",
          value: summary.pendingRegistrations,
          to: "/registrations?status=PENDING",
        },
      ];
    case "customer":
      return [
        { key: "myUnits", value: summary.units },
        { key: "active", value: summary.active },
        { key: "expiringSoon", value: summary.expiringSoon },
        { key: "openClaims", value: summary.openClaims, to: "/claims" },
      ];
    default:
      return [
        {
          key: "registrationsThisMonth",
          value: summary.registrationsThisMonth,
          to: "/units",
          sparkline: summary.trend.map((m) => m.registrations),
        },
        { key: "pending", value: summary.pending },
        { key: "rejected", value: summary.rejected },
        {
          key: "openClaims",
          value: summary.openClaims,
          to: "/claims",
          sparkline: summary.trend.map((m) => m.claims),
        },
      ];
  }
}

export default function DashboardPage() {
  const { t } = useTranslation();
  const user = useCurrentUser();
  const role = user?.role;
  const isDistributor = role === "distributor";
  const [dealerId, setDealerId] = useState("");
  const dealers = useDealers();
  const scopedDealer = isDistributor && dealerId ? dealerId : undefined;
  const summary = useDashboardSummary(scopedDealer);
  const [params, setParams] = useSearchParams();
  const view = params.get("view") === "finance" ? "finance" : "overview";
  const setView = (next: string) =>
    setParams(
      (p) => {
        if (next === "finance") p.set("view", next);
        else p.delete("view");
        return p;
      },
      { replace: true },
    );

  const primaryAction =
    can(role, "registrations:create") && role !== "admin" ? (
      <>
        <Link to="/registrations/bulk" className={buttonVariants({ variant: "secondary" })}>
          <Upload size={20} strokeWidth={1.75} aria-hidden />
          {t("nav.bulkImport")}
        </Link>
        <Link to="/registrations/new" className={buttonVariants()}>
          <ShieldCheck size={20} strokeWidth={1.75} aria-hidden />
          {t("nav.registerUnit")}
        </Link>
      </>
    ) : can(role, "registrations:self") ? (
      <Link to="/register" className={buttonVariants()}>
        <ShieldCheck size={20} strokeWidth={1.75} aria-hidden />
        {t("nav.registerProduct")}
      </Link>
    ) : null;

  // Links keep a distributor's dealer filter, so the list shows the same dealer as the numbers.
  const withDealer = (to: string) =>
    isDistributor && dealerId && to.startsWith("/units")
      ? `${to}${to.includes("?") ? "&" : "?"}dealerId=${dealerId}`
      : to;

  return (
    <>
      <PageHeader
        title={t("dashboard.greeting", { name: user?.orgName ?? user?.name ?? "" })}
        actions={primaryAction}
      />

      {isDistributor ? (
        <div className="mb-6 flex flex-wrap items-center gap-2">
          <label htmlFor="dashboard-dealer" className="text-sm text-text-muted">
            {t("dashboard.showDealer")}
          </label>
          <NativeSelect
            id="dashboard-dealer"
            className="w-full sm:w-48"
            value={dealerId}
            onChange={(e) => setDealerId(e.target.value)}
          >
            <option value="">{t("dashboard.allDealers")}</option>
            {dealers.data?.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </NativeSelect>
        </div>
      ) : null}

      {summary.error ? <ErrorState error={summary.error} onRetry={() => void summary.refetch()} /> : null}

      {summary.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
      ) : summary.data ? (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {tiles(summary.data).map((tile) => {
              const label = t(`dashboard.tiles.${tile.key}`);
              return tile.to ? (
                <Link
                  key={tile.key}
                  to={withDealer(tile.to)}
                  aria-label={t("dashboard.tileLink", { label, count: tile.value })}
                  className="block h-full rounded-lg hover:ring-2 hover:ring-ink-1000"
                >
                  <KpiTile label={label} value={tile.value} sparkline={tile.sparkline} className="h-full" />
                </Link>
              ) : (
                <KpiTile
                  key={tile.key}
                  label={label}
                  value={tile.value}
                  sparkline={tile.sparkline}
                  className="h-full"
                />
              );
            })}
          </div>
          {summary.data.role !== "customer" ? (
            <Tabs
              label={t("dashboard.viewsLabel")}
              value={view}
              onValueChange={setView}
              items={[
                {
                  value: "overview",
                  label: t("dashboard.views.overview"),
                  content: (
                    <div className="space-y-6 pt-6">
                      <Overview summary={summary.data} unitsLink={withDealer("/units")} dealerId={dealerId} />
                    </div>
                  ),
                },
                {
                  value: "finance",
                  label: t("dashboard.views.finance"),
                  content: (
                    <div className="pt-6">
                      <FinanceInsights dealerId={scopedDealer} />
                    </div>
                  ),
                },
              ]}
            />
          ) : null}
        </div>
      ) : null}
    </>
  );
}

/** The Overview tab: the charts for the role (the KPI tiles above are shared by both tabs). */
function Overview({
  summary,
  unitsLink,
  dealerId,
}: {
  summary: DashboardSummary;
  /** Products list, with a distributor's dealer filter. */
  unitsLink: string;
  dealerId: string;
}) {
  const { t } = useTranslation();
  if (summary.role === "customer") return null;
  if (summary.role === "admin") {
    return (
      <>
        <div className="grid gap-6 lg:grid-cols-3">
          <ActivityTrendChart data={summary.trend} className="lg:col-span-2" />
          <WarrantyStatusChart
            linkBase="/units"
            data={[
              { status: "ACTIVE", count: summary.active },
              { status: "EXPIRING_SOON", count: summary.expiring30 },
              { status: "EXPIRED", count: summary.expired },
              { status: "PENDING", count: summary.pending },
              { status: "VOID", count: summary.voided },
            ]}
          />
        </div>
        <FieldpieceAppsCard apps={summary.apps} />
        <div className="grid gap-6 lg:grid-cols-2">
          <RegistrationsByChannelChart data={summary.registrationsByChannel} />
          <ClaimsByStatusChart data={summary.claimsByStatus} />
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          <ClaimsByCategoryChart data={summary.claimsByCategory} />
          <ExpiringSoonCard units={summary.expiringSoon} />
        </div>
        <RecentActivityCard items={summary.recentActivity} />
      </>
    );
  }
  return (
    <>
      <div className="grid gap-6 lg:grid-cols-3">
        <ActivityTrendChart data={summary.trend} className="lg:col-span-2" />
        <WarrantyStatusChart
          title={summary.role === "distributor" ? undefined : t("dashboard.soldByStatus")}
          linkBase={unitsLink}
          data={summary.unitsByStatus}
        />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <ClaimsByStatusChart data={summary.claimsByStatus} />
        {summary.role === "distributor" && !dealerId ? (
          <DealerComparisonCard dealers={summary.dealers} />
        ) : null}
      </div>
    </>
  );
}

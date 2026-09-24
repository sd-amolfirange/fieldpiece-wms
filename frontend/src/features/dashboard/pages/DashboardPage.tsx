import { ShieldCheck, Upload } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { ErrorState, Skeleton } from "@/components/feedback";
import { PageHeader } from "@/components/layout";
import { buttonVariants, KpiTile, NativeSelect } from "@/components/ui";
import { useDealers } from "@/features/catalog";
import { can } from "@/lib/permissions";
import { useCurrentUser } from "@/lib/session";
import { ClaimsByBrandChart } from "../components/ClaimsByBrandChart";
import { DealerComparisonCard } from "../components/DealerComparisonCard";
import { ExpiringSoonCard } from "../components/ExpiringSoonCard";
import { RecentActivityCard } from "../components/RecentActivityCard";
import { RegistrationsByChannelChart } from "../components/RegistrationsByChannelChart";
import type { DashboardSummary } from "../types";
import { useDashboardSummary } from "../hooks";

// Role home: A01 (admin) and DL01 (dealer / distributor). Customers get CU02 My units (app/pages/HomePage).
// The demo server scopes the numbers to the signed-in account; a distributor can narrow them to one dealer.

interface Tile {
  key: string;
  value: number;
  /** The list behind the number. */
  to?: string;
}

function tiles(summary: DashboardSummary): Tile[] {
  switch (summary.role) {
    case "admin":
      // Units counts every unit in the Units list, so the status cards always add up to it:
      // active + expiring + expired + awaiting registration + void.
      return [
        { key: "units", value: summary.units, to: "/units" },
        { key: "active", value: summary.active, to: "/units?status=ACTIVE" },
        { key: "expiring30", value: summary.expiring30, to: "/units?status=EXPIRING_SOON" },
        { key: "expired", value: summary.expired, to: "/units?status=EXPIRED" },
        ...(summary.pending
          ? [{ key: "awaitingRegistration", value: summary.pending, to: "/units?status=PENDING" }]
          : []),
        ...(summary.voided ? [{ key: "voided", value: summary.voided, to: "/units?status=VOID" }] : []),
        { key: "openClaims", value: summary.openClaims, to: "/claims" },
      ];
    case "customer":
      return [
        { key: "myUnits", value: summary.units },
        { key: "active", value: summary.active },
        { key: "expiringSoon", value: summary.expiringSoon },
        { key: "openComplaints", value: summary.openComplaints },
      ];
    default:
      return [
        { key: "registrationsThisMonth", value: summary.registrationsThisMonth, to: "/units" },
        { key: "pending", value: summary.pending },
        { key: "rejected", value: summary.rejected },
        { key: "openComplaints", value: summary.openComplaints, to: "/complaints" },
        { key: "claimsInProgress", value: summary.claimsInProgress, to: "/complaints" },
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
  const summary = useDashboardSummary(isDistributor && dealerId ? dealerId : undefined);

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
                  className="block rounded-lg hover:ring-2 hover:ring-ink-1000"
                >
                  <KpiTile label={label} value={tile.value} />
                </Link>
              ) : (
                <KpiTile key={tile.key} label={label} value={tile.value} />
              );
            })}
          </div>
          {summary.data.role === "admin" ? (
            <>
              <div className="grid gap-6 lg:grid-cols-2">
                <RegistrationsByChannelChart data={summary.data.registrationsByChannel} />
                <ClaimsByBrandChart data={summary.data.claimsByBrand} />
              </div>
              <div className="grid gap-6 lg:grid-cols-2">
                <ExpiringSoonCard units={summary.data.expiringSoon} />
                <RecentActivityCard items={summary.data.recentActivity} />
              </div>
            </>
          ) : null}
          {summary.data.role === "distributor" && !dealerId ? (
            <DealerComparisonCard dealers={summary.data.dealers} />
          ) : null}
        </div>
      ) : null}
    </>
  );
}

import { ShieldCheck, Upload } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { ErrorState, Skeleton } from "@/components/feedback";
import { PageHeader } from "@/components/layout";
import { buttonVariants, KpiTile } from "@/components/ui";
import { can } from "@/lib/permissions";
import { useCurrentUser } from "@/lib/session";
import { RegistrationsByChannelChart } from "../components/RegistrationsByChannelChart";
import type { DashboardSummary } from "../types";
import { useDashboardSummary } from "../hooks";

// Role home: A01 (admin) and DL01 (dealer / distributor). Customers get CU02 My units (app/pages/HomePage).
// The demo server scopes the numbers to the signed-in account.

function tiles(summary: DashboardSummary): { key: string; value: number }[] {
  switch (summary.role) {
    case "admin":
      // Units counts every unit in the Units list, so the status cards always add up to it:
      // active + expiring + expired + awaiting registration + void.
      return [
        { key: "units", value: summary.units },
        { key: "active", value: summary.active },
        { key: "expiring30", value: summary.expiring30 },
        { key: "expired", value: summary.expired },
        ...(summary.pending ? [{ key: "awaitingRegistration", value: summary.pending }] : []),
        ...(summary.voided ? [{ key: "voided", value: summary.voided }] : []),
        { key: "openClaims", value: summary.openClaims },
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
        { key: "registrationsThisMonth", value: summary.registrationsThisMonth },
        { key: "pending", value: summary.pending },
        { key: "rejected", value: summary.rejected },
        { key: "openComplaints", value: summary.openComplaints },
        { key: "claimsInProgress", value: summary.claimsInProgress },
      ];
  }
}

export default function DashboardPage() {
  const { t } = useTranslation();
  const user = useCurrentUser();
  const role = user?.role;
  const summary = useDashboardSummary();

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

  return (
    <>
      <PageHeader
        title={t("dashboard.greeting", { name: user?.orgName ?? user?.name ?? "" })}
        actions={primaryAction}
      />

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
            {tiles(summary.data).map((tile) => (
              <KpiTile key={tile.key} label={t(`dashboard.tiles.${tile.key}`)} value={tile.value} />
            ))}
          </div>
          {summary.data.role === "admin" ? (
            <RegistrationsByChannelChart data={summary.data.registrationsByChannel} />
          ) : null}
        </div>
      ) : null}
    </>
  );
}

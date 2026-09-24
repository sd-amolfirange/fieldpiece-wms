import { useQuery } from "@tanstack/react-query";
import type { Paginated, RegistrationView } from "@wms/domain";
import { Boxes, Package, ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { EmptyState, ErrorState, Skeleton } from "@/components/feedback";
import { PageHeader } from "@/components/layout";
import { buttonVariants, Card, MonoId, RegistrationStatusBadge, WarrantyStatusBadge } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { http } from "@/lib/http";
import { LIVE_REFRESH_MS } from "@/lib/query-client";
import { useCurrentUser } from "@/lib/session";
import { useUnits } from "../hooks";
import { stillCoveredLine, unitStatusLine } from "../status-line";

// CU02 My units (customer home, phone layout): one card per unit with its overall status and a countdown,
// plus self-registrations still waiting for approval.

export default function MyUnitsPage() {
  const { t, i18n } = useTranslation();
  const user = useCurrentUser();
  const units = useUnits({ pageSize: 100, sort: "serial" });
  const pending = useQuery({
    queryKey: ["registrations", { mine: true, status: "PENDING" }],
    queryFn: () =>
      http
        .get<Paginated<RegistrationView>>("/registrations", { params: { status: "PENDING", pageSize: 50 } })
        .then((r) => r.data),
    refetchInterval: LIVE_REFRESH_MS,
  });

  return (
    <div className="mx-auto max-w-xl">
      <PageHeader
        title={t("dashboard.greeting", { name: user?.name ?? "" })}
        actions={
          <Link to="/register" className={buttonVariants()}>
            <ShieldCheck size={20} strokeWidth={1.75} aria-hidden />
            {t("nav.registerProduct")}
          </Link>
        }
      />
      <h2 className="mb-4 text-h3">{t("nav.myUnits")}</h2>

      {units.error ? <ErrorState error={units.error} onRetry={() => void units.refetch()} /> : null}

      {units.isLoading ? (
        <div className="space-y-4">
          {Array.from({ length: 2 }, (_, i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
      ) : (
        <ul className="space-y-4">
          {pending.data?.items.map((r) => (
            <li key={r.id}>
              <Card as="article" className="flex gap-4">
                <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded bg-ink-50">
                  <Package size={24} strokeWidth={1.75} className="text-ink-400" aria-hidden />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="text-h3">{r.modelCode}</h3>
                  <MonoId>{r.serial}</MonoId>
                  <div className="mt-2">
                    <RegistrationStatusBadge status="PENDING" />
                  </div>
                  <p className="mt-1 text-sm text-text-muted">
                    {t("myUnits.pendingLine", { date: formatDate(r.submittedAt, i18n.language) })}
                  </p>
                </div>
              </Card>
            </li>
          ))}
          {units.data?.items.map((unit) => {
            const covered = stillCoveredLine(unit, t, i18n.language);
            return (
              <li key={unit.serial}>
                <Link
                  to={`/units/${unit.serial}`}
                  aria-label={`${unit.modelName} ${unit.serial}: ${unitStatusLine(unit, t, i18n.language)}`}
                  className="block rounded-lg hover:ring-2 hover:ring-ink-1000"
                >
                  <Card as="article" className="flex gap-4">
                    <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded bg-ink-50">
                      <Package size={24} strokeWidth={1.75} className="text-ink-400" aria-hidden />
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="text-h3">{unit.modelName}</h3>
                      <MonoId>{unit.serial}</MonoId>
                      {unit.location ? <p className="text-sm text-text-muted">{unit.location}</p> : null}
                      <div className="mt-2">
                        <WarrantyStatusBadge status={unit.status} />
                      </div>
                      <p className="mt-1 text-sm">{unitStatusLine(unit, t, i18n.language)}</p>
                      {covered ? <p className="text-sm font-semibold text-success">{covered}</p> : null}
                    </div>
                  </Card>
                </Link>
              </li>
            );
          })}
          {!units.data?.items.length && !pending.data?.items.length ? (
            <li>
              <Card>
                <EmptyState icon={Boxes} message={t("myUnits.empty")} />
              </Card>
            </li>
          ) : null}
        </ul>
      )}
    </div>
  );
}

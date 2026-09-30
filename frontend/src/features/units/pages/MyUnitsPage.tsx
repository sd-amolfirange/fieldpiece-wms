import type { UnitView, WarrantyStatus } from "@wms/domain";
import { Boxes, CalendarPlus, ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { EmptyState, ErrorState, Skeleton } from "@/components/feedback";
import { PageHeader } from "@/components/layout";
import {
  buttonVariants,
  Card,
  MonoId,
  ProductThumb,
  RegistrationStatusBadge,
  WarrantyStatusBadge,
} from "@/components/ui";
import { Meter, WarrantyStatusChart } from "@/features/dashboard";
import { formatDate } from "@/lib/format";
import { useCurrentUser } from "@/lib/session";
import { useMyPendingRegistrations, useUnits } from "../hooks";
import { unitStatusLine } from "../status-line";

// CU02 My products (customer home, phone layout): a coverage overview (products by warranty status, with shares),
// then one card per product with its warranty status, a countdown and how much of the warranty has run, plus
// self-registrations still waiting for approval. Products ending soon point to the extended warranty.

/** Share of the warranty period already used, 0-100 (running warranties only). */
function warrantyUsed(unit: UnitView): number | undefined {
  if (!unit.warrantyStart || !unit.warrantyEnd) return undefined;
  if (unit.status !== "ACTIVE" && unit.status !== "EXPIRING_SOON") return undefined;
  const total = (Date.parse(unit.warrantyEnd) - Date.parse(unit.warrantyStart)) / 86_400_000 + 1;
  return total > 0
    ? Math.min(100, Math.max(0, Math.round(((total - unit.daysRemaining) / total) * 100)))
    : undefined;
}

function UsedMeter({ unit, label }: { unit: UnitView; label: string }) {
  const used = warrantyUsed(unit);
  return used === undefined ? null : (
    <div className="mt-2">
      <Meter value={used} label={label} />
    </div>
  );
}

export default function MyUnitsPage() {
  const { t, i18n } = useTranslation();
  const user = useCurrentUser();
  const units = useUnits({ pageSize: 100, sort: "serial" });
  const pending = useMyPendingRegistrations();

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
      {units.data?.items.length ? (
        <div className="mb-6">
          <WarrantyStatusChart
            title={t("myUnits.overview")}
            data={Object.entries(
              units.data.items.reduce<Record<string, number>>((acc, u) => {
                acc[u.status] = (acc[u.status] ?? 0) + 1;
                return acc;
              }, {}),
            ).map(([status, count]) => ({ status: status as WarrantyStatus, count }))}
          />
        </div>
      ) : null}
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
                <ProductThumb imageUrl={r.modelImageUrl} />
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
          {units.data?.items.map((unit) => (
            <li key={unit.serial}>
              <Link
                to={`/units/${unit.serial}`}
                aria-label={`${unit.modelName} ${unit.serial}: ${unitStatusLine(unit, t, i18n.language)}`}
                className="block rounded-lg hover:ring-2 hover:ring-ink-1000"
              >
                <Card as="article" className="flex gap-4">
                  <ProductThumb imageUrl={unit.modelImageUrl} />
                  <div className="min-w-0 flex-1">
                    <h3 className="text-h3">{unit.modelName}</h3>
                    <MonoId>{unit.serial}</MonoId>
                    {unit.batchNumber ? (
                      <p className="text-sm text-text-muted">
                        {t("units.batchLine", { batch: unit.batchNumber })}
                      </p>
                    ) : null}
                    <div className="mt-2">
                      <WarrantyStatusBadge status={unit.status} />
                    </div>
                    <p className="mt-1 text-sm">{unitStatusLine(unit, t, i18n.language)}</p>
                    <UsedMeter unit={unit} label={t("myUnits.warrantyUsed")} />
                    {unit.status === "EXPIRING_SOON" ? (
                      <p className="mt-2 inline-flex items-center gap-1 text-sm font-semibold">
                        <CalendarPlus size={16} strokeWidth={1.75} aria-hidden />
                        {t("myUnits.extendHint")}
                      </p>
                    ) : null}
                  </div>
                </Card>
              </Link>
            </li>
          ))}
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

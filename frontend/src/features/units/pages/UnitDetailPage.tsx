import { Wrench } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router-dom";
import { EmptyState, ErrorState, Skeleton } from "@/components/feedback";
import { PageHeader } from "@/components/layout";
import { Card, MonoId, Tabs, WarrantyStatusBadge } from "@/components/ui";
import { toApiError } from "@/lib/api-error";
import { can } from "@/lib/permissions";
import { useCurrentRole } from "@/lib/session";
import { PartWarrantyTable } from "../components/PartWarrantyTable";
import { CertificateButton, QrLabelCard, UnitFactsCard, UnitHistory } from "../components/UnitCards";
import { useUnit } from "../hooks";
import { stillCoveredLine, unitStatusLine } from "../status-line";

// A05 (admin), DL05 (dealer / distributor, read-only) and CU03 (customer, phone layout).

export default function UnitDetailPage() {
  const { serial } = useParams<{ serial: string }>();
  const { t, i18n } = useTranslation();
  const role = useCurrentRole();
  const query = useUnit(serial);

  if (query.isLoading) {
    return (
      <div className="space-y-4" aria-busy="true">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (query.error || !query.data) {
    const notFound = toApiError(query.error).status === 404;
    return (
      <ErrorState
        message={notFound ? toApiError(query.error).message : undefined}
        error={query.error}
        onRetry={notFound ? undefined : () => void query.refetch()}
      />
    );
  }

  const unit = query.data;
  const isCustomer = role === "customer";
  const listCrumb =
    role === "admin"
      ? { label: t("units.title"), to: "/units" }
      : isCustomer
        ? { label: t("nav.myUnits"), to: "/" }
        : { label: t("units.mySoldUnits"), to: "/units" };
  const stillCovered = stillCoveredLine(unit, t, i18n.language);

  const header = (
    <PageHeader
      breadcrumbs={[listCrumb, { label: unit.serial }]}
      title={<MonoId className="text-h1">{unit.serial}</MonoId>}
      meta={
        <>
          <WarrantyStatusBadge status={unit.status} />
          <span className="text-sm text-text-muted">
            {unit.modelName} · {unitStatusLine(unit, t, i18n.language)}
          </span>
          {stillCovered ? <span className="text-sm font-semibold text-success">{stillCovered}</span> : null}
        </>
      }
      actions={<CertificateButton unit={unit} variant={isCustomer ? "primary" : "secondary"} />}
    />
  );

  const voided = unit.void ? (
    <p role="alert" className="mb-6 rounded border-s-4 border-danger bg-danger-bg p-4 text-body">
      {t("units.voidNotice", { reason: t(`units.voidReason.${unit.void.reason}`) })}
      {unit.void.note ? ` ${unit.void.note}` : ""}
    </p>
  ) : null;

  const tabs = (
    <Tabs
      label={t("units.tabsLabel")}
      items={[
        {
          value: "parts",
          label: t("units.tabs.parts"),
          content: unit.parts.length ? (
            <PartWarrantyTable parts={unit.parts} />
          ) : (
            <EmptyState icon={Wrench} message={t("units.notRegisteredLong")} />
          ),
        },
        { value: "history", label: t("units.tabs.history"), content: <UnitHistory unit={unit} /> },
      ]}
    />
  );

  if (isCustomer) {
    return (
      <div className="mx-auto max-w-xl">
        {header}
        {voided}
        <div className="space-y-6">
          <Card>{tabs}</Card>
          <UnitFactsCard unit={unit} showOwner={false} />
        </div>
      </div>
    );
  }

  return (
    <>
      {header}
      {voided}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">{tabs}</Card>
        <div className="space-y-6">
          <UnitFactsCard unit={unit} />
          {can(role, "units:qr_label") ? <QrLabelCard unit={unit} /> : null}
        </div>
      </div>
    </>
  );
}

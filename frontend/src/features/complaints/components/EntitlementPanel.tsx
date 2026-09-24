import type { Entitlement } from "@wms/domain";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Card, CoverageBadge } from "@/components/ui";

// Entitlement panel (plan 3.2): what the warranty pays for on this job, decided by the WMS before the visit.
// The same panel is shown to the customer (CU04), the dealer (DL06) and the admin (A08).

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-overline text-text-muted">{label}</dt>
      <dd className="mt-1 space-y-1 text-body">{children}</dd>
    </div>
  );
}

export function EntitlementPanel({ entitlement, title }: { entitlement: Entitlement; title?: string }) {
  const { t } = useTranslation();
  const coveredParts = entitlement.coveredPartTypes.map((p) => t(`parts.type.${p}`)).join(", ");

  return (
    <Card title={title ?? t("entitlement.title")}>
      <div className="space-y-4">
        {entitlement.reason === "VOID" ? (
          <p className="rounded border-s-4 border-danger bg-danger-bg p-4 text-body">
            {t("entitlement.void")}
          </p>
        ) : null}
        <dl className="grid gap-4 sm:grid-cols-2">
          <Row label={t("entitlement.parts")}>
            <CoverageBadge status={entitlement.parts} />
            <p className="text-sm text-text-muted">
              {entitlement.parts === "COVERED"
                ? t("entitlement.partsCovered", { parts: coveredParts })
                : t("entitlement.partsChargeable")}
            </p>
          </Row>
          <Row label={t("entitlement.labour")}>
            <CoverageBadge status={entitlement.labour} />
            <p className="text-sm text-text-muted">
              {entitlement.labour === "COVERED"
                ? t("entitlement.labourCovered")
                : t("entitlement.labourChargeable")}
            </p>
          </Row>
        </dl>
        <p className="rounded bg-info-bg p-3 text-sm text-info">
          {entitlement.claimable ? t("entitlement.claimable") : t("entitlement.notClaimable")}
        </p>
      </div>
    </Card>
  );
}

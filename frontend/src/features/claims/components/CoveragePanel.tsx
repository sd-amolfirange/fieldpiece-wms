import type { Coverage } from "@wms/domain";
import { useTranslation } from "react-i18next";
import { Card } from "@/components/ui";
import { formatDate } from "@/lib/format";

// Coverage check before a claim is filed (and on the claim for the warranty desk): is the product in warranty?
// The server makes the same check when the claim is submitted.

export function CoveragePanel({ coverage, title }: { coverage: Coverage; title?: string }) {
  const { t, i18n } = useTranslation();
  const date = formatDate(coverage.warrantyEnd, i18n.language);
  return (
    <Card title={title ?? t("coverage.title")}>
      {coverage.covered ? (
        <p className="rounded bg-success-bg p-3 text-sm text-success">{t("coverage.covered", { date })}</p>
      ) : (
        <p className="rounded border-s-4 border-danger bg-danger-bg p-4 text-body">
          {t(`coverage.${coverage.reason}`, { date })}
        </p>
      )}
      <p className="mt-2 text-sm text-text-muted">{t("coverage.terms")}</p>
    </Card>
  );
}

import { DEFAULT_BATCH_PATTERN, DEFAULT_SERIAL_PATTERN } from "@wms/domain";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";
import { ErrorState, Skeleton } from "@/components/feedback";
import { PageHeader } from "@/components/layout";
import { Card, MonoId, ProductThumb } from "@/components/ui";
import { useModels } from "@/features/catalog";

// A06 product detail: the model's warranty terms and the serial / batch label format every registration of it
// is checked against.

function Field({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <dt className="text-overline text-text-muted">{label}</dt>
      <dd className="mt-1 text-body">{children}</dd>
    </div>
  );
}

export default function ProductDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { t } = useTranslation();
  const query = useModels();
  const model = query.data?.find((m) => m.id === id);

  if (query.isLoading) return <Skeleton className="h-64 w-full" />;
  if (query.error || !model) {
    return <ErrorState error={query.error} message={query.error ? undefined : t("models.notFound")} />;
  }

  const defaultSerial = model.serialPattern === DEFAULT_SERIAL_PATTERN;
  const defaultBatch = model.batchPattern === DEFAULT_BATCH_PATTERN;

  return (
    <>
      <PageHeader
        title={model.name}
        breadcrumbs={[{ label: t("models.title"), to: "/models" }, { label: model.code }]}
        meta={
          <>
            <MonoId>{model.code}</MonoId>
            <span className="text-sm text-text-muted">{model.categoryName}</span>
          </>
        }
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <ProductThumb imageUrl={model.imageUrl} size="lg" />
          </Card>
          <Card title={t("models.warranty")}>
            <dl className="grid gap-4 sm:grid-cols-2">
              <Field label={t("models.term")}>
                {t("models.warrantyMonths", { count: model.warrantyMonths })}
              </Field>
              <Field label={t("models.starts")}>{t("models.startsValue")}</Field>
              <Field label={t("models.covers")} className="sm:col-span-2">
                {t("units.covers")}
              </Field>
            </dl>
          </Card>
          <Card title={t("models.labelFormat")}>
            <p className="mb-4 text-sm text-text-muted">{t("models.labelFormatHelp")}</p>
            <dl className="grid gap-4 sm:grid-cols-2">
              <Field label={t("models.serialFormat")}>
                {defaultSerial ? t("models.serialDefault") : <MonoId>{model.serialPattern}</MonoId>}
              </Field>
              <Field label={t("models.batchFormat")}>
                {defaultBatch ? t("models.batchDefault") : <MonoId>{model.batchPattern}</MonoId>}
              </Field>
            </dl>
          </Card>
        </div>
        <Card title={t("models.details")}>
          <dl className="grid gap-4">
            <Field label={t("models.code")}>
              <MonoId>{model.code}</MonoId>
            </Field>
            <Field label={t("units.fields.category")}>{model.categoryName}</Field>
            <Field label={t("models.description")}>{model.description}</Field>
            <Field label={t("models.products")}>
              <Link
                to={`/units?q=${encodeURIComponent(model.code)}`}
                className="underline-offset-2 hover:underline"
              >
                {t("models.viewProducts")}
              </Link>
            </Field>
          </dl>
        </Card>
      </div>
    </>
  );
}

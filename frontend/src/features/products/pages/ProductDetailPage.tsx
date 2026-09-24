import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router-dom";
import { ErrorState, Skeleton } from "@/components/feedback";
import { PageHeader } from "@/components/layout";
import { Card, MonoId } from "@/components/ui";
import { ModelTemplateTable } from "@/features/units";
import { useModels } from "@/features/catalog";

// A06 model template: parts, warranty months and parts / labour coverage, set once and applied to every unit.

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
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

  return (
    <>
      <PageHeader
        title={model.name}
        breadcrumbs={[{ label: t("models.title"), to: "/models" }, { label: model.code }]}
        meta={<MonoId>{model.code}</MonoId>}
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title={t("models.template")} className="lg:col-span-2">
          <p className="mb-4 text-sm text-text-muted">{t("models.templateHelp")}</p>
          <ModelTemplateTable parts={model.parts} />
        </Card>
        <Card title={t("models.details")}>
          <dl className="grid gap-4 sm:grid-cols-2">
            <Field label={t("units.fields.brand")}>{model.brandName}</Field>
            <Field label={t("units.fields.capacity")}>{model.capacity}</Field>
            <Field label={t("models.type")}>{model.type}</Field>
            <Field label={t("models.code")}>
              <MonoId>{model.code}</MonoId>
            </Field>
          </dl>
        </Card>
      </div>
    </>
  );
}

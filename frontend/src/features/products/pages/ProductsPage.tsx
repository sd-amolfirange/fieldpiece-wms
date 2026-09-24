import { Package } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { EmptyState, ErrorState, Skeleton } from "@/components/feedback";
import { PageHeader } from "@/components/layout";
import { Card, MonoId } from "@/components/ui";
import { useModels } from "@/features/catalog";

// A06 Models & parts: models grouped by brand. Each model is a template whose parts and warranty periods are
// attached to every unit registered with it.

export default function ProductsPage() {
  const { t } = useTranslation();
  const query = useModels();
  const brands = [...new Set(query.data?.map((m) => m.brandName))].sort();

  return (
    <>
      <PageHeader
        title={t("models.title")}
        breadcrumbs={[{ label: t("nav.dashboard"), to: "/" }, { label: t("models.title") }]}
      />
      {query.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-40" />
          ))}
        </div>
      ) : query.error ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : !query.data?.length ? (
        <EmptyState icon={Package} message={t("models.empty")} />
      ) : (
        <div className="space-y-6">
          {brands.map((brand) => (
            <section key={brand} aria-labelledby={`brand-${brand}`}>
              <h2 id={`brand-${brand}`} className="mb-4 text-h3">
                {brand}
              </h2>
              <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {query.data
                  .filter((m) => m.brandName === brand)
                  .map((m) => (
                    <li key={m.id}>
                      <Link
                        to={`/models/${m.id}`}
                        aria-label={`${m.name} (${m.code})`}
                        className="block rounded-lg hover:ring-2 hover:ring-ink-1000"
                      >
                        <Card as="article" className="flex gap-4">
                          {/* Square frame with ink-50 background (Section 3.5) */}
                          <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded bg-ink-50">
                            <Package size={24} strokeWidth={1.75} className="text-ink-400" aria-hidden />
                          </div>
                          <div>
                            <h3 className="text-h3">{m.name}</h3>
                            <MonoId>{m.code}</MonoId>
                            <p className="mt-1 text-sm text-text-muted">
                              {m.capacity} · {m.type} · {t("models.partCount", { count: m.parts.length })}
                            </p>
                          </div>
                        </Card>
                      </Link>
                    </li>
                  ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </>
  );
}

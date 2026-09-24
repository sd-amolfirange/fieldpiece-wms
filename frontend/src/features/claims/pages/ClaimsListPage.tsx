import { createColumnHelper } from "@tanstack/react-table";
import { CLAIM_STATUSES, type ClaimStatus, type ClaimView } from "@wms/domain";
import { ClipboardList, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { PageHeader } from "@/components/layout";
import {
  ClaimStatusBadge,
  DataTable,
  FinancePostingBadge,
  Input,
  KpiTile,
  MonoId,
  NativeSelect,
} from "@/components/ui";
import { useBrands } from "@/features/catalog";
import { formatDateTime, formatMoney } from "@/lib/format";
import { useCurrentUser } from "@/lib/session";
import { useTableParams } from "@/lib/use-table-params";
import { useClaimCounts, useClaims } from "../hooks";

// A09 Claims: every manufacturer claim by brand and status, with Submitted / Approved / Paid / Rejected counts.
// Each count opens the list filtered to that status.

const COUNT_TILES: ClaimStatus[] = ["DRAFT", "SUBMITTED", "APPROVED", "PAID", "REJECTED"];
const col = createColumnHelper<ClaimView>();

export default function ClaimsListPage() {
  const { t, i18n } = useTranslation();
  const currency = useCurrentUser()?.currency ?? "INR";
  const [params, update] = useTableParams({ sort: "-createdAt" });
  const [search, setSearch] = useState(params.q ?? "");
  const status = params.filters.status as ClaimStatus | undefined;
  const brandId = params.filters.brandId;
  const brands = useBrands();
  const counts = useClaimCounts();
  const query = useClaims({
    page: params.page,
    pageSize: params.pageSize,
    sort: params.sort,
    q: params.q,
    status,
    brandId,
  });

  const columns = useMemo(
    () => [
      col.accessor("id", {
        header: t("claims.columns.id"),
        cell: (i) => (
          <Link to={`/claims/${i.getValue()}`} className="underline-offset-2 hover:underline">
            <MonoId>{i.getValue()}</MonoId>
          </Link>
        ),
      }),
      col.accessor("createdAt", {
        header: t("claims.columns.created"),
        cell: (i) => formatDateTime(i.getValue(), i18n.language),
      }),
      col.accessor("brandName", { header: t("claims.columns.brand"), enableSorting: false }),
      col.accessor("unitSerial", {
        header: t("claims.columns.unit"),
        cell: (i) => <MonoId>{i.getValue()}</MonoId>,
      }),
      col.accessor("dealerName", {
        header: t("claims.columns.dealer"),
        enableSorting: false,
        cell: (i) => i.getValue() ?? "—",
      }),
      col.accessor("rmaNumber", {
        header: t("claims.columns.rma"),
        cell: (i) => (i.getValue() ? <MonoId>{i.getValue()}</MonoId> : "—"),
      }),
      col.accessor("amount", {
        header: t("claims.columns.amount"),
        cell: (i) => {
          const amount = i.getValue();
          return amount ? (
            <span className="tabular-nums">{formatMoney(amount, currency, i18n.language)}</span>
          ) : (
            "—"
          );
        },
      }),
      col.accessor("status", {
        header: t("claims.columns.status"),
        cell: (i) => <ClaimStatusBadge status={i.getValue()} />,
      }),
      col.accessor("financePosting", {
        header: t("claims.columns.finance"),
        enableSorting: false,
        cell: (i) => <FinancePostingBadge status={i.getValue()} />,
      }),
    ],
    [t, i18n.language, currency],
  );

  return (
    <>
      <PageHeader
        title={t("claims.title")}
        breadcrumbs={[{ label: t("nav.dashboard"), to: "/" }, { label: t("claims.title") }]}
      />
      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {COUNT_TILES.map((s) => (
            <Link
              key={s}
              to={`/claims?status=${s}`}
              aria-label={t("claims.countLink", {
                status: t(`status.claim.${s}`),
                count: counts.data?.[s] ?? 0,
              })}
              className="block rounded-lg hover:ring-2 hover:ring-ink-1000"
            >
              <KpiTile label={t(`status.claim.${s}`)} value={counts.data?.[s] ?? "—"} />
            </Link>
          ))}
        </div>
        <DataTable
          caption={t("claims.title")}
          columns={columns}
          data={query.data?.items}
          total={query.data?.total ?? 0}
          page={params.page}
          pageSize={params.pageSize}
          sort={params.sort}
          onSortChange={(sort) => update({ sort })}
          onPageChange={(page) => update({ page })}
          getRowId={(row) => row.id}
          isLoading={query.isLoading}
          error={query.error}
          onRetry={() => void query.refetch()}
          emptyIcon={ClipboardList}
          emptyMessage={t("claims.empty")}
          toolbar={
            <>
              <form
                role="search"
                className="relative w-full sm:w-72"
                onSubmit={(e) => {
                  e.preventDefault();
                  update({ q: search.trim() });
                }}
              >
                <label htmlFor="claims-search" className="sr-only">
                  {t("claims.searchPlaceholder")}
                </label>
                <Search
                  size={16}
                  strokeWidth={1.75}
                  aria-hidden
                  className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-ink-500"
                />
                <Input
                  id="claims-search"
                  type="search"
                  className="ps-9"
                  placeholder={t("claims.searchPlaceholder")}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </form>
              <label htmlFor="claims-brand" className="sr-only">
                {t("claims.filterBrand")}
              </label>
              <NativeSelect
                id="claims-brand"
                className="w-full sm:w-48"
                value={brandId ?? ""}
                onChange={(e) => update({ brandId: e.target.value })}
              >
                <option value="">{t("claims.allBrands")}</option>
                {brands.data?.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </NativeSelect>
              <label htmlFor="claims-status" className="sr-only">
                {t("claims.filterStatus")}
              </label>
              <NativeSelect
                id="claims-status"
                className="w-full sm:w-48"
                value={status ?? ""}
                onChange={(e) => update({ status: e.target.value })}
              >
                <option value="">{t("claims.allStatuses")}</option>
                {CLAIM_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {t(`status.claim.${s}`)}
                  </option>
                ))}
              </NativeSelect>
            </>
          }
        />
      </div>
    </>
  );
}

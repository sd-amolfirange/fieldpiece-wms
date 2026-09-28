import { createColumnHelper } from "@tanstack/react-table";
import {
  CLAIM_SOURCES,
  CLAIM_STATUSES,
  ISSUE_TYPES,
  type ClaimSource,
  type ClaimStatus,
  type IssueType,
  type WarrantyClaimView,
} from "@wms/domain";
import { ClipboardList, MessageSquarePlus, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { PageHeader } from "@/components/layout";
import {
  buttonVariants,
  ClaimSourceBadge,
  ClaimStatusBadge,
  DataTable,
  Input,
  KpiTile,
  MonoId,
  NativeSelect,
} from "@/components/ui";
import { formatDateTime, formatMoney } from "@/lib/format";
import { useCurrentRole, useCurrentUser } from "@/lib/session";
import { useTableParams } from "@/lib/use-table-params";
import { ClaimTracker } from "../components/ClaimTracker";
import { useClaimCounts, useClaims } from "../hooks";

// A09 Warranty claims (warranty desk: every claim, with a count per status that opens the filtered list),
// DL07 Warranty claims (dealer / distributor: claims on their products, with a tracker) and My claims (customer).
// The server returns only the caller's claims, newest first.

const COUNT_TILES: ClaimStatus[] = ["SUBMITTED", "IN_REVIEW", "APPROVED", "CLOSED", "REJECTED"];
const col = createColumnHelper<WarrantyClaimView>();

export default function ClaimsListPage() {
  const { t, i18n } = useTranslation();
  const role = useCurrentRole();
  const currency = useCurrentUser()?.currency ?? "USD";
  const isAdmin = role === "admin";
  const isCustomer = role === "customer";
  const isPartner = role === "dealer" || role === "distributor";
  const [params, update] = useTableParams({ sort: "-createdAt" });
  const [search, setSearch] = useState(params.q ?? "");
  const status = params.filters.status as ClaimStatus | undefined;
  const source = params.filters.source as ClaimSource | undefined;
  const issueType = params.filters.issueType as IssueType | undefined;
  const counts = useClaimCounts();
  const query = useClaims({
    page: params.page,
    pageSize: params.pageSize,
    sort: params.sort,
    q: params.q,
    status,
    source,
    issueType,
  });
  const title = isCustomer ? t("nav.myClaims") : t("claims.title");

  // Dealer / distributor on a tablet (below xl): the tracker already shows the status, so filed date, source
  // and status are left out to avoid sideways scrolling. Desktop shows every column.
  const tabletHidden = useMemo(
    () => (isPartner ? { className: "hidden xl:table-cell" } : undefined),
    [isPartner],
  );

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
        meta: tabletHidden,
        header: t("claims.columns.filed"),
        cell: (i) => formatDateTime(i.getValue(), i18n.language),
      }),
      col.accessor("unitSerial", {
        header: t("claims.columns.product"),
        cell: (i) => (
          <span>
            <MonoId>{i.getValue()}</MonoId>
            <span className="block text-xs text-text-muted">
              {i.row.original.modelCode}
              {i.row.original.batchNumber ? ` · ${i.row.original.batchNumber}` : ""}
            </span>
          </span>
        ),
      }),
      col.accessor("issueType", {
        header: t("claims.columns.issue"),
        cell: (i) => t(`claims.issue.${i.getValue()}`),
      }),
      ...(isCustomer
        ? []
        : [
            col.accessor("customerName", {
              header: t("claims.columns.customer"),
              cell: (i) => i.getValue() ?? "—",
            }),
            // A dealer only ever sees its own name here, so the column is left out for dealers.
            ...(role === "dealer"
              ? []
              : [
                  col.accessor("dealerName", {
                    header: t("claims.columns.dealer"),
                    cell: (i) => i.getValue() ?? "—",
                  }),
                ]),
            col.accessor("source", {
              meta: tabletHidden,
              header: t("claims.columns.source"),
              cell: (i) => <ClaimSourceBadge status={i.getValue()} />,
            }),
          ]),
      col.accessor("status", {
        meta: tabletHidden,
        header: t("claims.columns.status"),
        cell: (i) => <ClaimStatusBadge status={i.getValue()} />,
      }),
      ...(isPartner
        ? [
            col.accessor("status", {
              id: "progress",
              header: t("claims.columns.progress"),
              enableSorting: false,
              cell: (i) => <ClaimTracker status={i.getValue()} history={i.row.original.history} />,
            }),
          ]
        : []),
      col.accessor("resolution", {
        header: t("claims.columns.resolution"),
        cell: (i) => {
          const resolution = i.getValue();
          if (!resolution) return "—";
          const amount = i.row.original.creditAmount;
          return (
            <span>
              {t(`claims.resolution.${resolution}`)}
              {resolution === "CREDIT" && amount ? (
                <span className="block text-xs tabular-nums text-text-muted">
                  {formatMoney(amount, currency, i18n.language)}
                </span>
              ) : null}
            </span>
          );
        },
      }),
    ],
    [t, i18n.language, isCustomer, isPartner, role, tabletHidden, currency],
  );

  return (
    <div className={isCustomer ? "mx-auto max-w-xl" : undefined}>
      <PageHeader
        title={title}
        breadcrumbs={[
          { label: isCustomer ? t("nav.myUnits") : t("nav.dashboard"), to: "/" },
          { label: title },
        ]}
        actions={
          <Link to="/claims/new" className={buttonVariants()}>
            <MessageSquarePlus size={20} strokeWidth={1.75} aria-hidden />
            {t("claims.file")}
          </Link>
        }
      />
      <div className="space-y-6">
        {isAdmin ? (
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
        ) : null}
        <DataTable
          caption={title}
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
            isCustomer ? undefined : (
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
                <label htmlFor="claims-issue" className="sr-only">
                  {t("claims.filterIssue")}
                </label>
                <NativeSelect
                  id="claims-issue"
                  className="w-full sm:w-48"
                  value={issueType ?? ""}
                  onChange={(e) => update({ issueType: e.target.value })}
                >
                  <option value="">{t("claims.allIssues")}</option>
                  {ISSUE_TYPES.map((s) => (
                    <option key={s} value={s}>
                      {t(`claims.issue.${s}`)}
                    </option>
                  ))}
                </NativeSelect>
                {isAdmin ? (
                  <>
                    <label htmlFor="claims-source" className="sr-only">
                      {t("claims.filterSource")}
                    </label>
                    <NativeSelect
                      id="claims-source"
                      className="w-full sm:w-48"
                      value={source ?? ""}
                      onChange={(e) => update({ source: e.target.value })}
                    >
                      <option value="">{t("claims.allSources")}</option>
                      {CLAIM_SOURCES.map((s) => (
                        <option key={s} value={s}>
                          {t(`status.source.${s}`)}
                        </option>
                      ))}
                    </NativeSelect>
                  </>
                ) : null}
              </>
            )
          }
        />
      </div>
    </div>
  );
}

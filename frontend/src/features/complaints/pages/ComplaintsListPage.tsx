import { createColumnHelper } from "@tanstack/react-table";
import {
  COMPLAINT_SOURCES,
  COMPLAINT_STATUSES,
  type ComplaintSource,
  type ComplaintStatus,
  type ComplaintView,
} from "@wms/domain";
import { MessageSquarePlus, Search, Truck } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { PageHeader } from "@/components/layout";
import {
  buttonVariants,
  ClaimStatusBadge,
  ComplaintSourceBadge,
  ComplaintStatusBadge,
  DataTable,
  Input,
  MonoId,
  NativeSelect,
} from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { useCurrentRole } from "@/lib/session";
import { useTableParams } from "@/lib/use-table-params";
import { useComplaints } from "../hooks";

// A07 Complaints (admin), My complaints (customer) and, from Phase 4, DL07 for dealers. The server returns only
// the caller's complaints, newest first.

const col = createColumnHelper<ComplaintView>();

export default function ComplaintsListPage() {
  const { t, i18n } = useTranslation();
  const role = useCurrentRole();
  const isAdmin = role === "admin";
  const isCustomer = role === "customer";
  const [params, update] = useTableParams({ sort: "-createdAt" });
  const [search, setSearch] = useState(params.q ?? "");
  const status = params.filters.status as ComplaintStatus | undefined;
  const source = params.filters.source as ComplaintSource | undefined;
  const query = useComplaints({
    page: params.page,
    pageSize: params.pageSize,
    sort: params.sort,
    q: params.q,
    status,
    source,
  });
  const title = isCustomer ? t("nav.myComplaints") : t("complaints.title");

  const columns = useMemo(
    () => [
      col.accessor("id", {
        header: t("complaints.columns.id"),
        cell: (i) => (
          <Link to={`/complaints/${i.getValue()}`} className="underline-offset-2 hover:underline">
            <MonoId>{i.getValue()}</MonoId>
          </Link>
        ),
      }),
      col.accessor("createdAt", {
        header: t("complaints.columns.received"),
        cell: (i) => formatDateTime(i.getValue(), i18n.language),
      }),
      col.accessor("unitSerial", {
        header: t("complaints.columns.unit"),
        cell: (i) => <MonoId>{i.getValue()}</MonoId>,
      }),
      ...(isCustomer
        ? []
        : [
            col.accessor("customerName", {
              header: t("complaints.columns.customer"),
              enableSorting: false,
              cell: (i) => i.getValue() ?? "—",
            }),
            col.accessor("dealerName", {
              header: t("complaints.columns.dealer"),
              enableSorting: false,
              cell: (i) => i.getValue() ?? "—",
            }),
            col.accessor("source", {
              header: t("complaints.columns.source"),
              cell: (i) => <ComplaintSourceBadge status={i.getValue()} />,
            }),
          ]),
      col.accessor("status", {
        header: t("complaints.columns.status"),
        cell: (i) => <ComplaintStatusBadge status={i.getValue()} />,
      }),
      col.accessor((c) => c.entitlement.reason, {
        id: "entitlement",
        header: t("complaints.columns.entitlement"),
        enableSorting: false,
        cell: (i) => t(`entitlement.short.${i.getValue()}`),
      }),
      ...(isCustomer
        ? []
        : [
            col.accessor("claimStatus", {
              header: t("complaints.columns.claim"),
              enableSorting: false,
              cell: (i) => {
                const claimStatus = i.getValue();
                return claimStatus ? <ClaimStatusBadge status={claimStatus} /> : "—";
              },
            }),
          ]),
    ],
    [t, i18n.language, isCustomer],
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
          <Link to="/complaints/new" className={buttonVariants()}>
            <MessageSquarePlus size={20} strokeWidth={1.75} aria-hidden />
            {t("complaints.raise")}
          </Link>
        }
      />
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
        emptyIcon={Truck}
        emptyMessage={t("complaints.empty")}
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
                <label htmlFor="complaints-search" className="sr-only">
                  {t("complaints.searchPlaceholder")}
                </label>
                <Search
                  size={16}
                  strokeWidth={1.75}
                  aria-hidden
                  className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-ink-500"
                />
                <Input
                  id="complaints-search"
                  type="search"
                  className="ps-9"
                  placeholder={t("complaints.searchPlaceholder")}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </form>
              <label htmlFor="complaints-status" className="sr-only">
                {t("complaints.filterStatus")}
              </label>
              <NativeSelect
                id="complaints-status"
                className="w-full sm:w-48"
                value={status ?? ""}
                onChange={(e) => update({ status: e.target.value })}
              >
                <option value="">{t("complaints.allStatuses")}</option>
                {COMPLAINT_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {t(`status.complaint.${s}`)}
                  </option>
                ))}
              </NativeSelect>
              {isAdmin ? (
                <>
                  <label htmlFor="complaints-source" className="sr-only">
                    {t("complaints.filterSource")}
                  </label>
                  <NativeSelect
                    id="complaints-source"
                    className="w-full sm:w-48"
                    value={source ?? ""}
                    onChange={(e) => update({ source: e.target.value })}
                  >
                    <option value="">{t("complaints.allSources")}</option>
                    {COMPLAINT_SOURCES.map((s) => (
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
  );
}

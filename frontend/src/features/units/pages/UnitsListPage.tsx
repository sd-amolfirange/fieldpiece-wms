import { createColumnHelper } from "@tanstack/react-table";
import type { UnitView, WarrantyStatus } from "@wms/domain";
import { Boxes, Search, ShieldCheck, Upload } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { PageHeader } from "@/components/layout";
import { buttonVariants, DataTable, Input, MonoId, NativeSelect, WarrantyStatusBadge } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { useDealers } from "@/features/catalog";
import { useCurrentRole } from "@/lib/session";
import { useTableParams } from "@/lib/use-table-params";
import { useUnits } from "../hooks";

// A04 Units (admin) and DL04 My sold units (dealer / distributor). The server returns only the caller's units.

const STATUSES: WarrantyStatus[] = ["ACTIVE", "EXPIRING_SOON", "EXPIRED", "VOID", "PENDING"];
const col = createColumnHelper<UnitView>();

export default function UnitsListPage() {
  const { t, i18n } = useTranslation();
  const role = useCurrentRole();
  const isAdmin = role === "admin";
  const showDealer = role === "admin" || role === "distributor";
  const [params, update] = useTableParams({ sort: "serial" });
  const [search, setSearch] = useState(params.q ?? "");
  const status = params.filters.status as WarrantyStatus | undefined;
  const dealerId = params.filters.dealerId;
  const dealers = useDealers();
  const query = useUnits({
    page: params.page,
    pageSize: params.pageSize,
    sort: params.sort,
    q: params.q,
    status,
    dealerId,
  });
  const title = isAdmin ? t("units.title") : t("units.mySoldUnits");

  const columns = useMemo(
    () => [
      col.accessor("serial", {
        header: t("units.columns.serial"),
        cell: (i) => (
          <Link to={`/units/${i.getValue()}`} className="underline-offset-2 hover:underline">
            <MonoId>{i.getValue()}</MonoId>
          </Link>
        ),
      }),
      col.accessor("modelCode", { header: t("units.columns.model") }),
      col.accessor("customerName", { header: t("units.columns.customer"), cell: (i) => i.getValue() ?? "—" }),
      ...(showDealer
        ? [
            col.accessor("dealerName", {
              header: t("units.columns.dealer"),
              cell: (i) => i.getValue() ?? "—",
            }),
          ]
        : []),
      col.accessor("installDate", {
        header: t("units.columns.installed"),
        cell: (i) => formatDate(i.getValue(), i18n.language) || "—",
      }),
      col.accessor("status", {
        header: t("units.columns.status"),
        cell: (i) => <WarrantyStatusBadge status={i.getValue()} />,
      }),
      col.accessor("daysRemaining", {
        header: t("units.columns.daysLeft"),
        enableSorting: false,
        cell: (i) =>
          i.row.original.status === "ACTIVE" || i.row.original.status === "EXPIRING_SOON" ? (
            <span className="tabular-nums">{i.getValue()}</span>
          ) : (
            ""
          ),
      }),
    ],
    [t, i18n.language, showDealer],
  );

  return (
    <>
      <PageHeader
        title={title}
        breadcrumbs={[{ label: t("nav.dashboard"), to: "/" }, { label: title }]}
        actions={
          isAdmin ? (
            <>
              <Link to="/registrations/bulk" className={buttonVariants({ variant: "secondary" })}>
                <Upload size={20} strokeWidth={1.75} aria-hidden />
                {t("units.bulkUpload")}
              </Link>
              <Link to="/registrations/new" className={buttonVariants()}>
                <ShieldCheck size={20} strokeWidth={1.75} aria-hidden />
                {t("units.addUnit")}
              </Link>
            </>
          ) : (
            <Link to="/registrations/new" className={buttonVariants()}>
              <ShieldCheck size={20} strokeWidth={1.75} aria-hidden />
              {t("nav.registerUnit")}
            </Link>
          )
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
        getRowId={(row) => row.serial}
        isLoading={query.isLoading}
        error={query.error}
        onRetry={() => void query.refetch()}
        emptyIcon={Boxes}
        emptyMessage={t("units.empty")}
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
              <label htmlFor="units-search" className="sr-only">
                {t("units.searchPlaceholder")}
              </label>
              <Search
                size={16}
                strokeWidth={1.75}
                aria-hidden
                className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-ink-500"
              />
              <Input
                id="units-search"
                type="search"
                className="ps-9"
                placeholder={t("units.searchPlaceholder")}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </form>
            <label htmlFor="units-status" className="sr-only">
              {t("units.filterStatus")}
            </label>
            <NativeSelect
              id="units-status"
              className="w-full sm:w-48"
              value={status ?? ""}
              onChange={(e) => update({ status: e.target.value })}
            >
              <option value="">{t("units.allStatuses")}</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`status.warranty.${s}`)}
                </option>
              ))}
            </NativeSelect>
            {showDealer ? (
              <>
                <label htmlFor="units-dealer" className="sr-only">
                  {t("units.filterDealer")}
                </label>
                <NativeSelect
                  id="units-dealer"
                  className="w-full sm:w-48"
                  value={dealerId ?? ""}
                  onChange={(e) => update({ dealerId: e.target.value })}
                >
                  <option value="">{t("units.allDealers")}</option>
                  {dealers.data?.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </NativeSelect>
              </>
            ) : null}
          </>
        }
      />
    </>
  );
}

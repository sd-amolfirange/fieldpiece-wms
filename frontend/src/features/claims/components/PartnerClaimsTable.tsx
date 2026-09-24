import { createColumnHelper } from "@tanstack/react-table";
import type { ClaimView } from "@wms/domain";
import { ClipboardList } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { ClaimStatusBadge, DataTable, MonoId } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { useClaims } from "../hooks";

// DL07 claims tab: the manufacturer claims on the dealer's units. View only: the dealer can follow the status but
// can't act on or open the claim (only the admin does).

const col = createColumnHelper<ClaimView>();

export function PartnerClaimsTable() {
  const { t, i18n } = useTranslation();
  // Local paging: the complaints tab on the same page owns the URL parameters.
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<string | undefined>("-createdAt");
  const pageSize = 25;
  const query = useClaims({ page, pageSize, sort });

  const columns = useMemo(
    () => [
      col.accessor("id", { header: t("claims.columns.id"), cell: (i) => <MonoId>{i.getValue()}</MonoId> }),
      col.accessor("createdAt", {
        header: t("claims.columns.created"),
        cell: (i) => formatDateTime(i.getValue(), i18n.language),
      }),
      col.accessor("complaintId", {
        header: t("claims.fields.complaint"),
        enableSorting: false,
        cell: (i) => {
          const id = i.getValue();
          return id ? (
            <Link to={`/complaints/${id}`} className="underline-offset-2 hover:underline">
              <MonoId>{id}</MonoId>
            </Link>
          ) : (
            "—"
          );
        },
      }),
      col.accessor("unitSerial", {
        header: t("claims.columns.unit"),
        cell: (i) => <MonoId>{i.getValue()}</MonoId>,
      }),
      col.accessor("brandName", { header: t("claims.columns.brand"), enableSorting: false }),
      col.accessor("status", {
        header: t("claims.columns.status"),
        cell: (i) => <ClaimStatusBadge status={i.getValue()} />,
      }),
    ],
    [t, i18n.language],
  );

  return (
    <div className="space-y-4">
      <p className="text-sm text-text-muted">{t("claims.viewOnly")}</p>
      <DataTable
        caption={t("claims.title")}
        columns={columns}
        data={query.data?.items}
        total={query.data?.total ?? 0}
        page={page}
        pageSize={pageSize}
        sort={sort}
        onSortChange={(next) => {
          setSort(next);
          setPage(1);
        }}
        onPageChange={setPage}
        getRowId={(row) => row.id}
        isLoading={query.isLoading}
        error={query.error}
        onRetry={() => void query.refetch()}
        emptyIcon={ClipboardList}
        emptyMessage={t("claims.emptyPartner")}
      />
    </div>
  );
}

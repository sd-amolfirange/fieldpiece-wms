import { createColumnHelper } from "@tanstack/react-table";
import {
  INTEGRATION_STATUSES,
  INTEGRATION_SYSTEMS,
  type IntegrationDirection,
  type IntegrationMessage,
  type IntegrationStatus,
  type IntegrationSystem,
} from "@wms/domain";
import { ArrowRightLeft, RotateCw } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "@/components/feedback";
import { PageHeader } from "@/components/layout";
import {
  Button,
  DataTable,
  IntegrationDirectionBadge,
  IntegrationStatusBadge,
  Modal,
  MonoId,
  NativeSelect,
} from "@/components/ui";
import { toApiError } from "@/lib/api-error";
import { formatDateTime } from "@/lib/format";
import { useTableParams } from "@/lib/use-table-params";
import { AdminTabs } from "../components/AdminTabs";
import { useIntegrations, useRetryIntegration } from "../hooks";

// A12 Integration log: every message in and out (system, direction, status, time), the payload behind each
// one, and Retry for failed messages.

const DIRECTIONS: IntegrationDirection[] = ["IN", "OUT"];
const col = createColumnHelper<IntegrationMessage>();

export default function IntegrationLogPage() {
  const { t, i18n } = useTranslation();
  const [params, update] = useTableParams({ sort: "-createdAt" });
  const system = params.filters.system as IntegrationSystem | undefined;
  const direction = params.filters.direction as IntegrationDirection | undefined;
  const status = params.filters.status as IntegrationStatus | undefined;
  const query = useIntegrations({
    page: params.page,
    pageSize: params.pageSize,
    sort: params.sort,
    system,
    direction,
    status,
  });
  const retry = useRetryIntegration();
  const [open, setOpen] = useState<IntegrationMessage | null>(null);

  const columns = useMemo(
    () => [
      col.accessor("createdAt", {
        header: t("integration.columns.time"),
        cell: (i) => formatDateTime(i.getValue(), i18n.language),
      }),
      col.accessor("system", {
        header: t("integration.columns.system"),
        cell: (i) => t(`integration.system.${i.getValue()}`),
      }),
      col.accessor("direction", {
        header: t("integration.columns.direction"),
        cell: (i) => <IntegrationDirectionBadge status={i.getValue()} />,
      }),
      col.accessor("type", {
        header: t("integration.columns.type"),
        enableSorting: false,
        cell: (i) => t(`integration.type.${i.getValue()}`, { defaultValue: i.getValue() }),
      }),
      col.accessor("refId", {
        header: t("integration.columns.ref"),
        enableSorting: false,
        cell: (i) => (i.getValue() ? <MonoId>{i.getValue()}</MonoId> : "—"),
      }),
      col.accessor("status", {
        header: t("integration.columns.status"),
        cell: (i) => <IntegrationStatusBadge status={i.getValue()} />,
      }),
      col.display({
        id: "actions",
        header: () => <span className="sr-only">{t("common.actions")}</span>,
        cell: ({ row }) => (
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="secondary" onClick={() => setOpen(row.original)}>
              {t("integration.viewPayload")}
            </Button>
            {row.original.status === "FAILED" ? (
              <Button
                size="sm"
                icon={RotateCw}
                loading={retry.isPending && retry.variables === row.original.id}
                onClick={() =>
                  retry.mutate(row.original.id, {
                    onSuccess: (m) => toast.success(t("integration.retried"), m.id),
                    onError: (e) => toast.error(toApiError(e).message),
                  })
                }
              >
                {t("integration.retry")}
              </Button>
            ) : null}
          </div>
        ),
      }),
    ],
    [t, i18n.language, retry],
  );

  return (
    <>
      <PageHeader
        title={t("integration.title")}
        breadcrumbs={[{ label: t("nav.dashboard"), to: "/" }, { label: t("integration.title") }]}
      />
      <AdminTabs />
      <DataTable
        caption={t("integration.title")}
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
        emptyIcon={ArrowRightLeft}
        emptyMessage={t("integration.empty")}
        toolbar={
          <>
            <label htmlFor="integration-system" className="sr-only">
              {t("integration.filterSystem")}
            </label>
            <NativeSelect
              id="integration-system"
              className="w-full sm:w-48"
              value={system ?? ""}
              onChange={(e) => update({ system: e.target.value })}
            >
              <option value="">{t("integration.allSystems")}</option>
              {INTEGRATION_SYSTEMS.map((s) => (
                <option key={s} value={s}>
                  {t(`integration.system.${s}`)}
                </option>
              ))}
            </NativeSelect>
            <label htmlFor="integration-direction" className="sr-only">
              {t("integration.filterDirection")}
            </label>
            <NativeSelect
              id="integration-direction"
              className="w-full sm:w-48"
              value={direction ?? ""}
              onChange={(e) => update({ direction: e.target.value })}
            >
              <option value="">{t("integration.allDirections")}</option>
              {DIRECTIONS.map((d) => (
                <option key={d} value={d}>
                  {t(`status.direction.${d}`)}
                </option>
              ))}
            </NativeSelect>
            <label htmlFor="integration-status" className="sr-only">
              {t("integration.filterStatus")}
            </label>
            <NativeSelect
              id="integration-status"
              className="w-full sm:w-48"
              value={status ?? ""}
              onChange={(e) => update({ status: e.target.value })}
            >
              <option value="">{t("integration.allStatuses")}</option>
              {INTEGRATION_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`status.integration.${s}`)}
                </option>
              ))}
            </NativeSelect>
          </>
        }
      />

      <Modal
        open={open !== null}
        onOpenChange={(o) => (o ? null : setOpen(null))}
        title={
          open
            ? t("integration.payloadTitle", {
                type: t(`integration.type.${open.type}`, { defaultValue: open.type }),
              })
            : ""
        }
        description={
          open
            ? `${t(`integration.system.${open.system}`)} · ${t(`status.direction.${open.direction}`)} · ${formatDateTime(open.updatedAt, i18n.language)}`
            : undefined
        }
        footer={
          <Button variant="secondary" onClick={() => setOpen(null)}>
            {t("common.close")}
          </Button>
        }
      >
        {open ? (
          <div className="space-y-3">
            {open.lastError ? (
              <p className="text-body text-danger">
                {t("integration.lastError", { error: open.lastError, attempts: open.attempts })}
              </p>
            ) : null}
            <pre className="overflow-x-auto rounded bg-ink-50 p-3 font-mono text-sm">
              {JSON.stringify(open.payload, null, 2)}
            </pre>
          </div>
        ) : null}
      </Modal>
    </>
  );
}

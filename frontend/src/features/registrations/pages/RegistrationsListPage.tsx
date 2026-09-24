import { createColumnHelper } from "@tanstack/react-table";
import {
  REGISTRATION_CHANNELS,
  REGISTRATION_FLAGS,
  REGISTRATION_STATUSES,
  type RegistrationChannel,
  type RegistrationFlag,
  type RegistrationStatus,
  type RegistrationView,
} from "@wms/domain";
import { CheckCheck, Inbox, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { toast } from "@/components/feedback";
import { PageHeader } from "@/components/layout";
import {
  Button,
  ChannelBadge,
  DataTable,
  Input,
  MonoId,
  NativeSelect,
  RegistrationFlagBadge,
  RegistrationStatusBadge,
} from "@/components/ui";
import { toApiError } from "@/lib/api-error";
import { formatDateTime } from "@/lib/format";
import { useTableParams } from "@/lib/use-table-params";
import { useBulkApprove, useRegistrations } from "../hooks";

// A02 Registration inbox: one queue for every channel (dealer, portal, email, ERP, bulk), newest first.

const col = createColumnHelper<RegistrationView>();

export default function RegistrationsListPage() {
  const { t, i18n } = useTranslation();
  const [params, update] = useTableParams({ sort: "-submittedAt" });
  const [search, setSearch] = useState(params.q ?? "");
  const [selected, setSelected] = useState<string[]>([]);
  const [selectionKey, setSelectionKey] = useState(0);
  const status = params.filters.status as RegistrationStatus | undefined;
  const channel = params.filters.channel as RegistrationChannel | undefined;
  const flag = params.filters.flag as RegistrationFlag | undefined;
  const query = useRegistrations({
    page: params.page,
    pageSize: params.pageSize,
    sort: params.sort,
    q: params.q,
    status,
    channel,
    flag,
  });
  const bulkApprove = useBulkApprove();

  const columns = useMemo(
    () => [
      col.accessor("submittedAt", {
        header: t("inbox.columns.received"),
        cell: (i) => formatDateTime(i.getValue(), i18n.language),
      }),
      col.accessor("serial", {
        header: t("inbox.columns.serial"),
        cell: (i) => (
          <Link to={`/registrations/${i.row.original.id}`} className="underline-offset-2 hover:underline">
            <MonoId>{i.getValue()}</MonoId>
          </Link>
        ),
      }),
      col.accessor("modelCode", { header: t("inbox.columns.model") }),
      col.accessor((r) => r.customer.name, {
        id: "customer",
        header: t("inbox.columns.customer"),
        enableSorting: false,
      }),
      col.accessor("dealerName", {
        header: t("inbox.columns.dealer"),
        enableSorting: false,
        cell: (i) => i.getValue() ?? "—",
      }),
      col.accessor("channel", {
        header: t("inbox.columns.source"),
        cell: (i) => <ChannelBadge status={i.getValue()} />,
      }),
      col.accessor("flags", {
        header: t("inbox.columns.flags"),
        enableSorting: false,
        cell: (i) => (
          <span className="inline-flex flex-wrap gap-1">
            {i.getValue().map((f) => (
              <RegistrationFlagBadge key={f} status={f} />
            ))}
          </span>
        ),
      }),
      col.accessor("status", {
        header: t("inbox.columns.status"),
        cell: (i) => <RegistrationStatusBadge status={i.getValue()} />,
      }),
    ],
    [t, i18n.language],
  );

  const approveSelected = () =>
    bulkApprove.mutate(selected, {
      onSuccess: ({ approved, skipped }) => {
        toast.success(
          t("inbox.bulkApproved", { count: approved }),
          skipped ? t("inbox.bulkSkipped", { count: skipped }) : undefined,
        );
        setSelected([]);
        setSelectionKey((k) => k + 1);
      },
      onError: (e) => toast.error(toApiError(e).message),
    });

  return (
    <>
      <PageHeader
        title={t("inbox.title")}
        breadcrumbs={[{ label: t("nav.dashboard"), to: "/" }, { label: t("inbox.title") }]}
        actions={
          <Button
            icon={CheckCheck}
            disabled={!selected.length}
            loading={bulkApprove.isPending}
            onClick={approveSelected}
          >
            {t("inbox.approveSelected", { count: selected.length })}
          </Button>
        }
      />
      <DataTable
        key={selectionKey}
        caption={t("inbox.title")}
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
        emptyIcon={Inbox}
        emptyMessage={t("inbox.empty")}
        selectable
        onSelectionChange={setSelected}
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
              <label htmlFor="inbox-search" className="sr-only">
                {t("inbox.searchPlaceholder")}
              </label>
              <Search
                size={16}
                strokeWidth={1.75}
                aria-hidden
                className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-ink-500"
              />
              <Input
                id="inbox-search"
                type="search"
                className="ps-9"
                placeholder={t("inbox.searchPlaceholder")}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </form>
            <label htmlFor="inbox-status" className="sr-only">
              {t("inbox.filterStatus")}
            </label>
            <NativeSelect
              id="inbox-status"
              className="w-full sm:w-48"
              value={status ?? ""}
              onChange={(e) => update({ status: e.target.value })}
            >
              <option value="">{t("inbox.allStatuses")}</option>
              {REGISTRATION_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`status.registration.${s}`)}
                </option>
              ))}
            </NativeSelect>
            <label htmlFor="inbox-flag" className="sr-only">
              {t("inbox.filterFlag")}
            </label>
            <NativeSelect
              id="inbox-flag"
              className="w-full sm:w-48"
              value={flag ?? ""}
              onChange={(e) => update({ flag: e.target.value })}
            >
              <option value="">{t("inbox.allFlags")}</option>
              {REGISTRATION_FLAGS.map((f) => (
                <option key={f} value={f}>
                  {t(`inbox.flagFilter.${f}`)}
                </option>
              ))}
            </NativeSelect>
            <label htmlFor="inbox-channel" className="sr-only">
              {t("inbox.filterSource")}
            </label>
            <NativeSelect
              id="inbox-channel"
              className="w-full sm:w-48"
              value={channel ?? ""}
              onChange={(e) => update({ channel: e.target.value })}
            >
              <option value="">{t("inbox.allSources")}</option>
              {REGISTRATION_CHANNELS.map((c) => (
                <option key={c} value={c}>
                  {t(`status.channel.${c}`)}
                </option>
              ))}
            </NativeSelect>
          </>
        }
      />
    </>
  );
}

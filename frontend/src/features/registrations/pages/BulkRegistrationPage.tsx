import { createColumnHelper } from "@tanstack/react-table";
import type { BulkImportView, BulkRow, RegistrationField, RegistrationRowInput } from "@wms/domain";
import { Download, FileSpreadsheet, History, RotateCcw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router-dom";
import { toast } from "@/components/feedback";
import { PageHeader } from "@/components/layout";
import {
  BulkRowStatusBadge,
  Button,
  buttonVariants,
  Card,
  DataTable,
  FileDropzone,
  FormField,
  Input,
  MonoId,
  NativeSelect,
  type UploadItem,
} from "@/components/ui";
import { toApiError } from "@/lib/api-error";
import { formatDateTime } from "@/lib/format";
import { useDealers, useModels } from "@/lib/master-data";
import { useCurrentRole } from "@/lib/session";
import { bulkImportsApi } from "../api";
import { useBulkImport, useBulkImports, useResubmitBulk, useUploadBulk } from "../hooks";

// DL02 Bulk import: download the template, upload a week's sales, every row is checked against the product
// master. Clean rows are registered at once; rows with problems are fixed inline and resubmitted (no re-upload);
// a duplicate serial goes to the admin.

const SHEET_TYPES = {
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
  "text/csv": [".csv"],
};
type Edits = Record<number, RegistrationRowInput>;

const rowCol = createColumnHelper<BulkRow>();
const historyCol = createColumnHelper<BulkImportView>();

function useRowColumns(
  edits: Edits,
  setEdit: (row: number, field: RegistrationField, value: string) => void,
) {
  const { t } = useTranslation();
  const models = useModels();

  return useMemo(() => {
    const valueOf = (row: BulkRow, field: RegistrationField) =>
      edits[row.rowNumber]?.[field] ?? row.values[field] ?? "";
    const editable = (field: RegistrationField, label: string) =>
      rowCol.display({
        id: field,
        header: label,
        cell: ({ row: { original: row } }) => {
          const value = valueOf(row, field);
          if (row.status !== "ERROR") return field === "serial" ? <MonoId>{value}</MonoId> : value || "—";
          const invalid = !!row.errors[field];
          const aria = t("bulk.editCell", { field: label, row: row.rowNumber });
          if (field === "modelCode") {
            return (
              <NativeSelect
                aria-label={aria}
                aria-invalid={invalid || undefined}
                className="sm:w-48"
                value={value}
                onChange={(e) => setEdit(row.rowNumber, field, e.target.value)}
              >
                {models.data?.some((m) => m.code === value) ? null : (
                  <option value={value}>{value || "—"}</option>
                )}
                {models.data?.map((m) => (
                  <option key={m.id} value={m.code}>
                    {m.code}
                  </option>
                ))}
              </NativeSelect>
            );
          }
          return (
            <Input
              aria-label={aria}
              aria-invalid={invalid || undefined}
              type={field === "installDate" ? "date" : "text"}
              className={field === "serial" ? "font-mono" : undefined}
              value={value}
              onChange={(e) => setEdit(row.rowNumber, field, e.target.value)}
            />
          );
        },
      });

    return [
      rowCol.accessor("rowNumber", {
        header: t("bulk.columns.row"),
        cell: (i) => <span className="tabular-nums">{i.getValue()}</span>,
      }),
      editable("serial", t("bulk.columns.serial")),
      editable("modelCode", t("bulk.columns.model")),
      editable("customerName", t("bulk.columns.customer")),
      editable("installDate", t("bulk.columns.installDate")),
      rowCol.accessor("status", {
        header: t("bulk.columns.status"),
        cell: (i) => <BulkRowStatusBadge status={i.getValue()} />,
      }),
      rowCol.display({
        id: "problem",
        header: t("bulk.columns.problem"),
        cell: ({ row: { original: row } }) => (
          <span className="text-sm text-danger">
            {Object.entries(row.errors)
              .map(([field, code]) => `${t(`bulk.field.${field}`)}: ${t(`rowErrors.${code}`)}`)
              .join(" · ")}
          </span>
        ),
      }),
    ];
  }, [t, edits, setEdit, models.data]);
}

export default function BulkRegistrationPage() {
  const { t, i18n } = useTranslation();
  const role = useCurrentRole();
  const needsDealer = role === "admin" || role === "distributor";
  const [searchParams, setSearchParams] = useSearchParams();
  const batchId = searchParams.get("batch") ?? undefined;
  const dealers = useDealers();
  const [dealerId, setDealerId] = useState("");
  const [files, setFiles] = useState<UploadItem[]>([]);
  const [edits, setEdits] = useState<Edits>({});
  const [show, setShow] = useState<"all" | "attention">("all");
  const upload = useUploadBulk();
  const batch = useBulkImport(batchId);
  const history = useBulkImports();
  const resubmit = useResubmitBulk(batchId ?? "");

  // A fresh upload or a resubmit replaces the local edits.
  useEffect(() => setEdits({}), [batch.data?.updatedAt]);

  const setEdit = useMemo(
    () => (row: number, field: RegistrationField, value: string) =>
      setEdits((prev) => ({ ...prev, [row]: { ...prev[row], [field]: value } })),
    [],
  );
  const columns = useRowColumns(edits, setEdit);

  const onFiles = (items: UploadItem[]) => {
    const file = items[0]?.file;
    if (!file) return;
    if (needsDealer && !dealerId) {
      toast.error(t("validation.pickDealer"));
      return;
    }
    setFiles([{ file, progress: 0 }]);
    upload.mutate(
      { file, dealerId: needsDealer ? dealerId : undefined },
      {
        onSuccess: (result) => {
          setSearchParams({ batch: result.id }, { replace: true });
          toast.success(t("bulk.uploaded", { file: result.fileName }));
        },
        onError: (e) => toast.error(toApiError(e).message),
        onSettled: () => setFiles([]),
      },
    );
  };

  const errorRows = batch.data?.rows.filter((r) => r.status === "ERROR") ?? [];
  const visibleRows =
    show === "attention"
      ? batch.data?.rows.filter((r) => r.status === "ERROR" || r.status === "REVIEW")
      : batch.data?.rows;

  const onResubmit = () =>
    resubmit.mutate(
      errorRows.map((r) => ({ rowNumber: r.rowNumber, values: { ...r.values, ...edits[r.rowNumber] } })),
      {
        onSuccess: (result) =>
          toast.success(
            t("bulk.resubmitted", { registered: result.counts.registered, errors: result.counts.errors }),
          ),
        onError: (e) => toast.error(toApiError(e).message),
      },
    );

  const historyColumns = useMemo(
    () => [
      historyCol.accessor("createdAt", {
        header: t("bulk.history.uploaded"),
        cell: (i) => formatDateTime(i.getValue(), i18n.language),
      }),
      historyCol.accessor("fileName", {
        header: t("bulk.history.file"),
        cell: (i) => (
          <Link to={`?batch=${i.row.original.id}`} className="underline-offset-2 hover:underline">
            {i.getValue()}
          </Link>
        ),
      }),
      historyCol.accessor("dealerName", {
        header: t("bulk.history.dealer"),
        cell: (i) => i.getValue() ?? "—",
      }),
      historyCol.accessor("uploadedByName", { header: t("bulk.history.by") }),
      historyCol.accessor((b) => b.counts.total, { id: "rows", header: t("bulk.history.rows") }),
      historyCol.accessor((b) => b.counts.registered, {
        id: "registered",
        header: t("bulk.history.registered"),
      }),
      historyCol.accessor((b) => b.counts.errors, { id: "errors", header: t("bulk.history.errors") }),
      historyCol.accessor((b) => b.counts.review, { id: "review", header: t("bulk.history.review") }),
    ],
    [t, i18n.language],
  );

  return (
    <>
      <PageHeader
        title={t("bulk.title")}
        breadcrumbs={[{ label: t("nav.dashboard"), to: "/" }, { label: t("bulk.title") }]}
        actions={
          <>
            <a
              href={bulkImportsApi.templateUrl("csv")}
              className={buttonVariants({ variant: "secondary" })}
              download
            >
              <Download size={20} strokeWidth={1.75} aria-hidden />
              {t("bulk.templateCsv")}
            </a>
            <a
              href={bulkImportsApi.templateUrl("xlsx")}
              className={buttonVariants({ variant: "secondary" })}
              download
            >
              <Download size={20} strokeWidth={1.75} aria-hidden />
              {t("bulk.templateXlsx")}
            </a>
          </>
        }
      />

      <div className="space-y-6">
        <Card title={t("bulk.uploadTitle")}>
          <div className="space-y-4">
            {needsDealer ? (
              <FormField label={t("registerUnit.dealer")} required>
                <NativeSelect value={dealerId} onChange={(e) => setDealerId(e.target.value)}>
                  <option value="">—</option>
                  {dealers.data?.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </NativeSelect>
              </FormField>
            ) : null}
            <FileDropzone
              value={files}
              onChange={onFiles}
              maxFiles={1}
              maxSizeMb={5}
              accept={SHEET_TYPES}
              capture={false}
              hint={t("bulk.dropHint")}
              onReject={(m) => m.forEach((msg) => toast.error(msg))}
            />
          </div>
        </Card>

        {batch.data ? (
          <section aria-labelledby="bulk-result" className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <h2 id="bulk-result" className="inline-flex items-center gap-2 text-h3">
                <FileSpreadsheet size={20} strokeWidth={1.75} aria-hidden />
                {batch.data.fileName}
              </h2>
              <Button
                icon={RotateCcw}
                disabled={!errorRows.length}
                loading={resubmit.isPending}
                onClick={onResubmit}
              >
                {t("bulk.resubmit", { count: errorRows.length })}
              </Button>
            </div>
            <p
              className={
                batch.data.counts.errors
                  ? "rounded bg-warning-bg p-3 text-sm text-warning"
                  : "rounded bg-success-bg p-3 text-sm text-success"
              }
            >
              {t("bulk.summary", {
                total: batch.data.counts.total,
                registered: batch.data.counts.registered,
                errors: batch.data.counts.errors,
                review: batch.data.counts.review,
              })}
            </p>
            <DataTable
              caption={t("bulk.rowsCaption")}
              columns={columns}
              data={visibleRows}
              total={visibleRows?.length ?? 0}
              page={1}
              pageSize={200}
              onPageChange={() => {}}
              getRowId={(r) => String(r.rowNumber)}
              emptyMessage={t("bulk.noAttention")}
              toolbar={
                <>
                  <label htmlFor="bulk-show" className="sr-only">
                    {t("bulk.show")}
                  </label>
                  <NativeSelect
                    id="bulk-show"
                    className="w-full sm:w-72"
                    value={show}
                    onChange={(e) => setShow(e.target.value as "all" | "attention")}
                  >
                    <option value="all">{t("bulk.showAll")}</option>
                    <option value="attention">{t("bulk.showAttention")}</option>
                  </NativeSelect>
                </>
              }
            />
          </section>
        ) : null}

        <section aria-labelledby="bulk-history" className="space-y-4">
          <h2 id="bulk-history" className="text-h3">
            {t("bulk.history.title")}
          </h2>
          <DataTable
            caption={t("bulk.history.title")}
            columns={historyColumns}
            data={history.data}
            total={history.data?.length ?? 0}
            page={1}
            pageSize={50}
            onPageChange={() => {}}
            getRowId={(b) => b.id}
            isLoading={history.isLoading}
            error={history.error}
            onRetry={() => void history.refetch()}
            emptyIcon={History}
            emptyMessage={t("bulk.history.empty")}
          />
        </section>
      </div>
    </>
  );
}

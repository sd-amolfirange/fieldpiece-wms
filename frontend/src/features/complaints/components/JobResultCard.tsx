import { createColumnHelper } from "@tanstack/react-table";
import type { JobResultView } from "@wms/domain";
import { Wrench } from "lucide-react";
import { useMemo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Card, DataTable, MonoId } from "@/components/ui";
import { formatDate, formatDateTime } from "@/lib/format";
import { AttachmentGallery } from "./AttachmentGallery";

// Job result from the service system (plan 3.6): parts replaced with old / new serials and the new part's
// warranty, photos and the customer's sign-off. Shown on A08 and, as claim evidence, on A10.

type ReplacedRow = JobResultView["partsReplaced"][number];
const col = createColumnHelper<ReplacedRow>();

function Field({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <dt className="text-overline text-text-muted">{label}</dt>
      <dd className="mt-1 text-body">{children}</dd>
    </div>
  );
}

export function JobResultCard({ job, title }: { job: JobResultView; title?: string }) {
  const { t, i18n } = useTranslation();
  const columns = useMemo(
    () => [
      col.accessor("partType", {
        header: t("jobResult.columns.part"),
        cell: (i) => <span className="font-semibold">{t(`parts.type.${i.getValue()}`)}</span>,
      }),
      col.accessor("oldSerial", {
        header: t("jobResult.columns.oldSerial"),
        cell: (i) => (i.getValue() ? <MonoId>{i.getValue()}</MonoId> : "—"),
      }),
      col.accessor("newSerial", {
        header: t("jobResult.columns.newSerial"),
        cell: (i) => <MonoId>{i.getValue()}</MonoId>,
      }),
      col.accessor("newWarrantyEnd", {
        header: t("jobResult.columns.newWarranty"),
        cell: (i) =>
          i.getValue() ? t("jobResult.until", { date: formatDate(i.getValue(), i18n.language) }) : "—",
      }),
    ],
    [t, i18n.language],
  );

  return (
    <Card title={title ?? t("jobResult.title")}>
      <div className="space-y-6">
        <dl className="grid gap-4 sm:grid-cols-2">
          <Field label={t("jobResult.technician")}>{job.technician}</Field>
          <Field label={t("jobResult.completed")}>{formatDateTime(job.completedAt, i18n.language)}</Field>
          <Field label={t("jobResult.signOff")}>{t("jobResult.signedBy", { name: job.signOffName })}</Field>
          {job.notes ? (
            <Field label={t("jobResult.notes")} className="sm:col-span-2">
              {job.notes}
            </Field>
          ) : null}
        </dl>
        <DataTable
          caption={t("jobResult.partsCaption")}
          columns={columns}
          data={job.partsReplaced}
          total={job.partsReplaced.length}
          page={1}
          pageSize={50}
          onPageChange={() => {}}
          getRowId={(r) => r.newSerial}
          emptyIcon={Wrench}
          emptyMessage={t("jobResult.noParts")}
        />
        <div>
          <h4 className="text-overline mb-2 text-text-muted">{t("jobResult.photos")}</h4>
          <AttachmentGallery attachments={job.photos} />
        </div>
      </div>
    </Card>
  );
}

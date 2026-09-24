import type { RegistrationView } from "@wms/domain";
import { Ban, Check, ExternalLink, FileText, GitMerge } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";
import { ErrorState, Skeleton, toast } from "@/components/feedback";
import { PageHeader } from "@/components/layout";
import {
  Button,
  buttonVariants,
  Card,
  ChannelBadge,
  MonoId,
  RegistrationFlagBadge,
  RegistrationStatusBadge,
  WarrantyStatusBadge,
} from "@/components/ui";
import { toApiError } from "@/lib/api-error";
import { env } from "@/lib/env";
import { formatDate, formatDateTime } from "@/lib/format";
import { RejectRegistrationModal } from "../components/RejectRegistrationModal";
import { useRegistration, useRegistrationDecision } from "../hooks";

// A03 Registration review: the submitted data next to the invoice image, duplicate / model-mismatch warnings,
// and approve, reject with reason, or merge into the existing record.

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-overline text-text-muted">{label}</dt>
      <dd className="mt-1 text-body">{children}</dd>
    </div>
  );
}

function InvoiceCard({ registration }: { registration: RegistrationView }) {
  const { t } = useTranslation();
  const [id] = registration.attachmentIds;
  const url = id ? `${env.apiBaseUrl}/files/${encodeURIComponent(id)}` : undefined;
  return (
    <Card title={t("review.invoice")}>
      {url ? (
        <a href={url} target="_blank" rel="noreferrer" className="block">
          <object
            data={url}
            aria-label={t("review.invoice")}
            className="h-72 w-full rounded bg-ink-50 object-contain"
          >
            <span className="flex h-72 w-full items-center justify-center rounded bg-ink-50">
              <FileText size={24} strokeWidth={1.75} aria-hidden />
            </span>
          </object>
          <span className="mt-2 inline-flex items-center gap-1 text-sm text-info underline underline-offset-2">
            <ExternalLink size={14} strokeWidth={1.75} aria-hidden />
            {t("review.openInvoice")}
          </span>
        </a>
      ) : (
        <p className="text-sm text-text-muted">{t("review.noInvoice")}</p>
      )}
    </Card>
  );
}

export default function RegistrationReviewPage() {
  const { id = "" } = useParams<{ id: string }>();
  const { t, i18n } = useTranslation();
  const query = useRegistration(id);
  const decision = useRegistrationDecision(id);
  const [rejecting, setRejecting] = useState(false);

  if (query.isLoading) {
    return (
      <div className="space-y-4" aria-busy="true">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (query.error || !query.data) {
    return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  }

  const r = query.data;
  const pending = r.status === "PENDING";
  const duplicate = r.flags.includes("DUPLICATE");
  const onError = (e: unknown) => toast.error(toApiError(e).message);

  const actions = pending ? (
    <>
      <Button variant="danger" icon={Ban} onClick={() => setRejecting(true)}>
        {t("review.reject")}
      </Button>
      {duplicate ? (
        <Button
          variant="secondary"
          icon={GitMerge}
          loading={decision.merge.isPending}
          onClick={() =>
            decision.merge.mutate(undefined, { onSuccess: () => toast.success(t("review.merged")), onError })
          }
        >
          {t("review.merge")}
        </Button>
      ) : (
        <Button
          icon={Check}
          loading={decision.approve.isPending}
          onClick={() =>
            decision.approve.mutate(undefined, {
              onSuccess: () => toast.success(t("review.approved"), r.serial),
              onError,
            })
          }
        >
          {t("review.approve")}
        </Button>
      )}
    </>
  ) : r.status === "APPROVED" ? (
    <Link to={`/units/${r.serial}`} className={buttonVariants()}>
      {t("review.openUnit")}
    </Link>
  ) : null;

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: t("inbox.title"), to: "/registrations" }, { label: r.id }]}
        title={<MonoId className="text-h1">{r.serial}</MonoId>}
        meta={
          <>
            <RegistrationStatusBadge status={r.status} />
            <ChannelBadge status={r.channel} />
            {r.flags.map((f) => (
              <RegistrationFlagBadge key={f} status={f} />
            ))}
          </>
        }
        actions={actions}
      />

      {duplicate ? (
        <p role="alert" className="mb-6 rounded border-s-4 border-danger bg-danger-bg p-4 text-body">
          {t("review.duplicateWarning", { serial: r.duplicateOfSerial ?? r.serial })}
        </p>
      ) : null}
      {r.flags.includes("MODEL_MISMATCH") ? (
        <p className="mb-6 rounded bg-warning-bg p-3 text-sm text-warning">
          {t("review.modelMismatchWarning")}
        </p>
      ) : null}
      {r.flags.includes("EXCEPTION") && !duplicate ? (
        <p className="mb-6 rounded bg-warning-bg p-3 text-sm text-warning">
          {t("review.unknownSerialWarning")}
        </p>
      ) : null}
      {r.status === "REJECTED" ? (
        <p className="mb-6 rounded border-s-4 border-danger bg-danger-bg p-4 text-body">
          {t("review.rejectedBecause", { reason: r.rejectReason ?? "" })}
        </p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card title={t("review.submitted")}>
            <dl className="grid gap-4 sm:grid-cols-2">
              <Field label={t("review.fields.serial")}>
                <MonoId>{r.serial}</MonoId>
              </Field>
              <Field label={t("review.fields.model")}>{r.modelCode}</Field>
              <Field label={t("review.fields.customer")}>{r.customer.name}</Field>
              <Field label={t("review.fields.phone")}>{r.customer.phone ?? "—"}</Field>
              <Field label={t("review.fields.email")}>{r.customer.email ?? "—"}</Field>
              <Field label={t("review.fields.city")}>{r.customer.city ?? "—"}</Field>
              <Field label={t("review.fields.installDate")}>
                {formatDate(r.installDate, i18n.language) || "—"}
              </Field>
              <Field label={t("review.fields.purchaseDate")}>
                {formatDate(r.purchaseDate, i18n.language) || "—"}
              </Field>
              <Field label={t("review.fields.invoiceNumber")}>{r.invoiceNumber ?? "—"}</Field>
              <Field label={t("review.fields.dealer")}>{r.dealerName ?? "—"}</Field>
              <Field label={t("review.fields.submittedBy")}>
                {r.submittedByName} · {formatDateTime(r.submittedAt, i18n.language)}
              </Field>
              {r.reviewedByName ? (
                <Field label={t("review.fields.reviewedBy")}>
                  {r.reviewedByName} · {formatDateTime(r.reviewedAt, i18n.language)}
                </Field>
              ) : null}
            </dl>
          </Card>

          {r.duplicateOf ? (
            <Card
              title={t("review.existingRecord")}
              actions={
                <Link
                  to={`/units/${r.duplicateOf.serial}`}
                  className="text-sm text-info underline underline-offset-2"
                >
                  {t("review.openExisting")}
                </Link>
              }
            >
              <dl className="grid gap-4 sm:grid-cols-2">
                <Field label={t("review.fields.serial")}>
                  <MonoId>{r.duplicateOf.serial}</MonoId>
                </Field>
                <Field label={t("review.fields.model")}>{r.duplicateOf.modelCode}</Field>
                <Field label={t("review.fields.customer")}>{r.duplicateOf.customerName ?? "—"}</Field>
                <Field label={t("review.fields.dealer")}>{r.duplicateOf.dealerName ?? "—"}</Field>
                <Field label={t("review.fields.installDate")}>
                  {formatDate(r.duplicateOf.installDate, i18n.language) || "—"}
                </Field>
                <Field label={t("review.fields.warranty")}>
                  <WarrantyStatusBadge status={r.duplicateOf.status} />
                </Field>
              </dl>
            </Card>
          ) : null}
        </div>

        <InvoiceCard registration={r} />
      </div>

      <RejectRegistrationModal
        open={rejecting}
        onOpenChange={setRejecting}
        pending={decision.reject.isPending}
        defaultReason={duplicate ? t("review.duplicateReason", { serial: r.serial }) : undefined}
        onConfirm={(reason) =>
          decision.reject.mutate(reason, {
            onSuccess: () => {
              setRejecting(false);
              toast.success(t("review.rejected"));
            },
            onError,
          })
        }
      />
    </>
  );
}

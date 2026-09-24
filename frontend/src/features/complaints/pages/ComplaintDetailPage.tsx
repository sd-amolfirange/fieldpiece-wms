import type { ComplaintStatus, ComplaintView } from "@wms/domain";
import { CheckCircle2, Circle, ClipboardList, Send, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";
import { ErrorState, Skeleton, toast } from "@/components/feedback";
import { PageHeader } from "@/components/layout";
import {
  Button,
  Card,
  ClaimStatusBadge,
  ComplaintSourceBadge,
  ComplaintStatusBadge,
  MonoId,
  Timeline,
  type TimelineItem,
} from "@/components/ui";
import { toApiError } from "@/lib/api-error";
import { formatDate, formatDateTime } from "@/lib/format";
import { can } from "@/lib/permissions";
import { useCurrentRole } from "@/lib/session";
import { AttachmentGallery } from "../components/AttachmentGallery";
import { EntitlementPanel } from "../components/EntitlementPanel";
import { JobResultCard } from "../components/JobResultCard";
import { useComplaint, useSendToService } from "../hooks";

// A08 Complaint detail (admin: entitlement, send to service, job result) and CU05 Complaint tracking (customer,
// phone layout: raised -> with service -> resolved, and the new part's warranty after the repair).

const STEPS: ComplaintStatus[] = ["NEW", "WITH_SERVICE", "RESOLVED"];

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-overline text-text-muted">{label}</dt>
      <dd className="mt-1 text-body">{children}</dd>
    </div>
  );
}

/** raised -> with service -> resolved, with the steps still to come shown as waiting. */
function ProgressTimeline({ complaint }: { complaint: ComplaintView }) {
  const { t, i18n } = useTranslation();
  const items: TimelineItem[] = STEPS.map((step) => {
    const event = complaint.history.find((e) => e.status === step);
    return {
      id: step,
      icon: event ? CheckCircle2 : Circle,
      actor: t(`complaints.step.${step}`),
      action: event ? t("complaints.stepBy", { name: event.byName }) : "",
      timestamp: event ? formatDateTime(event.at, i18n.language) : t("complaints.stepWaiting"),
    };
  });
  return <Timeline items={items} />;
}

/** "New compressor CP-… is covered until …" for every part replaced in the repair. */
function NewPartWarranty({ complaint }: { complaint: ComplaintView }) {
  const { t, i18n } = useTranslation();
  if (!complaint.jobResult) return null;
  return (
    <>
      {complaint.jobResult.partsReplaced.map((p) => (
        <p
          key={p.newSerial}
          className="mb-6 flex items-center gap-2 rounded bg-success-bg p-3 text-body text-success"
        >
          <ShieldCheck size={20} strokeWidth={1.75} aria-hidden />
          {t("complaints.newPartWarranty", {
            part: t(`parts.type.${p.partType}`),
            serial: p.newSerial,
            date: formatDate(p.newWarrantyEnd, i18n.language),
          })}
        </p>
      ))}
    </>
  );
}

export default function ComplaintDetailPage() {
  const { id = "" } = useParams<{ id: string }>();
  const { t, i18n } = useTranslation();
  const role = useCurrentRole();
  const query = useComplaint(id);
  const send = useSendToService(id);

  if (query.isLoading) {
    return (
      <div className="space-y-4" aria-busy="true">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (query.error || !query.data)
    return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;

  const c = query.data;
  const isCustomer = role === "customer";
  const canSend = can(role, "complaints:send") && c.status === "NEW";
  const listLabel = isCustomer
    ? t("nav.myComplaints")
    : role === "admin"
      ? t("complaints.title")
      : t("nav.complaintsAndClaims");

  const header = (
    <PageHeader
      breadcrumbs={[{ label: listLabel, to: "/complaints" }, { label: c.id }]}
      title={<MonoId className="text-h1">{c.id}</MonoId>}
      meta={
        <>
          <ComplaintStatusBadge status={c.status} />
          {isCustomer ? null : <ComplaintSourceBadge status={c.source} />}
          {c.source === "DEALER" && c.dealerName && !isCustomer ? (
            <span className="text-sm">{c.dealerName}</span>
          ) : null}
          <span className="text-sm text-text-muted">
            <Link to={`/units/${c.unitSerial}`} className="underline-offset-2 hover:underline">
              <MonoId>{c.unitSerial}</MonoId>
            </Link>{" "}
            · {c.modelName}
          </span>
        </>
      }
      actions={
        canSend ? (
          <Button
            icon={Send}
            loading={send.isPending}
            onClick={() =>
              send.mutate(undefined, {
                onSuccess: (r) => toast.success(t("complaints.sent"), r.serviceRequestId),
                onError: (e) => toast.error(toApiError(e).message),
              })
            }
          >
            {t("complaints.sendToService")}
          </Button>
        ) : null
      }
    />
  );

  const details = (
    <Card title={t("complaints.details")}>
      <div className="space-y-6">
        <dl className="grid gap-4 sm:grid-cols-2">
          <Field label={t("complaints.fields.received")}>{formatDateTime(c.createdAt, i18n.language)}</Field>
          <Field label={t("complaints.fields.raisedBy")}>{c.raisedByName}</Field>
          {isCustomer ? null : (
            <>
              <Field label={t("complaints.fields.customer")}>{c.customerName ?? "—"}</Field>
              <Field label={t("complaints.fields.dealer")}>{c.dealerName ?? "—"}</Field>
              <Field label={t("complaints.fields.serviceRequest")}>
                {c.serviceRequestId ? <MonoId>{c.serviceRequestId}</MonoId> : "—"}
              </Field>
            </>
          )}
          <div className="sm:col-span-2">
            <Field label={t("complaints.fields.fault")}>{c.description}</Field>
          </div>
        </dl>
        <div>
          <h4 className="text-overline mb-2 text-text-muted">{t("complaints.photos")}</h4>
          <AttachmentGallery attachments={c.attachments} />
        </div>
      </div>
    </Card>
  );

  if (isCustomer) {
    return (
      <div className="mx-auto max-w-xl">
        {header}
        <NewPartWarranty complaint={c} />
        <div className="space-y-6">
          <Card title={t("complaints.progress")}>
            <ProgressTimeline complaint={c} />
          </Card>
          <EntitlementPanel entitlement={c.entitlement} />
          {details}
        </div>
      </div>
    );
  }

  return (
    <>
      {header}
      <NewPartWarranty complaint={c} />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {details}
          {c.jobResult ? <JobResultCard job={c.jobResult} /> : null}
        </div>
        <div className="space-y-6">
          <EntitlementPanel entitlement={c.entitlement} />
          <Card title={t("complaints.progress")}>
            <ProgressTimeline complaint={c} />
          </Card>
          {c.claimId ? (
            <Card title={t("complaints.claim")}>
              <p className="flex flex-wrap items-center gap-3">
                <ClipboardList size={20} strokeWidth={1.75} aria-hidden />
                {role === "admin" ? (
                  <Link to={`/claims/${c.claimId}`} className="underline-offset-2 hover:underline">
                    <MonoId>{c.claimId}</MonoId>
                  </Link>
                ) : (
                  <MonoId>{c.claimId}</MonoId>
                )}
                {c.claimStatus ? <ClaimStatusBadge status={c.claimStatus} /> : null}
              </p>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}

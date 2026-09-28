import { claimActionsFor, type ClaimActionName, type ClaimStatus, type WarrantyClaimView } from "@wms/domain";
import { Ban, Check, CheckCircle2, Circle, ClipboardCheck, Eye, Send, ShieldCheck } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";
import { ErrorState, Skeleton, toast } from "@/components/feedback";
import { PageHeader } from "@/components/layout";
import {
  Button,
  Card,
  ClaimSourceBadge,
  ClaimStatusBadge,
  MonoId,
  ProductThumb,
  Timeline,
  WarrantyStatusBadge,
  type TimelineItem,
} from "@/components/ui";
import { toApiError } from "@/lib/api-error";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { useCurrentRole, useCurrentUser } from "@/lib/session";
import type { ClaimActionBody } from "../api";
import { AttachmentGallery } from "../components/AttachmentGallery";
import { ApproveClaimModal, CloseClaimModal, RejectClaimModal } from "../components/ClaimActionModals";
import { CoveragePanel } from "../components/CoveragePanel";
import { useClaim, useClaimAction } from "../hooks";

// A10 Warranty claim (warranty desk: coverage, evidence and the actions the claim state machine allows) and
// CU05 / DL07 claim tracking (submitted -> in review -> approved -> closed, and the outcome).

const ACTION_ICON = { start_review: Eye, approve: Check, reject: Ban, close: ClipboardCheck } as const;
const STEPS: ClaimStatus[] = ["SUBMITTED", "IN_REVIEW", "APPROVED", "CLOSED"];

function Field({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <dt className="text-overline text-text-muted">{label}</dt>
      <dd className="mt-1 text-body">{children}</dd>
    </div>
  );
}

/** Each step with who took it and when; steps still to come are shown as waiting. */
function ProgressTimeline({ claim }: { claim: WarrantyClaimView }) {
  const { t, i18n } = useTranslation();
  const steps: ClaimStatus[] = claim.status === "REJECTED" ? [...STEPS.slice(0, 2), "REJECTED"] : STEPS;
  const items: TimelineItem[] = steps
    .map((step) => ({ step, event: claim.history.find((e) => e.status === step) }))
    .filter(({ step, event }) => event || claim.status !== "REJECTED" || step === "REJECTED")
    .map(({ step, event }) => ({
      id: step,
      icon: event ? CheckCircle2 : Circle,
      actor: t(`status.claim.${step}`),
      action: event ? t("claims.stepBy", { name: event.byName }) : "",
      timestamp: event ? formatDateTime(event.at, i18n.language) : t("claims.stepWaiting"),
      comment: event?.text,
    }));
  return <Timeline items={items} />;
}

/** The settlement once a claim is approved or closed. */
function Outcome({ claim, currency }: { claim: WarrantyClaimView; currency: string }) {
  const { t, i18n } = useTranslation();
  if (!claim.resolution || (claim.status !== "APPROVED" && claim.status !== "CLOSED")) return null;
  const closed = claim.status === "CLOSED";
  const text =
    claim.resolution === "CREDIT"
      ? t(closed ? "claims.outcome.CREDIT" : "claims.outcome.approvedCredit", {
          amount: formatMoney(claim.creditAmount ?? 0, currency, i18n.language),
        })
      : claim.resolution === "REPLACE" && claim.replacementSerial
        ? t("claims.outcome.REPLACE", { serial: claim.replacementSerial })
        : t(closed ? `claims.outcome.${claim.resolution}` : `claims.outcome.approved${claim.resolution}`);
  return (
    <p className="mb-6 flex items-center gap-2 rounded bg-success-bg p-3 text-body text-success">
      <ShieldCheck size={20} strokeWidth={1.75} aria-hidden />
      {claim.resolution === "REPLACE" && claim.replacementSerial ? (
        <Link to={`/units/${claim.replacementSerial}`} className="underline-offset-2 hover:underline">
          {text}
        </Link>
      ) : (
        text
      )}
    </p>
  );
}

export default function ClaimDetailPage() {
  const { id = "" } = useParams<{ id: string }>();
  const { t, i18n } = useTranslation();
  const role = useCurrentRole();
  const currency = useCurrentUser()?.currency ?? "USD";
  const query = useClaim(id);
  const act = useClaimAction(id);
  const [modal, setModal] = useState<"approve" | "reject" | "close" | null>(null);

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
  const actions = role === "admin" ? claimActionsFor(c.status, "admin") : [];
  const run = (action: ClaimActionName, extra: Omit<ClaimActionBody, "action"> = {}) =>
    act.mutate(
      { action, ...extra },
      {
        onSuccess: () => {
          setModal(null);
          toast.success(t(`claims.done.${action}`), c.id);
        },
        onError: (e) => toast.error(toApiError(e).message),
      },
    );

  const header = (
    <PageHeader
      breadcrumbs={[
        { label: isCustomer ? t("nav.myClaims") : t("claims.title"), to: "/claims" },
        { label: c.id },
      ]}
      title={<MonoId className="text-h1">{c.id}</MonoId>}
      meta={
        <>
          <ClaimStatusBadge status={c.status} />
          {isCustomer ? null : <ClaimSourceBadge status={c.source} />}
          <span className="text-sm text-text-muted">
            <Link to={`/units/${c.unitSerial}`} className="underline-offset-2 hover:underline">
              <MonoId>{c.unitSerial}</MonoId>
            </Link>{" "}
            · {c.modelName}
          </span>
        </>
      }
      actions={
        actions.length ? (
          <>
            {[...actions]
              .sort((a, b) => (a.tone === "primary" ? 1 : 0) - (b.tone === "primary" ? 1 : 0))
              .map((a) => (
                <Button
                  key={a.action}
                  icon={ACTION_ICON[a.action] ?? Send}
                  variant={a.tone === "danger" ? "danger" : a.tone === "secondary" ? "secondary" : "primary"}
                  loading={act.isPending && act.variables?.action === a.action}
                  onClick={() => (a.action === "start_review" ? run(a.action) : setModal(a.action))}
                >
                  {t(`claims.actions.${a.action}`)}
                </Button>
              ))}
          </>
        ) : null
      }
    />
  );

  const rejected =
    c.status === "REJECTED" && c.rejectReason ? (
      <p className="mb-6 rounded border-s-4 border-danger bg-danger-bg p-4 text-body">
        {t("claims.rejectedBecause", { reason: c.rejectReason })}
      </p>
    ) : null;

  const details = (
    <Card title={t("claims.details")}>
      <div className="space-y-6">
        <dl className="grid gap-4 sm:grid-cols-2">
          <Field label={t("claims.fields.filed")}>{formatDateTime(c.createdAt, i18n.language)}</Field>
          <Field label={t("claims.fields.raisedBy")}>{c.raisedByName}</Field>
          <Field label={t("claims.fields.issue")}>{t(`claims.issue.${c.issueType}`)}</Field>
          {c.resolution ? (
            <Field label={t("claims.fields.resolution")}>
              {t(`claims.resolution.${c.resolution}`)}
              {c.resolution === "CREDIT" && c.creditAmount ? (
                <span className="block text-sm tabular-nums text-text-muted">
                  {formatMoney(c.creditAmount, currency, i18n.language)}
                </span>
              ) : null}
            </Field>
          ) : null}
          {isCustomer ? null : (
            <>
              <Field label={t("claims.fields.customer")}>{c.customerName ?? "—"}</Field>
              <Field label={t("claims.fields.dealer")}>{c.dealerName ?? "—"}</Field>
            </>
          )}
          <Field label={t("claims.fields.description")} className="sm:col-span-2">
            {c.description}
          </Field>
          {c.decisionNote ? (
            <Field label={t("claims.fields.decisionNote")} className="sm:col-span-2">
              {c.decisionNote}
            </Field>
          ) : null}
        </dl>
        <div>
          <h4 className="text-overline mb-2 text-text-muted">{t("claims.fields.evidence")}</h4>
          <AttachmentGallery attachments={c.attachments} />
        </div>
      </div>
    </Card>
  );

  const product = (
    <Card title={t("claims.product")}>
      <div className="mb-4 flex gap-4">
        <ProductThumb imageUrl={c.modelImageUrl} />
        <div className="min-w-0 flex-1">
          <p className="text-body font-medium">
            {c.modelName} <MonoId>{c.modelCode}</MonoId>
          </p>
          <p className="text-sm text-text-muted">{c.categoryName}</p>
        </div>
      </div>
      <dl className="grid gap-4 sm:grid-cols-2">
        <Field label={t("claims.fields.serial")}>
          <Link to={`/units/${c.unitSerial}`} className="underline-offset-2 hover:underline">
            <MonoId>{c.unitSerial}</MonoId>
          </Link>
        </Field>
        <Field label={t("claims.fields.batch")}>
          {c.batchNumber ? <MonoId>{c.batchNumber}</MonoId> : "—"}
        </Field>
        <Field label={t("claims.fields.model")} className="sm:col-span-2">
          {c.modelName} <MonoId>{c.modelCode}</MonoId>
          <span className="block text-sm text-text-muted">{c.categoryName}</span>
        </Field>
        <Field label={t("claims.fields.purchased")}>{formatDate(c.purchaseDate, i18n.language) || "—"}</Field>
        <Field label={t("claims.fields.warrantyEnd")}>
          {formatDate(c.warrantyEnd, i18n.language) || "—"}
        </Field>
        <Field label={t("claims.fields.warrantyToday")}>
          <WarrantyStatusBadge status={c.warrantyStatus} />
        </Field>
      </dl>
    </Card>
  );

  const coverage = <CoveragePanel coverage={c.coverage} title={t("coverage.atFiling")} />;
  const progress = (
    <Card title={t("claims.progress")}>
      <ProgressTimeline claim={c} />
    </Card>
  );

  const modals =
    role === "admin" ? (
      <>
        <ApproveClaimModal
          open={modal === "approve"}
          onOpenChange={(open) => setModal(open ? "approve" : null)}
          pending={act.isPending}
          currency={currency}
          onConfirm={(values) => run("approve", values)}
        />
        <RejectClaimModal
          open={modal === "reject"}
          onOpenChange={(open) => setModal(open ? "reject" : null)}
          pending={act.isPending}
          onConfirm={(reason) => run("reject", { reason })}
        />
        <CloseClaimModal
          open={modal === "close"}
          onOpenChange={(open) => setModal(open ? "close" : null)}
          pending={act.isPending}
          resolution={c.resolution}
          onConfirm={(values) => run("close", values)}
        />
      </>
    ) : null;

  if (isCustomer) {
    return (
      <div className="mx-auto max-w-xl">
        {header}
        {rejected}
        <Outcome claim={c} currency={currency} />
        <div className="space-y-6">
          {progress}
          {coverage}
          {details}
        </div>
      </div>
    );
  }

  return (
    <>
      {header}
      {rejected}
      <Outcome claim={c} currency={currency} />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {details}
          {product}
        </div>
        <div className="space-y-6">
          {coverage}
          {progress}
        </div>
      </div>
      {modals}
    </>
  );
}

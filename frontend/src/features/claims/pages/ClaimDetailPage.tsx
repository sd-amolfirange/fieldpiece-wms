import { claimActionsFor, type ClaimActionName } from "@wms/domain";
import { ArrowRightLeft, Ban, Check, FilePlus2, IndianRupee, Send } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";
import { ErrorState, Skeleton, toast } from "@/components/feedback";
import { PageHeader } from "@/components/layout";
import {
  Button,
  Card,
  ClaimStatusBadge,
  FinancePostingBadge,
  MonoId,
  Timeline,
  type TimelineItem,
} from "@/components/ui";
import { JobResultCard } from "@/features/complaints";
import { toApiError } from "@/lib/api-error";
import { formatDateTime, formatMoney } from "@/lib/format";
import { useCurrentRole, useCurrentUser } from "@/lib/session";
import { RejectClaimModal, SubmitClaimModal } from "../components/ClaimActionModals";
import { useClaim, useClaimAction } from "../hooks";

// A10 Claim detail: evidence pulled from the job result (no re-keying), RMA number and amount, the actions the
// claim state machine allows (submit, approve, reject, mark paid) and the Finance posting status.

const ACTION_ICON = { submit: Send, approve: Check, reject: Ban, mark_paid: IndianRupee } as const;
const HISTORY_ICON = {
  DRAFT: FilePlus2,
  SUBMITTED: Send,
  APPROVED: Check,
  PAID: IndianRupee,
  REJECTED: Ban,
} as const;

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-overline text-text-muted">{label}</dt>
      <dd className="mt-1 text-body">{children}</dd>
    </div>
  );
}

export default function ClaimDetailPage() {
  const { id = "" } = useParams<{ id: string }>();
  const { t, i18n } = useTranslation();
  const role = useCurrentRole();
  const currency = useCurrentUser()?.currency ?? "INR";
  const query = useClaim(id);
  const act = useClaimAction(id);
  const [modal, setModal] = useState<"submit" | "reject" | null>(null);

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
  const actions = role === "admin" ? claimActionsFor(c.status, "admin") : [];
  const run = (
    action: ClaimActionName,
    extra: { rmaNumber?: string; amount?: number; reason?: string } = {},
  ) =>
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

  const history: TimelineItem[] = [...c.history].reverse().map((e, index) => ({
    id: `${e.at}-${index}`,
    icon: HISTORY_ICON[e.status] ?? ArrowRightLeft,
    actor: e.byName,
    action: `→ ${t(`status.claim.${e.status}`)}`,
    timestamp: formatDateTime(e.at, i18n.language),
    comment: e.text,
  }));

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: t("claims.title"), to: "/claims" }, { label: c.id }]}
        title={<MonoId className="text-h1">{c.id}</MonoId>}
        meta={
          <>
            <ClaimStatusBadge status={c.status} />
            <FinancePostingBadge status={c.financePosting} />
            <span className="text-sm text-text-muted">{c.brandName}</span>
          </>
        }
        actions={
          <>
            {[...actions]
              .sort((a, b) => (a.tone === "primary" ? 1 : 0) - (b.tone === "primary" ? 1 : 0))
              .map((a) => (
                <Button
                  key={a.action}
                  icon={ACTION_ICON[a.action]}
                  variant={a.tone === "danger" ? "danger" : a.tone === "secondary" ? "secondary" : "primary"}
                  loading={act.isPending && act.variables?.action === a.action}
                  onClick={() =>
                    a.action === "submit"
                      ? setModal("submit")
                      : a.action === "reject"
                        ? setModal("reject")
                        : run(a.action)
                  }
                >
                  {t(`claims.actions.${a.action}`)}
                </Button>
              ))}
          </>
        }
      />

      {c.status === "REJECTED" && c.rejectReason ? (
        <p className="mb-6 rounded border-s-4 border-danger bg-danger-bg p-4 text-body">
          {t("claims.rejectedBecause", { reason: c.rejectReason })}
        </p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card title={t("claims.details")}>
            <dl className="grid gap-4 sm:grid-cols-2">
              <Field label={t("claims.fields.brand")}>{c.brandName}</Field>
              <Field label={t("claims.fields.unit")}>
                <Link to={`/units/${c.unitSerial}`} className="underline-offset-2 hover:underline">
                  <MonoId>{c.unitSerial}</MonoId>
                </Link>{" "}
                · {c.modelCode}
              </Field>
              <Field label={t("claims.fields.customer")}>{c.customerName ?? "—"}</Field>
              <Field label={t("claims.fields.dealer")}>{c.dealerName ?? "—"}</Field>
              <Field label={t("claims.fields.complaint")}>
                {c.complaintId ? (
                  <Link to={`/complaints/${c.complaintId}`} className="underline-offset-2 hover:underline">
                    <MonoId>{c.complaintId}</MonoId>
                  </Link>
                ) : (
                  "—"
                )}
                {c.complaintDescription ? (
                  <span className="block text-sm text-text-muted">{c.complaintDescription}</span>
                ) : null}
              </Field>
              <Field label={t("claims.fields.created")}>{formatDateTime(c.createdAt, i18n.language)}</Field>
              <Field label={t("claims.fields.rma")}>
                {c.rmaNumber ? <MonoId>{c.rmaNumber}</MonoId> : "—"}
              </Field>
              <Field label={t("claims.fields.amount")}>
                {c.amount ? (
                  <span className="tabular-nums">{formatMoney(c.amount, currency, i18n.language)}</span>
                ) : (
                  "—"
                )}
              </Field>
            </dl>
          </Card>
          {c.jobResult ? (
            <JobResultCard job={c.jobResult} title={t("claims.evidence")} />
          ) : (
            <Card title={t("claims.evidence")}>
              <p className="text-sm text-text-muted">{t("claims.noEvidence")}</p>
            </Card>
          )}
        </div>
        <div className="space-y-6">
          <Card title={t("claims.finance")}>
            <div className="space-y-2">
              <FinancePostingBadge status={c.financePosting} />
              <p className="text-sm text-text-muted">{t(`claims.financeHelp.${c.financePosting}`)}</p>
            </div>
          </Card>
          <Card title={t("claims.history")}>
            <Timeline items={history} />
          </Card>
        </div>
      </div>

      <SubmitClaimModal
        open={modal === "submit"}
        onOpenChange={(open) => setModal(open ? "submit" : null)}
        pending={act.isPending}
        defaultRma={c.rmaNumber}
        onConfirm={(values) => run("submit", values)}
      />
      <RejectClaimModal
        open={modal === "reject"}
        onOpenChange={(open) => setModal(open ? "reject" : null)}
        pending={act.isPending}
        onConfirm={(reason) => run("reject", { reason })}
      />
    </>
  );
}

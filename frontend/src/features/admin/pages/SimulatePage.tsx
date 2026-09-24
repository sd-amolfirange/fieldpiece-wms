import type { PartType } from "@wms/domain";
import { Ban, Check, RotateCcw, Wrench } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "@/components/feedback";
import { PageHeader } from "@/components/layout";
import { Button, Card, FormField, Input, Modal, NativeSelect } from "@/components/ui";
import { toApiError } from "@/lib/api-error";
import { AdminTabs } from "../components/AdminTabs";
import { useComplaintsWithService, useSimulator, useSubmittedClaims } from "../hooks";

// A13 Simulate panel (demo only): stand-ins for the systems around the WMS. Phase 3 has the service system's
// job result and the manufacturer's decision; the ERP invoice and the registration email come in Phase 5.

type ReplaceablePart = Exclude<PartType, "UNIT">;
const PARTS: ReplaceablePart[] = ["COMPRESSOR", "PCB"];

function JobResultCard() {
  const { t } = useTranslation();
  const complaints = useComplaintsWithService();
  const { jobResult } = useSimulator();
  const [complaintId, setComplaintId] = useState("");
  const [partType, setPartType] = useState<ReplaceablePart>("COMPRESSOR");
  const selected = complaintId || complaints.data?.[0]?.id || "";

  return (
    <Card title={t("simulate.jobResult.title")}>
      <div className="space-y-4">
        <p className="text-sm text-text-muted">{t("simulate.jobResult.help")}</p>
        <FormField label={t("simulate.jobResult.complaint")}>
          <NativeSelect
            value={selected}
            onChange={(e) => setComplaintId(e.target.value)}
            disabled={!complaints.data?.length}
          >
            {complaints.data?.length ? (
              complaints.data.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.id} · {c.unitSerial} · {c.customerName ?? c.dealerName ?? ""}
                </option>
              ))
            ) : (
              <option value="">{t("simulate.jobResult.none")}</option>
            )}
          </NativeSelect>
        </FormField>
        <FormField label={t("simulate.jobResult.part")}>
          <NativeSelect value={partType} onChange={(e) => setPartType(e.target.value as ReplaceablePart)}>
            {PARTS.map((p) => (
              <option key={p} value={p}>
                {t(`parts.type.${p}`)}
              </option>
            ))}
          </NativeSelect>
        </FormField>
        <Button
          icon={Wrench}
          disabled={!selected}
          loading={jobResult.isPending}
          onClick={() =>
            jobResult.mutate(
              { complaintId: selected, partType },
              {
                onSuccess: (c) => {
                  setComplaintId("");
                  toast.success(
                    t("simulate.jobResult.done"),
                    c.claimId ? t("simulate.jobResult.claim", { id: c.claimId }) : c.id,
                  );
                },
                onError: (e) => toast.error(toApiError(e).message),
              },
            )
          }
        >
          {t("simulate.jobResult.send")}
        </Button>
      </div>
    </Card>
  );
}

function OemDecisionCard() {
  const { t } = useTranslation();
  const claims = useSubmittedClaims();
  const { oemDecision } = useSimulator();
  const [claimId, setClaimId] = useState("");
  const [reason, setReason] = useState("");
  const selected = claimId || claims.data?.[0]?.id || "";

  const decide = (decision: "APPROVED" | "REJECTED") =>
    oemDecision.mutate(
      { claimId: selected, decision, reason: reason.trim() || undefined },
      {
        onSuccess: (c) => {
          setClaimId("");
          setReason("");
          toast.success(t(`simulate.oem.done.${decision}`), c.id);
        },
        onError: (e) => toast.error(toApiError(e).message),
      },
    );

  return (
    <Card title={t("simulate.oem.title")}>
      <div className="space-y-4">
        <p className="text-sm text-text-muted">{t("simulate.oem.help")}</p>
        <FormField label={t("simulate.oem.claim")}>
          <NativeSelect
            value={selected}
            onChange={(e) => setClaimId(e.target.value)}
            disabled={!claims.data?.length}
          >
            {claims.data?.length ? (
              claims.data.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.id} · {c.brandName} · {c.unitSerial}
                </option>
              ))
            ) : (
              <option value="">{t("simulate.oem.none")}</option>
            )}
          </NativeSelect>
        </FormField>
        <FormField label={t("simulate.oem.reason")} helper={t("simulate.oem.reasonHelp")}>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} />
        </FormField>
        <div className="flex flex-wrap gap-2">
          <Button
            icon={Check}
            disabled={!selected}
            loading={oemDecision.isPending && oemDecision.variables?.decision === "APPROVED"}
            onClick={() => decide("APPROVED")}
          >
            {t("simulate.oem.approve")}
          </Button>
          <Button
            variant="danger"
            icon={Ban}
            disabled={!selected}
            loading={oemDecision.isPending && oemDecision.variables?.decision === "REJECTED"}
            onClick={() => decide("REJECTED")}
          >
            {t("simulate.oem.reject")}
          </Button>
        </div>
      </div>
    </Card>
  );
}

function ResetCard() {
  const { t } = useTranslation();
  const { reset } = useSimulator();
  const [open, setOpen] = useState(false);
  return (
    <Card title={t("simulate.reset.title")}>
      <div className="space-y-4">
        <p className="text-sm text-text-muted">{t("simulate.reset.help")}</p>
        <Button variant="danger" icon={RotateCcw} onClick={() => setOpen(true)}>
          {t("simulate.reset.button")}
        </Button>
      </div>
      <Modal
        open={open}
        onOpenChange={setOpen}
        title={t("simulate.reset.confirmTitle")}
        description={t("simulate.reset.confirmHelp")}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="danger"
              loading={reset.isPending}
              onClick={() =>
                reset.mutate(undefined, {
                  onSuccess: () => {
                    setOpen(false);
                    toast.success(t("simulate.reset.done"));
                  },
                  onError: (e) => toast.error(toApiError(e).message),
                })
              }
            >
              {t("simulate.reset.button")}
            </Button>
          </>
        }
      >
        {null}
      </Modal>
    </Card>
  );
}

export default function SimulatePage() {
  const { t } = useTranslation();
  return (
    <>
      <PageHeader
        title={t("simulate.title")}
        breadcrumbs={[{ label: t("nav.dashboard"), to: "/" }, { label: t("simulate.title") }]}
      />
      <AdminTabs />
      <p className="mb-6 text-body text-text-muted">{t("simulate.intro")}</p>
      <div className="grid gap-6 lg:grid-cols-2">
        <JobResultCard />
        <OemDecisionCard />
        <ResetCard />
      </div>
    </>
  );
}

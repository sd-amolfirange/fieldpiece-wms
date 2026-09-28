import type { ClaimStatus } from "@wms/domain";
import { ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/cn";

// Status tracker per claim: submitted > in review > approved > closed, steps reached in bold.
// A rejected claim shows its last step followed by "Rejected".

const STEPS: ClaimStatus[] = ["SUBMITTED", "IN_REVIEW", "APPROVED", "CLOSED"];

export function ClaimTracker({
  status,
  history,
}: {
  status: ClaimStatus;
  history?: { status: ClaimStatus }[];
}) {
  const { t } = useTranslation();
  const rejected = status === "REJECTED";
  const reached = rejected
    ? Math.max(0, ...(history ?? []).map((e) => STEPS.indexOf(e.status)))
    : STEPS.indexOf(status);
  const steps = rejected ? [...STEPS.slice(0, reached + 1), "REJECTED" as const] : STEPS;
  return (
    <ol className="flex flex-wrap items-center gap-1 text-sm" aria-label={t("claims.trackerLabel")}>
      {steps.map((step, index) => (
        <li
          key={step}
          aria-current={step === status || (!rejected && index === reached) ? "step" : undefined}
          className={cn(
            "flex items-center gap-1 whitespace-nowrap",
            rejected || index <= reached ? "font-semibold text-text" : "text-text-muted",
          )}
        >
          {index > 0 ? (
            <ChevronRight size={14} strokeWidth={1.75} aria-hidden className="text-ink-400" />
          ) : null}
          {t(`status.claim.${step}`)}
        </li>
      ))}
    </ol>
  );
}

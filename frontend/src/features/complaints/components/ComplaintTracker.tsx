import type { ComplaintStatus } from "@wms/domain";
import { ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/cn";

// DL07 status tracker per complaint: raised > with service > resolved, steps reached in bold.

const STEPS: ComplaintStatus[] = ["NEW", "WITH_SERVICE", "RESOLVED"];

export function ComplaintTracker({ status }: { status: ComplaintStatus }) {
  const { t } = useTranslation();
  const reached = STEPS.indexOf(status);
  return (
    <ol className="flex flex-wrap items-center gap-1 text-sm" aria-label={t("complaints.trackerLabel")}>
      {STEPS.map((step, index) => (
        <li
          key={step}
          aria-current={index === reached ? "step" : undefined}
          className={cn(
            "flex items-center gap-1 whitespace-nowrap",
            index <= reached ? "font-semibold text-text" : "text-text-muted",
          )}
        >
          {index > 0 ? (
            <ChevronRight size={14} strokeWidth={1.75} aria-hidden className="text-ink-400" />
          ) : null}
          {t(`complaints.step.${step}`)}
        </li>
      ))}
    </ol>
  );
}

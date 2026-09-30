import type { ExtensionQuote, UnitView } from "@wms/domain";
import { CalendarPlus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "@/components/feedback";
import { Button, Modal } from "@/components/ui";
import { toApiError } from "@/lib/api-error";
import { cn } from "@/lib/cn";
import { formatDate, formatMoney } from "@/lib/format";
import { useCurrentUser } from "@/lib/session";
import { useExtendWarranty, useExtensionQuote } from "../hooks";

// Extended warranty (A05 / DL05 / CU03): pick 12, 24 or 36 more months; the price comes from the model's list
// price and the new end date is shown before confirming. The server re-checks eligibility, records the sale for
// Finance, and notifies the owner and the dealer. Hidden when the product can't be extended (void, replaced, expired,
// not registered or already at the maximum).

export function ExtendWarrantyButton({ unit }: { unit: UnitView }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const running = unit.status === "ACTIVE" || unit.status === "EXPIRING_SOON";
  const quote = useExtensionQuote(unit.serial, running && !unit.void && !unit.replacedBySerial);
  if (!quote.data?.eligible) return null;
  return (
    <>
      <Button variant="secondary" icon={CalendarPlus} onClick={() => setOpen(true)}>
        {t("units.extend.button")}
      </Button>
      <ExtendWarrantyModal unit={unit} quote={quote.data} open={open} onOpenChange={setOpen} />
    </>
  );
}

function ExtendWarrantyModal({
  unit,
  quote,
  open,
  onOpenChange,
}: {
  unit: UnitView;
  quote: ExtensionQuote;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t, i18n } = useTranslation();
  const currency = useCurrentUser()?.currency ?? "USD";
  const extend = useExtendWarranty(unit.serial);
  const [months, setMonths] = useState<number>(quote.options[0]?.months ?? 12);
  const chosen = quote.options.find((o) => o.months === months);
  const isCustomer = useCurrentUser()?.role === "customer";

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={t("units.extend.title")}
      description={t("units.extend.help", {
        end: formatDate(quote.currentEnd, i18n.language),
        model: unit.modelName,
      })}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" form="extend-warranty" loading={extend.isPending} disabled={!chosen}>
            {chosen
              ? t(isCustomer ? "units.extend.buy" : "units.extend.confirm", {
                  price: formatMoney(chosen.price, currency, i18n.language),
                })
              : t("units.extend.button")}
          </Button>
        </>
      }
    >
      <form
        id="extend-warranty"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (!chosen) return;
          extend.mutate(chosen.months, {
            onSuccess: (u) => {
              onOpenChange(false);
              toast.success(
                t("units.extend.done", {
                  months: chosen.months,
                  end: formatDate(u.warrantyEnd, i18n.language),
                }),
                u.serial,
              );
            },
            onError: (err) => toast.error(toApiError(err).message),
          });
        }}
      >
        <fieldset className="space-y-3">
          <legend className="mb-2 text-sm font-semibold">{t("units.extend.choose")}</legend>
          {quote.options.map((o) => (
            <label
              key={o.months}
              className={cn(
                "flex cursor-pointer items-center gap-4 rounded border p-4 hover:bg-brand-50",
                months === o.months ? "border-brand-500 bg-brand-50" : "border-border",
              )}
            >
              <input
                type="radio"
                name="months"
                value={o.months}
                checked={months === o.months}
                onChange={() => setMonths(o.months)}
                className="h-4 w-4 border-ink-400 text-ink-1000 focus:ring-ink-1000"
              />
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">{t("units.extend.plan", { count: o.months })}</span>
                <span className="block text-sm text-text-muted">
                  {t("units.extend.newEnd", { date: formatDate(o.newEnd, i18n.language) })}
                </span>
              </span>
              <span className="font-mono text-h3 tabular-nums">
                {formatMoney(o.price, currency, i18n.language)}
              </span>
            </label>
          ))}
        </fieldset>
        {quote.extendedMonths ? (
          <p className="mt-3 text-sm text-text-muted">
            {t("units.extend.already", { count: quote.extendedMonths })}
          </p>
        ) : null}
        <p className="mt-3 text-sm text-text-muted">{t("units.extend.terms")}</p>
      </form>
    </Modal>
  );
}

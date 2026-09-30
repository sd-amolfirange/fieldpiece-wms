import { zodResolver } from "@hookform/resolvers/zod";
import {
  EXTENSION_PLANS,
  extensionPrice,
  REPLACEMENT_COST_RATIO,
  roundMoney,
  type ModelView,
} from "@wms/domain";
import { Pencil } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { toast } from "@/components/feedback";
import { Button, Card, FormField, Input, Modal } from "@/components/ui";
import { modelFinanceSchema, useUpdateModelFinance, type ModelFinanceForm } from "@/features/catalog";
import { Meter, useFinanceSummary } from "@/features/dashboard";
import { applyFieldErrors, toApiError } from "@/lib/api-error";
import { formatMoney } from "@/lib/format";
import { can } from "@/lib/permissions";
import { useCurrentUser } from "@/lib/session";
import { useFieldError } from "@/lib/use-field-error";

// A06 finance: what a warranty event on this model costs, what its extended warranties sell for, and its warranty
// quota (12-month budget and expected claims) with how much of it the last 12 months used. Admins edit the numbers.
// The internal figures (repair cost, budget, claim quota) only reach the warranty desk; others see list and
// extension prices.

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-overline text-text-muted">{label}</dt>
      <dd className="mt-1 font-mono text-body tabular-nums">{children}</dd>
    </div>
  );
}

export function ModelFinanceCard({ model }: { model: ModelView }) {
  const { t, i18n } = useTranslation();
  const user = useCurrentUser();
  const currency = user?.currency ?? "USD";
  const isAdmin = can(user?.role, "models:manage");
  const finance = useFinanceSummary(undefined, isAdmin);
  const quota = finance.data?.quotas.find((q) => q.modelId === model.id);
  const [editing, setEditing] = useState(false);
  const money = (n: number) => formatMoney(n, currency, i18n.language);

  return (
    <>
      <Card
        title={t("models.finance.title")}
        actions={
          isAdmin ? (
            <Button variant="secondary" size="sm" icon={Pencil} onClick={() => setEditing(true)}>
              {t("common.edit")}
            </Button>
          ) : null
        }
      >
        <dl className="grid gap-4 sm:grid-cols-3">
          <Field label={t("models.finance.listPrice")}>{money(model.listPrice)}</Field>
          {model.repairCost !== undefined ? (
            <Field label={t("models.finance.repairCost")}>{money(model.repairCost)}</Field>
          ) : null}
          <Field label={t("models.finance.replacementCost")}>
            {money(roundMoney(model.listPrice * REPLACEMENT_COST_RATIO))}
          </Field>
        </dl>
        <h4 className="text-overline mb-2 mt-6 text-text-muted">{t("models.finance.extensions")}</h4>
        <ul className="grid gap-2 sm:grid-cols-3">
          {EXTENSION_PLANS.map((p) => (
            <li key={p.months} className="rounded border border-border p-3 text-center">
              <span className="block text-sm text-text-muted">
                {t("units.extend.plan", { count: p.months })}
              </span>
              <span className="block font-mono text-h3 tabular-nums">
                {money(extensionPrice(model.listPrice, p.months))}
              </span>
            </li>
          ))}
        </ul>
      </Card>

      {model.warrantyBudget !== undefined && model.claimQuota !== undefined ? (
        <Card title={t("models.finance.quota")}>
          <p className="-mt-2 mb-4 text-sm text-text-muted">{t("models.finance.quotaHelp")}</p>
          <dl className="grid gap-4 sm:grid-cols-2">
            <Field label={t("models.finance.budget")}>{money(model.warrantyBudget)}</Field>
            <Field label={t("models.finance.claimQuota")}>{model.claimQuota}</Field>
          </dl>
          {quota ? (
            <div className="mt-6 space-y-4">
              <div>
                <p className="mb-1 text-sm">
                  {t("models.finance.budgetUsed", { spent: money(quota.spent), budget: money(quota.budget) })}
                </p>
                <Meter value={quota.budgetUsedPct} label={t("finance.budgetMeter", { model: model.code })} />
              </div>
              <div>
                <p className="mb-1 text-sm">
                  {t("finance.claimsOfQuota", { claims: quota.claims, quota: quota.claimQuota })}
                </p>
                <Meter
                  value={quota.claimQuotaUsedPct}
                  label={t("finance.claimMeter", { model: model.code })}
                />
              </div>
            </div>
          ) : isAdmin && finance.data ? (
            <p className="mt-4 text-sm text-text-muted">{t("models.finance.noActivity")}</p>
          ) : null}
        </Card>
      ) : null}

      {isAdmin ? <EditFinanceModal model={model} open={editing} onOpenChange={setEditing} /> : null}
    </>
  );
}

function EditFinanceModal({
  model,
  open,
  onOpenChange,
}: {
  model: ModelView;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const fieldError = useFieldError();
  const update = useUpdateModelFinance(model.id);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<ModelFinanceForm>({
    resolver: zodResolver(modelFinanceSchema),
    values: {
      listPrice: model.listPrice,
      repairCost: model.repairCost ?? 0,
      warrantyBudget: model.warrantyBudget ?? 0,
      claimQuota: model.claimQuota ?? 0,
    },
  });

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={t("models.finance.editTitle", { code: model.code })}
      description={t("models.finance.editHelp")}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" form="model-finance" loading={update.isPending}>
            {t("common.save")}
          </Button>
        </>
      }
    >
      <form
        id="model-finance"
        noValidate
        className="grid gap-4 sm:grid-cols-2"
        onSubmit={handleSubmit((v) =>
          update.mutate(modelFinanceSchema.parse(v), {
            onSuccess: () => {
              onOpenChange(false);
              toast.success(t("models.finance.saved"), model.code);
            },
            onError: (e) => {
              if (!applyFieldErrors(e, setError)) toast.error(toApiError(e).message);
            },
          }),
        )}
      >
        <FormField
          label={t("models.finance.listPrice")}
          error={fieldError(errors.listPrice?.message)}
          required
        >
          <Input type="number" inputMode="decimal" step="0.01" min={0} {...register("listPrice")} />
        </FormField>
        <FormField
          label={t("models.finance.repairCost")}
          error={fieldError(errors.repairCost?.message)}
          required
        >
          <Input type="number" inputMode="decimal" step="0.01" min={0} {...register("repairCost")} />
        </FormField>
        <FormField
          label={t("models.finance.budget")}
          error={fieldError(errors.warrantyBudget?.message)}
          required
        >
          <Input type="number" inputMode="decimal" step="0.01" min={0} {...register("warrantyBudget")} />
        </FormField>
        <FormField
          label={t("models.finance.claimQuota")}
          error={fieldError(errors.claimQuota?.message)}
          required
        >
          <Input type="number" inputMode="numeric" step="1" min={0} {...register("claimQuota")} />
        </FormField>
      </form>
    </Modal>
  );
}

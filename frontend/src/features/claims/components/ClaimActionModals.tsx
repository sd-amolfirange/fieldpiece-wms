import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { Button, FormField, Input, Modal, Textarea } from "@/components/ui";
import { useFieldError } from "@/lib/use-field-error";

// Same pattern as the registration reject modal: collect what the claim action needs before sending it.

const submitSchema = z.object({
  rmaNumber: z.string().trim().optional(),
  amount: z.string().refine((v) => Number(v) > 0, "validation.amount"),
});
type SubmitForm = z.infer<typeof submitSchema>;

interface ModalProps<T> {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (values: T) => void;
  pending?: boolean;
}

/** Submit to the manufacturer: RMA number (for brands that use them) and the claimed amount. */
export function SubmitClaimModal({
  open,
  onOpenChange,
  onConfirm,
  pending,
  defaultRma,
}: ModalProps<{ rmaNumber?: string; amount: number }> & { defaultRma?: string }) {
  const { t } = useTranslation();
  const fieldError = useFieldError();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<SubmitForm>({
    resolver: zodResolver(submitSchema),
    values: { rmaNumber: defaultRma ?? "", amount: "" },
  });

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={t("claims.submitTitle")}
      description={t("claims.submitHelp")}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" form="submit-claim" loading={pending}>
            {t("claims.actions.submit")}
          </Button>
        </>
      }
    >
      <form
        id="submit-claim"
        noValidate
        className="space-y-4"
        onSubmit={handleSubmit((v) => onConfirm({ rmaNumber: v.rmaNumber, amount: Number(v.amount) }))}
      >
        <FormField label={t("claims.fields.rma")} helper={t("claims.rmaHelp")}>
          <Input className="font-mono" {...register("rmaNumber")} />
        </FormField>
        <FormField label={t("claims.fields.amount")} error={fieldError(errors.amount?.message)} required>
          <Input type="number" inputMode="numeric" min={1} step={1} {...register("amount")} />
        </FormField>
      </form>
    </Modal>
  );
}

const rejectSchema = z.object({ reason: z.string().trim().min(5, "validation.reasonRequired") });
type RejectForm = z.infer<typeof rejectSchema>;

export function RejectClaimModal({ open, onOpenChange, onConfirm, pending }: ModalProps<string>) {
  const { t } = useTranslation();
  const fieldError = useFieldError();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<RejectForm>({ resolver: zodResolver(rejectSchema), values: { reason: "" } });

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={t("claims.rejectTitle")}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button variant="danger" type="submit" form="reject-claim" loading={pending}>
            {t("claims.actions.reject")}
          </Button>
        </>
      }
    >
      <form
        id="reject-claim"
        noValidate
        className="space-y-4"
        onSubmit={handleSubmit((v) => onConfirm(v.reason))}
      >
        <FormField label={t("claims.fields.reason")} error={fieldError(errors.reason?.message)} required>
          <Textarea rows={4} {...register("reason")} />
        </FormField>
      </form>
    </Modal>
  );
}

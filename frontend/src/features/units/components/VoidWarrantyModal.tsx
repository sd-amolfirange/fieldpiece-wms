import { zodResolver } from "@hookform/resolvers/zod";
import { VOID_REASONS, type VoidReason } from "@wms/domain";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { Button, FormField, Modal, NativeSelect, Textarea } from "@/components/ui";
import { useFieldError } from "@/lib/use-field-error";
import { voidWarrantySchema, type VoidWarrantyForm } from "../schemas";

// A05 Void warranty: same pattern as the claim reject modal. Reason and note are recorded with user and date.

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (values: { reason: VoidReason; note?: string }) => void;
  pending?: boolean;
}

export function VoidWarrantyModal({ open, onOpenChange, onConfirm, pending }: Props) {
  const { t } = useTranslation();
  const fieldError = useFieldError();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<VoidWarrantyForm>({
    resolver: zodResolver(voidWarrantySchema),
    values: { reason: "" as VoidReason, note: "" },
  });

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={t("units.void.title")}
      description={t("units.void.help")}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button variant="danger" type="submit" form="void-warranty" loading={pending}>
            {t("units.void.confirm")}
          </Button>
        </>
      }
    >
      <form
        id="void-warranty"
        noValidate
        className="space-y-4"
        onSubmit={handleSubmit((v) => onConfirm({ reason: v.reason, note: v.note?.trim() || undefined }))}
      >
        <FormField label={t("units.void.reason")} error={fieldError(errors.reason?.message)} required>
          <NativeSelect {...register("reason")}>
            <option value="">—</option>
            {VOID_REASONS.map((r) => (
              <option key={r} value={r}>
                {t(`units.void.reasons.${r}`)}
              </option>
            ))}
          </NativeSelect>
        </FormField>
        <FormField label={t("units.void.note")} helper={t("units.void.noteHelp")}>
          <Textarea rows={3} {...register("note")} />
        </FormField>
      </form>
    </Modal>
  );
}

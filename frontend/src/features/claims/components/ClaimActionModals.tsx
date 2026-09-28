import { zodResolver } from "@hookform/resolvers/zod";
import { RESOLUTIONS, type Resolution } from "@wms/domain";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { Button, FormField, Input, Modal, NativeSelect, Textarea } from "@/components/ui";
import { useFieldError } from "@/lib/use-field-error";
import {
  approveClaimSchema,
  closeClaimSchema,
  rejectClaimSchema,
  type ApproveClaimForm,
  type CloseClaimForm,
  type RejectClaimForm,
} from "../schemas";

// Same pattern as the registration reject modal: collect what the claim action needs before sending it.

interface ModalProps<T> {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (values: T) => void;
  pending?: boolean;
}

export interface ApproveValues {
  resolution: Resolution;
  creditAmount?: number;
  note?: string;
}

/** Approve: repair, replace or credit (with the amount in the account currency). */
export function ApproveClaimModal({
  open,
  onOpenChange,
  onConfirm,
  pending,
  currency,
}: ModalProps<ApproveValues> & { currency: string }) {
  const { t } = useTranslation();
  const fieldError = useFieldError();
  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<ApproveClaimForm>({
    resolver: zodResolver(approveClaimSchema),
    values: { resolution: "" as Resolution, creditAmount: "", note: "" },
  });
  const resolution = watch("resolution");

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={t("claims.approveTitle")}
      description={t("claims.approveHelp")}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" form="approve-claim" loading={pending}>
            {t("claims.actions.approve")}
          </Button>
        </>
      }
    >
      <form
        id="approve-claim"
        noValidate
        className="space-y-4"
        onSubmit={handleSubmit((v) =>
          onConfirm({
            resolution: v.resolution,
            creditAmount: v.resolution === "CREDIT" ? Number(v.creditAmount) : undefined,
            note: v.note || undefined,
          }),
        )}
      >
        <FormField
          label={t("claims.fields.resolution")}
          error={fieldError(errors.resolution?.message)}
          required
        >
          <NativeSelect {...register("resolution")}>
            <option value="">—</option>
            {RESOLUTIONS.map((r) => (
              <option key={r} value={r}>
                {t(`claims.resolution.${r}`)}
              </option>
            ))}
          </NativeSelect>
        </FormField>
        {resolution === "CREDIT" ? (
          <FormField
            label={t("claims.fields.creditAmount", { currency })}
            error={fieldError(errors.creditAmount?.message)}
            required
          >
            <Input type="number" inputMode="decimal" min={0.01} step={0.01} {...register("creditAmount")} />
          </FormField>
        ) : null}
        <FormField label={t("claims.fields.note")} helper={t("common.optional")}>
          <Textarea rows={3} {...register("note")} />
        </FormField>
      </form>
    </Modal>
  );
}

export function RejectClaimModal({ open, onOpenChange, onConfirm, pending }: ModalProps<string>) {
  const { t } = useTranslation();
  const fieldError = useFieldError();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<RejectClaimForm>({ resolver: zodResolver(rejectClaimSchema), values: { reason: "" } });

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

export interface CloseValues {
  replacementSerial?: string;
  replacementBatchNumber?: string;
  note?: string;
}

/** Close: settles the claim. A replacement records the new product's serial and batch. */
export function CloseClaimModal({
  open,
  onOpenChange,
  onConfirm,
  pending,
  resolution,
}: ModalProps<CloseValues> & { resolution?: Resolution }) {
  const { t } = useTranslation();
  const fieldError = useFieldError();
  const replace = resolution === "REPLACE";
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<CloseClaimForm>({
    resolver: zodResolver(closeClaimSchema(replace)),
    values: { replacementSerial: "", replacementBatchNumber: "", note: "" },
  });

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={t("claims.closeTitle")}
      description={resolution ? t(`claims.closeHelp.${resolution}`) : undefined}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" form="close-claim" loading={pending}>
            {t("claims.actions.close")}
          </Button>
        </>
      }
    >
      <form
        id="close-claim"
        noValidate
        className="space-y-4"
        onSubmit={handleSubmit((v) =>
          onConfirm({
            replacementSerial: replace ? v.replacementSerial : undefined,
            replacementBatchNumber: replace ? v.replacementBatchNumber || undefined : undefined,
            note: v.note || undefined,
          }),
        )}
      >
        {replace ? (
          <>
            <FormField
              label={t("claims.fields.replacementSerial")}
              error={fieldError(errors.replacementSerial?.message)}
              required
            >
              <Input className="font-mono" autoComplete="off" {...register("replacementSerial")} />
            </FormField>
            <FormField
              label={t("claims.fields.replacementBatch")}
              helper={t("fields.batchHelp")}
              error={fieldError(errors.replacementBatchNumber?.message)}
            >
              <Input className="font-mono" autoComplete="off" {...register("replacementBatchNumber")} />
            </FormField>
          </>
        ) : null}
        <FormField label={t("claims.fields.note")} helper={t("common.optional")}>
          <Textarea rows={3} {...register("note")} />
        </FormField>
      </form>
    </Modal>
  );
}

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { Button, FormField, Modal, Textarea } from "@/components/ui";
import { useFieldError } from "@/lib/use-field-error";

// Same pattern as RejectClaimModal: the reason is required and is shown to whoever submitted it.

const schema = z.object({ reason: z.string().trim().min(5, "validation.reasonRequired") });
type Form = z.infer<typeof schema>;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (reason: string) => void;
  pending?: boolean;
  defaultReason?: string;
}

export function RejectRegistrationModal({ open, onOpenChange, onConfirm, pending, defaultReason }: Props) {
  const { t } = useTranslation();
  const fieldError = useFieldError();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<Form>({ resolver: zodResolver(schema), values: { reason: defaultReason ?? "" } });

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={t("review.rejectTitle")}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button variant="danger" type="submit" form="reject-registration" loading={pending}>
            {t("review.reject")}
          </Button>
        </>
      }
    >
      <form
        id="reject-registration"
        noValidate
        onSubmit={handleSubmit(({ reason }) => onConfirm(reason))}
        className="space-y-4"
      >
        <FormField label={t("review.reason")} error={fieldError(errors.reason?.message)} required>
          <Textarea rows={4} {...register("reason")} />
        </FormField>
      </form>
    </Modal>
  );
}

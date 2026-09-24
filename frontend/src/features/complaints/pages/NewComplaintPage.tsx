import { zodResolver } from "@hookform/resolvers/zod";
import type { Attachment } from "@wms/domain";
import { Send } from "lucide-react";
import { useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Skeleton, toast } from "@/components/feedback";
import { PageHeader } from "@/components/layout";
import {
  Button,
  Card,
  FileDropzone,
  FormField,
  NativeSelect,
  Textarea,
  type UploadItem,
} from "@/components/ui";
import { dropHeic, uploadAll } from "@/features/files";
import { applyFieldErrors, toApiError } from "@/lib/api-error";
import { useCurrentRole } from "@/lib/session";
import { useFieldError } from "@/lib/use-field-error";
import { EntitlementPanel } from "../components/EntitlementPanel";
import { useCreateComplaint, useEntitlement, useUnitsForComplaint } from "../hooks";
import { complaintSchema, type ComplaintForm } from "../schemas";

// CU04 Raise complaint (customer, phone layout), DL06 (dealer, on the customer's behalf) and admin.
// Pick the unit, describe the fault, add a photo or video; the entitlement is shown before submitting.

const MEDIA = { "image/*": [], "video/*": [] };

export default function NewComplaintPage() {
  const { t } = useTranslation();
  const fieldError = useFieldError();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const role = useCurrentRole();
  const isCustomer = role === "customer";
  const units = useUnitsForComplaint();
  const create = useCreateComplaint();
  const [files, setFiles] = useState<UploadItem[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const uploaded = useRef(new Map<File, Attachment>());

  const {
    register,
    handleSubmit,
    watch,
    setError,
    formState: { errors },
  } = useForm<ComplaintForm>({
    resolver: zodResolver(complaintSchema),
    defaultValues: { unitSerial: searchParams.get("serial") ?? "", description: "" },
  });
  const serial = watch("unitSerial");
  const entitlement = useEntitlement(serial || undefined);
  const unit = units.data?.find((u) => u.serial === serial);

  const onSubmit = handleSubmit(async (values) => {
    setSubmitting(true);
    try {
      const attachmentIds = await uploadAll(files, setFiles, uploaded.current);
      const complaint = await create.mutateAsync({ ...values, attachmentIds });
      toast.success(t("complaints.raised"), complaint.id);
      navigate(`/complaints/${complaint.id}`, { replace: true });
    } catch (error) {
      if (!applyFieldErrors(error, setError)) toast.error(toApiError(error).message);
    } finally {
      setSubmitting(false);
    }
  });

  const title = t("complaints.raise");

  return (
    <div className={isCustomer ? "mx-auto max-w-xl" : "mx-auto max-w-3xl"}>
      <PageHeader
        title={title}
        breadcrumbs={[
          { label: isCustomer ? t("nav.myComplaints") : t("complaints.title"), to: "/complaints" },
          { label: title },
        ]}
      />
      <div className="space-y-6">
        <Card>
          <form noValidate onSubmit={onSubmit} className="space-y-4">
            <FormField label={t("complaints.unit")} error={fieldError(errors.unitSerial?.message)} required>
              <NativeSelect {...register("unitSerial")} disabled={units.isLoading}>
                <option value="">—</option>
                {units.data?.map((u) => (
                  <option key={u.serial} value={u.serial}>
                    {u.serial} · {u.modelName}
                    {u.customerName && !isCustomer ? ` · ${u.customerName}` : ""}
                  </option>
                ))}
              </NativeSelect>
            </FormField>
            <FormField
              label={t("complaints.fault")}
              helper={t("complaints.faultHelp")}
              error={fieldError(errors.description?.message)}
              required
            >
              <Textarea rows={4} {...register("description")} />
            </FormField>
            <FormField label={t("complaints.photos")} helper={t("common.optional")}>
              <FileDropzone
                value={files}
                onChange={(next) => {
                  const { kept, heic } = dropHeic(next);
                  heic.forEach((name) => toast.error(t("fields.heicNotSupported", { name })));
                  setFiles(kept);
                }}
                maxFiles={3}
                accept={MEDIA}
                hint={t("complaints.photoHint")}
                onReject={(m) => m.forEach((msg) => toast.error(msg))}
              />
            </FormField>
            <div className="border-t border-border pt-6">
              <Button
                type="submit"
                icon={Send}
                loading={submitting}
                className={isCustomer ? "w-full" : undefined}
              >
                {t("complaints.submit")}
              </Button>
            </div>
          </form>
        </Card>

        {serial ? (
          entitlement.data ? (
            <EntitlementPanel
              entitlement={entitlement.data}
              title={unit ? t("entitlement.titleFor", { serial: unit.serial }) : undefined}
            />
          ) : (
            <Skeleton className="h-40" />
          )
        ) : (
          <p className="rounded bg-info-bg p-3 text-sm text-info">{t("complaints.pickUnitFirst")}</p>
        )}
      </div>
    </div>
  );
}

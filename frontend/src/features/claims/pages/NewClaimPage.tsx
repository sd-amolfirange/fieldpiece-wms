import { zodResolver } from "@hookform/resolvers/zod";
import { ISSUE_TYPES, type Attachment, type IssueType } from "@wms/domain";
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
import { CoveragePanel } from "../components/CoveragePanel";
import { useCoverage, useCreateClaim, useUnitsForClaim } from "../hooks";
import { claimSchema, type ClaimForm } from "../schemas";

// CU04 File a warranty claim (customer, phone layout), DL06 (dealer, for the customer) and the warranty desk.
// Pick the product, say what's wrong, add photos, a video or the receipt; coverage is shown before submitting.

const EVIDENCE = { "image/*": [], "video/*": [], "application/pdf": [] };

export default function NewClaimPage() {
  const { t } = useTranslation();
  const fieldError = useFieldError();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const role = useCurrentRole();
  const isCustomer = role === "customer";
  const units = useUnitsForClaim();
  const create = useCreateClaim();
  const [files, setFiles] = useState<UploadItem[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const uploaded = useRef(new Map<File, Attachment>());

  const {
    register,
    handleSubmit,
    watch,
    setError,
    formState: { errors },
  } = useForm<ClaimForm>({
    resolver: zodResolver(claimSchema),
    defaultValues: {
      unitSerial: searchParams.get("serial") ?? "",
      issueType: "" as IssueType,
      description: "",
    },
  });
  const serial = watch("unitSerial");
  const coverage = useCoverage(serial || undefined);
  const unit = units.data?.find((u) => u.serial === serial);

  const onSubmit = handleSubmit(async (values) => {
    setSubmitting(true);
    try {
      const attachmentIds = await uploadAll(files, setFiles, uploaded.current);
      const claim = await create.mutateAsync({ ...values, attachmentIds });
      toast.success(t("claims.filed"), claim.id);
      navigate(`/claims/${claim.id}`, { replace: true });
    } catch (error) {
      if (!applyFieldErrors(error, setError)) toast.error(toApiError(error).message);
    } finally {
      setSubmitting(false);
    }
  });

  const title = t("claims.file");

  return (
    <div className={isCustomer ? "mx-auto max-w-xl" : "mx-auto max-w-3xl"}>
      <PageHeader
        title={title}
        breadcrumbs={[
          { label: isCustomer ? t("nav.myClaims") : t("claims.title"), to: "/claims" },
          { label: title },
        ]}
      />
      <div className="space-y-6">
        <Card>
          <form noValidate onSubmit={onSubmit} className="space-y-4">
            <FormField
              label={t("claims.fields.product")}
              error={fieldError(errors.unitSerial?.message)}
              required
            >
              <NativeSelect {...register("unitSerial")} disabled={units.isLoading}>
                <option value="">—</option>
                {units.data?.map((u) => (
                  <option key={u.serial} value={u.serial}>
                    {u.serial} · {u.modelCode} {u.modelName}
                    {u.customerName && !isCustomer ? ` · ${u.customerName}` : ""}
                  </option>
                ))}
              </NativeSelect>
            </FormField>
            <FormField
              label={t("claims.fields.issue")}
              error={fieldError(errors.issueType?.message)}
              required
            >
              <NativeSelect {...register("issueType")}>
                <option value="">—</option>
                {ISSUE_TYPES.map((i) => (
                  <option key={i} value={i}>
                    {t(`claims.issue.${i}`)}
                  </option>
                ))}
              </NativeSelect>
            </FormField>
            <FormField
              label={t("claims.fields.description")}
              helper={t("claims.descriptionHelp")}
              error={fieldError(errors.description?.message)}
              required
            >
              <Textarea rows={4} {...register("description")} />
            </FormField>
            <FormField label={t("claims.fields.evidence")} helper={t("common.optional")}>
              <FileDropzone
                value={files}
                onChange={(next) => {
                  const { kept, heic } = dropHeic(next);
                  heic.forEach((name) => toast.error(t("fields.heicNotSupported", { name })));
                  setFiles(kept);
                }}
                maxFiles={3}
                accept={EVIDENCE}
                hint={t("claims.evidenceHint")}
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
                {t("claims.submit")}
              </Button>
            </div>
          </form>
        </Card>

        {serial ? (
          coverage.data ? (
            <CoveragePanel
              coverage={coverage.data}
              title={unit ? t("coverage.titleFor", { serial: unit.serial }) : undefined}
            />
          ) : (
            <Skeleton className="h-32" />
          )
        ) : (
          <p className="rounded bg-info-bg p-3 text-sm text-info">{t("claims.pickUnitFirst")}</p>
        )}
      </div>
    </div>
  );
}

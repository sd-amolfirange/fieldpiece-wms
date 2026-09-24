import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft, ArrowRight, Send } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useForm, type FieldPath } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "@/components/feedback";
import { PageHeader } from "@/components/layout";
import {
  Button,
  Card,
  FileDropzone,
  FormField,
  Input,
  MonoId,
  NativeSelect,
  SerialHelpLink,
  SerialNumberInput,
  Stepper,
  Textarea,
  type UploadItem,
} from "@/components/ui";
import { applyFieldErrors, toApiError } from "@/lib/api-error";
import { readDraft, removeDraft, writeDraft } from "@/lib/drafts";
import { toIsoDate } from "@/lib/format";
import { useCurrentUser } from "@/lib/session";
import { claimsApi } from "../api";
import { claimSchema, FAILURE_CATEGORIES, PHOTO_REQUIRED_CATEGORIES, type ClaimDraft } from "../schemas";

// Section 8.4: 4 steps; drafts auto-save every 10s to the API as DRAFT with a local fallback.
// TODO: expired-warranty warning ("Out of warranty, paid repair quote") once lookup is wired to step 1. [CONFIRM]
// TODO: upload attachments via presigned URLs (POST /uploads/presign) before submitting.

const DRAFT_FORM = "claim";
const AUTOSAVE_MS = 10_000;

const STEP_FIELDS: FieldPath<ClaimDraft>[][] = [
  ["serialNumber"],
  ["failureCategory", "failureDate", "description", "photoCount"],
  ["resolution"],
  [],
];

export default function NewClaimPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const userId = useCurrentUser()?.id;
  const [searchParams] = useSearchParams();
  const [step, setStep] = useState(0);
  const [files, setFiles] = useState<UploadItem[]>([]);
  const [draftId, setDraftId] = useState<string | undefined>();
  const [submitting, setSubmitting] = useState(false);
  const lastSaved = useRef<string>("");

  const form = useForm<ClaimDraft>({
    resolver: zodResolver(claimSchema),
    shouldFocusError: true,
    defaultValues: {
      serialNumber: searchParams.get("serial") ?? "",
      description: "",
      failureDate: "",
      photoCount: 0,
      ...readDraft<ClaimDraft>(userId, DRAFT_FORM),
    },
  });
  const {
    register,
    handleSubmit,
    trigger,
    watch,
    setValue,
    setError,
    getValues,
    formState: { errors },
  } = form;

  useEffect(
    () => setValue("photoCount", files.length, { shouldValidate: step === 1 }),
    [files, setValue, step],
  );

  // Autosave: API first, local fallback when offline or the API fails.
  useEffect(() => {
    const timer = window.setInterval(() => {
      const values = getValues();
      const snapshot = JSON.stringify(values);
      if (snapshot === lastSaved.current || !values.serialNumber) return;
      lastSaved.current = snapshot;
      writeDraft(userId, DRAFT_FORM, values);
      claimsApi
        .saveDraft({ ...values, id: draftId })
        .then((claim) => setDraftId(claim.id))
        .catch(() => {
          /* local copy already saved */
        });
    }, AUTOSAVE_MS);
    return () => window.clearInterval(timer);
  }, [getValues, draftId, userId]);

  const next = async () => {
    const fields = STEP_FIELDS[step] ?? [];
    if (await trigger(fields, { shouldFocus: true })) setStep((s) => Math.min(s + 1, 3));
  };

  const onSubmit = handleSubmit(async (values) => {
    setSubmitting(true);
    try {
      const draft = await claimsApi.saveDraft({ ...values, id: draftId });
      setDraftId(draft.id);
      const submitted = await claimsApi.transition(draft.id, { action: "submit" });
      removeDraft(userId, DRAFT_FORM);
      toast.success(t("claims.actions.submit"), submitted.id);
      navigate(`/claims/${submitted.id}`, { replace: true });
    } catch (error) {
      if (!applyFieldErrors(error, setError)) toast.error(toApiError(error).message);
    } finally {
      setSubmitting(false);
    }
  });

  const category = watch("failureCategory");
  const steps = ["Unit", "Failure details", "Return and resolution", "Review"];

  return (
    <>
      <PageHeader
        title={t("claims.new")}
        breadcrumbs={[{ label: t("nav.claims"), to: "/claims" }, { label: t("claims.new") }]}
      />
      <Card className="mx-auto max-w-3xl">
        <Stepper steps={steps} current={step} className="mb-8" />
        <form noValidate onSubmit={onSubmit} className="space-y-4">
          {step === 0 ? (
            <FormField
              label={t("fields.serialNumber")}
              error={errors.serialNumber?.message}
              required
              labelAction={<SerialHelpLink />}
            >
              <SerialNumberInput {...register("serialNumber")} />
            </FormField>
          ) : null}

          {step === 1 ? (
            <>
              <FormField
                label={t("claims.columns.category")}
                error={errors.failureCategory?.message}
                required
              >
                <NativeSelect defaultValue="" {...register("failureCategory")}>
                  <option value="" disabled>
                    —
                  </option>
                  {FAILURE_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {t(`claims.failure.${c}`)}
                    </option>
                  ))}
                </NativeSelect>
              </FormField>
              <FormField label="Failure date" error={errors.failureDate?.message} required>
                <Input type="date" max={toIsoDate(new Date())} {...register("failureDate")} />
              </FormField>
              <FormField
                label="Description"
                error={errors.description?.message}
                helper="At least 30 characters. Say what happened and what you already tried."
                required
              >
                <Textarea rows={5} {...register("description")} />
              </FormField>
              <FormField
                label="Photos or video"
                error={errors.photoCount?.message}
                required={!!category && PHOTO_REQUIRED_CATEGORIES.has(category)}
              >
                <FileDropzone
                  value={files}
                  onChange={setFiles}
                  onReject={(m) => m.forEach((msg) => toast.error(msg))}
                />
              </FormField>
            </>
          ) : null}

          {step === 2 ? (
            <>
              {/* TODO: return address fields (Address type) pre-filled from the customer profile */}
              <FormField label="Preferred resolution" error={errors.resolution?.message} required>
                <NativeSelect defaultValue="" {...register("resolution")}>
                  <option value="" disabled>
                    —
                  </option>
                  <option value="repair">Repair</option>
                  <option value="replace">Replace</option>
                  <option value="credit">Credit</option>
                </NativeSelect>
              </FormField>
            </>
          ) : null}

          {step === 3 ? (
            <dl className="grid gap-4 sm:grid-cols-2">
              <div>
                <dt className="text-overline text-text-muted">{t("fields.serialNumber")}</dt>
                <dd>
                  <MonoId>{getValues("serialNumber")}</MonoId>
                </dd>
              </div>
              <div>
                <dt className="text-overline text-text-muted">{t("claims.columns.category")}</dt>
                <dd>{category ? t(`claims.failure.${category}`) : ""}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-overline text-text-muted">Description</dt>
                <dd>{getValues("description")}</dd>
              </div>
            </dl>
          ) : null}

          <div className="flex justify-between gap-2 border-t border-border pt-6">
            <Button
              variant="secondary"
              icon={ArrowLeft}
              disabled={step === 0}
              onClick={() => setStep((s) => s - 1)}
            >
              {t("common.back")}
            </Button>
            {step < 3 ? (
              <Button icon={ArrowRight} onClick={() => void next()}>
                {t("common.next")}
              </Button>
            ) : (
              <Button type="submit" icon={Send} loading={submitting}>
                {t("claims.actions.submit")}
              </Button>
            )}
          </div>
        </form>
      </Card>
    </>
  );
}

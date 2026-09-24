import { zodResolver } from "@hookform/resolvers/zod";
import type { Attachment, RegistrationView } from "@wms/domain";
import { ArrowLeft, ArrowRight, CheckCircle2, Clock, QrCode as QrIcon, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useForm, type FieldPath } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { toast } from "@/components/feedback";
import { PageHeader } from "@/components/layout";
import {
  Button,
  buttonVariants,
  Card,
  FileDropzone,
  FormField,
  Input,
  MonoId,
  NativeSelect,
  RegistrationStatusBadge,
  SerialHelpLink,
  SerialNumberInput,
  Stepper,
  type UploadItem,
} from "@/components/ui";
import { QrScannerModal, type QrPayload } from "@/features/qr";
import { applyFieldErrors, toApiError } from "@/lib/api-error";
import { toIsoDate } from "@/lib/format";
import { useDealers, useModels } from "@/features/catalog";
import { useCurrentRole } from "@/lib/session";
import { dropHeic, uploadAll } from "@/features/files";
import { useFieldError } from "@/lib/use-field-error";
import { useCreateRegistration } from "../hooks";
import { unitRegisterSchema, type UnitRegisterForm } from "../schemas";

// DL03 Register a unit (dealer / distributor; admin "Manual add"): single form or QR scan.
// Unit -> Installation and invoice -> Customer and review. Clean registrations are approved at once and the
// model's parts get their warranties; a duplicate serial goes to admin review.

const STEP_FIELDS: FieldPath<UnitRegisterForm>[][] = [
  ["serial", "modelCode", "dealerId"],
  ["installDate", "location", "invoiceNumber"],
  ["customerName", "customerPhone", "customerEmail", "city"],
];

export default function NewRegistrationPage() {
  const { t } = useTranslation();
  const fieldError = useFieldError();
  const role = useCurrentRole();
  const needsDealer = role === "admin" || role === "distributor";
  const models = useModels();
  const dealers = useDealers();
  const create = useCreateRegistration();
  const [step, setStep] = useState(0);
  const [files, setFiles] = useState<UploadItem[]>([]);
  const [scanning, setScanning] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<RegistrationView | null>(null);
  const uploaded = useRef(new Map<File, Attachment>());
  const schema = useMemo(() => unitRegisterSchema(needsDealer), [needsDealer]);

  const {
    register,
    handleSubmit,
    trigger,
    watch,
    setValue,
    setError,
    reset,
    formState: { errors },
  } = useForm<UnitRegisterForm>({
    resolver: zodResolver(schema),
    defaultValues: {
      serial: "",
      modelCode: "",
      dealerId: "",
      installDate: "",
      customerName: "",
      customerPhone: "",
    },
  });

  const modelCode = watch("modelCode");
  const model = models.data?.find((m) => m.code === modelCode);
  useEffect(() => {
    if (!needsDealer && dealers.data?.[0]) setValue("dealerId", dealers.data[0].id);
  }, [needsDealer, dealers.data, setValue]);

  const onScan = useCallback(
    (payload: QrPayload) => {
      setValue("serial", payload.serial, { shouldValidate: true });
      if (payload.modelCode) setValue("modelCode", payload.modelCode, { shouldValidate: true });
    },
    [setValue],
  );

  const next = async () => {
    if (await trigger(STEP_FIELDS[step], { shouldFocus: true })) setStep((s) => s + 1);
  };

  const onSubmit = handleSubmit(async (values) => {
    setSubmitting(true);
    try {
      const attachmentIds = await uploadAll(files, setFiles, uploaded.current);
      const registration = await create.mutateAsync({
        ...values,
        dealerId: needsDealer ? values.dealerId : undefined,
        purchaseDate: values.installDate,
        attachmentIds,
      });
      setResult(registration);
    } catch (error) {
      const api = toApiError(error);
      if (api.fieldErrors?.serial || api.fieldErrors?.modelCode || api.fieldErrors?.dealerId) setStep(0);
      else if (api.fieldErrors?.installDate) setStep(1);
      if (!applyFieldErrors(error, setError)) toast.error(api.message);
    } finally {
      setSubmitting(false);
    }
  });

  if (result) {
    const approved = result.status === "APPROVED";
    return (
      <Card className="mx-auto max-w-xl text-center">
        {approved ? (
          <CheckCircle2 size={24} strokeWidth={1.75} className="mx-auto mb-3 text-success" aria-hidden />
        ) : (
          <Clock size={24} strokeWidth={1.75} className="mx-auto mb-3 text-warning" aria-hidden />
        )}
        <h1 className="text-h1">{approved ? t("registerUnit.doneTitle") : t("registerUnit.reviewTitle")}</h1>
        <p className="mt-2 text-body">
          <MonoId>{result.serial}</MonoId>
        </p>
        <div className="mt-2">
          <RegistrationStatusBadge status={result.status} />
        </div>
        <p className="mt-4 text-body text-text-muted">
          {approved ? t("registerUnit.doneMessage") : t("registerUnit.reviewMessage")}
        </p>
        <div className="mt-6 flex flex-col justify-center gap-2 sm:flex-row">
          {approved ? (
            <Link to={`/units/${result.serial}`} className={buttonVariants({ variant: "secondary" })}>
              {t("registerUnit.openUnit")}
            </Link>
          ) : null}
          <Button
            icon={ShieldCheck}
            onClick={() => {
              setResult(null);
              setFiles([]);
              uploaded.current.clear();
              setStep(0);
              reset();
            }}
          >
            {t("registerUnit.registerAnother")}
          </Button>
        </div>
      </Card>
    );
  }

  const steps = [t("registerUnit.stepUnit"), t("registerUnit.stepInstall"), t("registerUnit.stepCustomer")];

  return (
    <>
      <PageHeader
        title={t("nav.registerUnit")}
        breadcrumbs={[{ label: t("nav.dashboard"), to: "/" }, { label: t("nav.registerUnit") }]}
      />
      <Card className="mx-auto max-w-3xl">
        <Stepper steps={steps} current={step} className="mb-8" />
        <form noValidate onSubmit={onSubmit} className="space-y-4">
          {step === 0 ? (
            <>
              <Button variant="secondary" icon={QrIcon} onClick={() => setScanning(true)}>
                {t("registerUnit.scan")}
              </Button>
              <FormField
                label={t("fields.serialNumber")}
                error={fieldError(errors.serial?.message)}
                required
                labelAction={<SerialHelpLink />}
              >
                <SerialNumberInput {...register("serial")} />
              </FormField>
              <FormField
                label={t("registerUnit.model")}
                error={fieldError(errors.modelCode?.message)}
                required
              >
                <NativeSelect {...register("modelCode")} disabled={models.isLoading}>
                  <option value="">—</option>
                  {models.data?.map((m) => (
                    <option key={m.id} value={m.code}>
                      {m.code} · {m.name}
                    </option>
                  ))}
                </NativeSelect>
              </FormField>
              {needsDealer ? (
                <FormField
                  label={t("registerUnit.dealer")}
                  error={fieldError(errors.dealerId?.message)}
                  required
                >
                  <NativeSelect {...register("dealerId")}>
                    <option value="">—</option>
                    {dealers.data?.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </NativeSelect>
                </FormField>
              ) : null}
            </>
          ) : null}

          {step === 1 ? (
            <>
              <FormField
                label={t("registerUnit.installDate")}
                error={fieldError(errors.installDate?.message)}
                required
              >
                <Input type="date" max={toIsoDate(new Date())} {...register("installDate")} />
              </FormField>
              <FormField label={t("registerUnit.location")} helper={t("common.optional")}>
                <Input autoComplete="street-address" {...register("location")} />
              </FormField>
              <FormField label={t("registerUnit.invoiceNumber")} helper={t("common.optional")}>
                <Input {...register("invoiceNumber")} />
              </FormField>
              <FormField label={t("registerUnit.invoice")} helper={t("common.optional")}>
                <FileDropzone
                  value={files}
                  onChange={(next) => {
                    const { kept, heic } = dropHeic(next);
                    heic.forEach((name) => toast.error(t("fields.heicNotSupported", { name })));
                    setFiles(kept);
                  }}
                  maxFiles={3}
                  onReject={(m) => m.forEach((msg) => toast.error(msg))}
                />
              </FormField>
            </>
          ) : null}

          {step === 2 ? (
            <>
              <FormField
                label={t("registerUnit.customerName")}
                error={fieldError(errors.customerName?.message)}
                required
              >
                <Input autoComplete="name" {...register("customerName")} />
              </FormField>
              <FormField
                label={t("registerUnit.customerPhone")}
                error={fieldError(errors.customerPhone?.message)}
                required
              >
                <Input type="tel" autoComplete="tel" {...register("customerPhone")} />
              </FormField>
              <FormField
                label={t("registerUnit.customerEmail")}
                error={fieldError(errors.customerEmail?.message)}
                helper={t("common.optional")}
              >
                <Input type="email" autoComplete="email" {...register("customerEmail")} />
              </FormField>
              <FormField label={t("registerUnit.city")} helper={t("common.optional")}>
                <Input autoComplete="address-level2" {...register("city")} />
              </FormField>
              {model ? (
                <p className="flex items-center gap-2 rounded bg-success-bg p-3 text-body text-success">
                  <ShieldCheck size={20} strokeWidth={1.75} aria-hidden />
                  {t("registerUnit.partsPreview", {
                    parts: model.parts
                      .map((p) =>
                        t("registerUnit.partPeriod", {
                          part: t(`parts.type.${p.partType}`),
                          period:
                            p.warrantyMonths % 12 === 0
                              ? t("parts.years", { count: p.warrantyMonths / 12 })
                              : t("parts.months", { count: p.warrantyMonths }),
                        }),
                      )
                      .join(", "),
                  })}
                </p>
              ) : null}
            </>
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
            {step < 2 ? (
              <Button icon={ArrowRight} onClick={() => void next()}>
                {t("common.next")}
              </Button>
            ) : (
              <Button type="submit" icon={ShieldCheck} loading={submitting}>
                {t("registerUnit.submit")}
              </Button>
            )}
          </div>
        </form>
      </Card>
      <QrScannerModal open={scanning} onOpenChange={setScanning} onResult={onScan} />
    </>
  );
}

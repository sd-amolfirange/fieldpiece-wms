import { zodResolver } from "@hookform/resolvers/zod";
import { CheckCircle2, QrCode as QrIcon, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router-dom";
import type { Attachment } from "@wms/domain";
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
  type UploadItem,
} from "@/components/ui";
import { QrScannerModal, type QrPayload } from "@/features/qr";
import { applyFieldErrors, toApiError } from "@/lib/api-error";
import { toIsoDate } from "@/lib/format";
import { useModels } from "@/features/catalog";
import { uploadAll } from "@/features/files";
import { useFieldError } from "@/lib/use-field-error";
import { useCreateRegistration } from "../hooks";
import { selfRegisterSchema, type SelfRegisterForm } from "../schemas";

// CU01 Register a product (customer, phone layout). Opens from the QR label with serial and model filled in;
// the customer adds the purchase date and a photo of the invoice. An admin approves it before the warranty starts.

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-overline text-text-muted">{label}</dt>
      <dd className="mt-1 text-body">{children}</dd>
    </div>
  );
}

export default function CustomerRegisterPage() {
  const { t } = useTranslation();
  const fieldError = useFieldError();
  const [searchParams] = useSearchParams();
  const models = useModels();
  const create = useCreateRegistration();
  const [files, setFiles] = useState<UploadItem[]>([]);
  const [scanning, setScanning] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const uploaded = useRef(new Map<File, Attachment>());
  const fromQr = !!searchParams.get("serial");

  const {
    register,
    handleSubmit,
    setValue,
    setError,
    watch,
    reset,
    formState: { errors },
  } = useForm<SelfRegisterForm>({
    resolver: zodResolver(selfRegisterSchema),
    defaultValues: {
      serial: searchParams.get("serial") ?? "",
      modelCode: (searchParams.get("model") ?? "").toUpperCase(),
      purchaseDate: "",
      invoiceCount: 0,
    },
  });

  useEffect(
    () => setValue("invoiceCount", files.length, { shouldValidate: files.length > 0 }),
    [files, setValue],
  );

  const serial = watch("serial");
  const modelCode = watch("modelCode");
  const model = models.data?.find((m) => m.code === modelCode);
  const [prefilled, setPrefilled] = useState(fromQr);

  const onScan = useCallback(
    (payload: QrPayload) => {
      setValue("serial", payload.serial, { shouldValidate: true });
      if (payload.modelCode) setValue("modelCode", payload.modelCode, { shouldValidate: true });
      setPrefilled(!!payload.modelCode);
    },
    [setValue],
  );

  const onSubmit = handleSubmit(async (values) => {
    setSubmitting(true);
    try {
      const attachmentIds = await uploadAll(files, setFiles, uploaded.current);
      await create.mutateAsync({
        serial: values.serial,
        modelCode: values.modelCode,
        purchaseDate: values.purchaseDate,
        location: values.location,
        attachmentIds,
      });
      setDone(true);
    } catch (error) {
      if (!applyFieldErrors(error, setError)) toast.error(toApiError(error).message);
    } finally {
      setSubmitting(false);
    }
  });

  if (done) {
    return (
      <div className="mx-auto max-w-xl">
        <Card className="text-center">
          <CheckCircle2 size={24} strokeWidth={1.75} className="mx-auto mb-3 text-success" aria-hidden />
          <h1 className="text-h1">{t("selfRegister.sentTitle")}</h1>
          <p className="mt-2">
            <MonoId>{serial}</MonoId>
          </p>
          <div className="mt-2">
            <RegistrationStatusBadge status="PENDING" />
          </div>
          <p className="mt-4 text-body text-text-muted">{t("selfRegister.pendingMessage")}</p>
          <div className="mt-6 flex flex-col justify-center gap-2 sm:flex-row">
            <Link to="/" className={buttonVariants()}>
              {t("selfRegister.backToUnits")}
            </Link>
            <Button
              variant="secondary"
              onClick={() => {
                setDone(false);
                setFiles([]);
                uploaded.current.clear();
                setPrefilled(false);
                reset({ serial: "", modelCode: "", purchaseDate: "", invoiceCount: 0 });
              }}
            >
              {t("selfRegister.registerAnother")}
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl">
      <PageHeader
        title={t("nav.registerProduct")}
        breadcrumbs={[{ label: t("nav.myUnits"), to: "/" }, { label: t("nav.registerProduct") }]}
      />
      <Card>
        <form noValidate onSubmit={onSubmit} className="space-y-4">
          {prefilled && serial ? (
            <div className="space-y-2">
              <p className="rounded bg-info-bg p-3 text-sm text-info">{t("selfRegister.fromQr")}</p>
              <dl className="grid gap-4 sm:grid-cols-2">
                <Field label={t("fields.serialNumber")}>
                  <MonoId>{serial}</MonoId>
                </Field>
                <Field label={t("selfRegister.model")}>
                  {model ? `${model.name} (${model.code})` : modelCode}
                </Field>
              </dl>
              <Button variant="ghost" size="sm" icon={QrIcon} onClick={() => setScanning(true)}>
                {t("selfRegister.scanAgain")}
              </Button>
            </div>
          ) : (
            <>
              <Button variant="secondary" icon={QrIcon} className="w-full" onClick={() => setScanning(true)}>
                {t("selfRegister.scan")}
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
                label={t("selfRegister.model")}
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
            </>
          )}

          <FormField
            label={t("selfRegister.purchaseDate")}
            error={fieldError(errors.purchaseDate?.message)}
            required
          >
            <Input type="date" max={toIsoDate(new Date())} {...register("purchaseDate")} />
          </FormField>
          <FormField label={t("selfRegister.location")} helper={t("common.optional")}>
            <Input autoComplete="street-address" {...register("location")} />
          </FormField>
          <FormField
            label={t("selfRegister.invoice")}
            error={fieldError(errors.invoiceCount?.message) ?? fieldError(errors.root?.message)}
            required
          >
            <FileDropzone
              value={files}
              onChange={setFiles}
              maxFiles={3}
              onReject={(m) => m.forEach((msg) => toast.error(msg))}
            />
          </FormField>

          <div className="border-t border-border pt-6">
            <Button type="submit" icon={ShieldCheck} loading={submitting} className="w-full">
              {t("selfRegister.submit")}
            </Button>
          </div>
        </form>
      </Card>
      <QrScannerModal open={scanning} onOpenChange={setScanning} onResult={onScan} />
    </div>
  );
}

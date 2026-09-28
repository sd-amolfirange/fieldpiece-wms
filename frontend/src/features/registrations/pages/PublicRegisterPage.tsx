import { zodResolver } from "@hookform/resolvers/zod";
import { CheckCircle2, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router-dom";
import { toast } from "@/components/feedback";
import { AuthLayout } from "@/components/layout";
import {
  Button,
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
import { dropHeic } from "@/features/files";
import { applyFieldErrors, toApiError } from "@/lib/api-error";
import { toIsoDate } from "@/lib/format";
import { useFieldError } from "@/lib/use-field-error";
import { usePublicModels, usePublicRegister } from "../hooks";
import { publicRegisterSchema, type PublicRegisterForm } from "../schemas";

// Public product registration (website form, channel WEB): anyone who bought a Fieldpiece product registers it
// without an account, with a photo or PDF of the receipt. The warranty desk reviews it; the warranty then runs from
// the purchase date. The link can carry serial, model and batch (?serial=&model=&batch=), like the QR label.

export default function PublicRegisterPage() {
  const { t } = useTranslation();
  const fieldError = useFieldError();
  const [searchParams] = useSearchParams();
  const models = usePublicModels();
  const submit = usePublicRegister();
  const [files, setFiles] = useState<UploadItem[]>([]);
  const [done, setDone] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    setValue,
    setError,
    watch,
    reset,
    formState: { errors },
  } = useForm<PublicRegisterForm>({
    resolver: zodResolver(publicRegisterSchema),
    defaultValues: {
      serial: searchParams.get("serial") ?? "",
      modelCode: (searchParams.get("model") ?? "").toUpperCase(),
      batchNumber: (searchParams.get("batch") ?? "").toUpperCase(),
      purchaseDate: "",
      customerName: "",
      customerEmail: "",
      website: "",
      invoiceCount: 0,
    },
  });

  useEffect(
    () => setValue("invoiceCount", files.length, { shouldValidate: files.length > 0 }),
    [files, setValue],
  );
  const serial = watch("serial");

  const onSubmit = handleSubmit(async ({ invoiceCount: _count, ...fields }) => {
    const proof = files[0]?.file;
    if (!proof) return;
    try {
      await submit.mutateAsync({ fields, proof });
      setDone(fields.serial);
    } catch (error) {
      const api = toApiError(error);
      if (api.fieldErrors?.attachmentIds)
        setError("invoiceCount", { message: api.fieldErrors.attachmentIds });
      if (!applyFieldErrors(error, setError)) toast.error(api.message);
    }
  });

  if (done) {
    return (
      <AuthLayout wide>
        <Card className="text-center">
          <CheckCircle2 size={24} strokeWidth={1.75} className="mx-auto mb-3 text-success" aria-hidden />
          <h1 className="text-h1">{t("publicRegister.sentTitle")}</h1>
          <p className="mt-2">
            <MonoId>{done || serial}</MonoId>
          </p>
          <div className="mt-2">
            <RegistrationStatusBadge status="PENDING" />
          </div>
          <p className="mt-4 text-body text-text-muted">{t("publicRegister.sentMessage")}</p>
          <div className="mt-6 flex flex-col justify-center gap-2 sm:flex-row">
            <Button
              variant="secondary"
              onClick={() => {
                setDone(null);
                setFiles([]);
                reset({
                  serial: "",
                  modelCode: "",
                  batchNumber: "",
                  purchaseDate: "",
                  customerName: "",
                  customerEmail: "",
                  website: "",
                  invoiceCount: 0,
                });
              }}
            >
              {t("publicRegister.registerAnother")}
            </Button>
          </div>
        </Card>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout wide>
      <Card>
        <h1 className="text-h1">{t("publicRegister.title")}</h1>
        <p className="mb-6 mt-2 text-body text-text-muted">{t("publicRegister.intro")}</p>
        <form noValidate onSubmit={onSubmit} className="space-y-4">
          <h2 className="text-h3">{t("publicRegister.product")}</h2>
          <FormField label={t("selfRegister.model")} error={fieldError(errors.modelCode?.message)} required>
            <NativeSelect {...register("modelCode")} disabled={models.isLoading}>
              <option value="">—</option>
              {models.data?.map((m) => (
                <option key={m.id} value={m.code}>
                  {m.code} · {m.name}
                </option>
              ))}
            </NativeSelect>
          </FormField>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              label={t("fields.serialNumber")}
              error={fieldError(errors.serial?.message)}
              required
              labelAction={<SerialHelpLink />}
            >
              <SerialNumberInput {...register("serial")} />
            </FormField>
            <FormField
              label={t("fields.batchNumber")}
              helper={t("fields.batchHelp")}
              error={fieldError(errors.batchNumber?.message)}
            >
              <Input className="font-mono" autoComplete="off" {...register("batchNumber")} />
            </FormField>
          </div>

          <h2 className="text-h3">{t("publicRegister.purchase")}</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              label={t("fields.purchaseDate")}
              error={fieldError(errors.purchaseDate?.message)}
              required
            >
              <Input type="date" max={toIsoDate(new Date())} {...register("purchaseDate")} />
            </FormField>
            <FormField
              label={t("selfRegister.placeOfPurchase")}
              helper={t("selfRegister.placeOfPurchaseHelp")}
            >
              <Input {...register("placeOfPurchase")} />
            </FormField>
          </div>
          <FormField label={t("registerUnit.invoiceNumber")} helper={t("common.optional")}>
            <Input {...register("invoiceNumber")} />
          </FormField>
          <FormField
            label={t("selfRegister.invoice")}
            error={fieldError(errors.invoiceCount?.message)}
            required
          >
            <FileDropzone
              value={files}
              onChange={(next) => {
                const { kept, heic } = dropHeic(next);
                heic.forEach((name) => toast.error(t("fields.heicNotSupported", { name })));
                setFiles(kept);
              }}
              maxFiles={1}
              onReject={(m) => m.forEach((msg) => toast.error(msg))}
            />
          </FormField>

          <h2 className="text-h3">{t("publicRegister.owner")}</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              label={t("registerUnit.customerName")}
              error={fieldError(errors.customerName?.message)}
              required
            >
              <Input autoComplete="name" {...register("customerName")} />
            </FormField>
            <FormField
              label={t("registerUnit.customerEmail")}
              helper={t("publicRegister.emailHelp")}
              error={fieldError(errors.customerEmail?.message)}
              required
            >
              <Input type="email" autoComplete="email" {...register("customerEmail")} />
            </FormField>
            <FormField label={t("registerUnit.customerPhone")} helper={t("common.optional")}>
              <Input type="tel" autoComplete="tel" {...register("customerPhone")} />
            </FormField>
            <FormField label={t("registerUnit.city")} helper={t("common.optional")}>
              <Input autoComplete="address-level2" {...register("city")} />
            </FormField>
            <FormField
              label={t("fields.state")}
              helper={t("fields.stateHelp")}
              error={fieldError(errors.state?.message)}
            >
              <Input autoComplete="address-level1" maxLength={2} {...register("state")} />
            </FormField>
            <FormField label={t("fields.zip")} error={fieldError(errors.zip?.message)}>
              <Input inputMode="numeric" autoComplete="postal-code" {...register("zip")} />
            </FormField>
          </div>
          {/* Honeypot: hidden from people and screen readers; bots fill it in and are ignored. */}
          <div className="sr-only" aria-hidden="true">
            <label htmlFor="website">{t("publicRegister.honeypot")}</label>
            <input id="website" tabIndex={-1} autoComplete="off" {...register("website")} />
          </div>

          <div className="border-t border-border pt-6">
            <Button type="submit" icon={ShieldCheck} loading={submit.isPending} className="w-full">
              {t("publicRegister.submit")}
            </Button>
            <p className="mt-4 text-center text-sm text-text-muted">
              {t("publicRegister.haveAccount")}{" "}
              <Link to="/login" className="text-info underline underline-offset-2 hover:no-underline">
                {t("auth.signIn")}
              </Link>
            </p>
          </div>
        </form>
      </Card>
    </AuthLayout>
  );
}

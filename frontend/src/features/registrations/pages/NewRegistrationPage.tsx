import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft, ArrowRight, CheckCircle2, Download, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { useForm, type FieldPath } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
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
  type UploadItem,
} from "@/components/ui";
import { applyFieldErrors, toApiError } from "@/lib/api-error";
import { toIsoDate } from "@/lib/format";
import { useCurrentUser } from "@/lib/session";
import type { Registration } from "@/types";
import { WarrantyPreview } from "../components/WarrantyPreview";
import { useCreateRegistration, useProductCatalogue } from "../hooks";
import { detectSku, registrationSchema, type RegistrationForm } from "../schemas";

// Section 8.3: Product -> Purchase -> Owner and review.
// TODO: searchable SKU picker with product images; seller autocomplete; certificate PDF download.

const STEP_FIELDS: FieldPath<RegistrationForm>[][] = [
  ["serialNumber", "sku"],
  ["purchaseDate", "sellerName", "proofCount"],
  ["ownerName", "ownerEmail", "ownerPhone", "acceptTerms"],
];

export default function NewRegistrationPage() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const user = useCurrentUser();
  const products = useProductCatalogue();
  const create = useCreateRegistration();
  const [step, setStep] = useState(0);
  const [files, setFiles] = useState<UploadItem[]>([]);
  const [created, setCreated] = useState<Registration | null>(null);

  const {
    register,
    handleSubmit,
    trigger,
    watch,
    setValue,
    setError,
    reset,
    formState: { errors },
  } = useForm<RegistrationForm>({
    resolver: zodResolver(registrationSchema),
    defaultValues: {
      serialNumber: searchParams.get("serial") ?? "",
      sku: "",
      purchaseDate: "",
      proofCount: 0,
      // Pre-filled for a signed-in customer.
      ownerName: user?.role === "customer" ? user.name : "",
      ownerEmail: user?.role === "customer" ? user.email : "",
    },
  });

  const serial = watch("serialNumber");
  const sku = watch("sku");
  const purchaseDate = watch("purchaseDate");
  const product = products.data?.find((p) => p.sku === sku);

  useEffect(() => setValue("proofCount", files.length), [files, setValue]);
  useEffect(() => setValue("launchDate", product?.launchDate), [product, setValue]);
  useEffect(() => {
    if (!products.data || sku) return;
    const detected = detectSku(serial, products.data);
    if (detected) setValue("sku", detected, { shouldValidate: true });
  }, [serial, sku, products.data, setValue]);

  const next = async () => {
    if (await trigger(STEP_FIELDS[step], { shouldFocus: true })) setStep((s) => s + 1);
  };

  const onSubmit = handleSubmit((values) =>
    create.mutate(
      {
        serialNumber: values.serialNumber,
        sku: values.sku,
        purchaseDate: values.purchaseDate,
        sellerName: values.sellerName,
        proofOfPurchaseIds: [], // TODO: presigned upload of `files`, then pass attachment IDs
        owner: { name: values.ownerName, email: values.ownerEmail, phone: values.ownerPhone },
        acceptTerms: true,
      },
      {
        onSuccess: setCreated,
        onError: (error) => {
          if (toApiError(error).code === "duplicate_serial") setStep(0);
          if (!applyFieldErrors(error, setError)) toast.error(toApiError(error).message);
        },
      },
    ),
  );

  if (created) {
    return (
      <Card className="mx-auto max-w-xl text-center">
        <CheckCircle2 size={24} strokeWidth={1.75} className="mx-auto mb-3 text-success" aria-hidden />
        <h1 className="text-h1">{t("registrations.new")}</h1>
        <p className="mt-2 text-body">
          <MonoId>{created.id}</MonoId>
        </p>
        <div className="mt-6 flex flex-col justify-center gap-2 sm:flex-row">
          <Button variant="secondary" icon={Download}>
            Download certificate (PDF)
          </Button>
          <Button
            icon={ShieldCheck}
            onClick={() => {
              setCreated(null);
              setFiles([]);
              setStep(0);
              reset();
            }}
          >
            Register another
          </Button>
        </div>
      </Card>
    );
  }

  const steps = [
    t("registrations.stepProduct"),
    t("registrations.stepPurchase"),
    t("registrations.stepReview"),
  ];

  return (
    <>
      <PageHeader
        title={t("registrations.new")}
        breadcrumbs={[
          { label: t("registrations.title"), to: "/registrations" },
          { label: t("registrations.new") },
        ]}
      />
      <Card className="mx-auto max-w-3xl">
        <Stepper steps={steps} current={step} className="mb-8" />
        <form noValidate onSubmit={onSubmit} className="space-y-4">
          {step === 0 ? (
            <>
              <FormField
                label={t("fields.serialNumber")}
                error={errors.serialNumber?.message}
                required
                labelAction={<SerialHelpLink />}
              >
                <SerialNumberInput {...register("serialNumber")} />
              </FormField>
              <FormField label={t("registrations.pickSku")} error={errors.sku?.message} required>
                <NativeSelect {...register("sku")} disabled={products.isLoading}>
                  <option value="">—</option>
                  {products.data?.map((p) => (
                    <option key={p.sku} value={p.sku}>
                      {p.sku} · {p.name}
                    </option>
                  ))}
                </NativeSelect>
              </FormField>
            </>
          ) : null}

          {step === 1 ? (
            <>
              <FormField label={t("fields.purchaseDate")} error={errors.purchaseDate?.message} required>
                <Input
                  type="date"
                  max={toIsoDate(new Date())}
                  min={product?.launchDate}
                  {...register("purchaseDate")}
                />
              </FormField>
              <FormField label="Seller or distributor" helper={t("common.optional")}>
                <Input autoComplete="organization" {...register("sellerName")} />
              </FormField>
              <FormField label="Proof of purchase" error={errors.proofCount?.message} required>
                <FileDropzone
                  value={files}
                  onChange={setFiles}
                  maxFiles={3}
                  onReject={(m) => m.forEach((msg) => toast.error(msg))}
                />
              </FormField>
              <WarrantyPreview product={product} purchaseDate={purchaseDate} />
            </>
          ) : null}

          {step === 2 ? (
            <>
              <FormField label="Owner name" error={errors.ownerName?.message} required>
                <Input autoComplete="name" {...register("ownerName")} />
              </FormField>
              <FormField label={t("fields.email")} error={errors.ownerEmail?.message} required>
                <Input type="email" autoComplete="email" {...register("ownerEmail")} />
              </FormField>
              <FormField label="Phone" helper={t("common.optional")}>
                <Input type="tel" autoComplete="tel" {...register("ownerPhone")} />
              </FormField>
              <WarrantyPreview product={product} purchaseDate={purchaseDate} />
              <div>
                <label className="inline-flex min-h-11 items-center gap-2 text-body">
                  <input
                    type="checkbox"
                    className="h-5 w-5 rounded-sm border-ink-400 text-ink-1000 focus:ring-ink-1000"
                    aria-invalid={errors.acceptTerms ? true : undefined}
                    {...register("acceptTerms")}
                  />
                  {t("registrations.acceptTerms")}
                </label>
                {errors.acceptTerms ? (
                  <p className="text-sm text-danger">{errors.acceptTerms.message}</p>
                ) : null}
              </div>
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
              <Button type="submit" icon={ShieldCheck} loading={create.isPending}>
                {t("registrations.new")}
              </Button>
            )}
          </div>
        </form>
      </Card>
    </>
  );
}

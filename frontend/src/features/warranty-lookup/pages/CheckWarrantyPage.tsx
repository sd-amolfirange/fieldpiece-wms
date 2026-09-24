import { zodResolver } from "@hookform/resolvers/zod";
import { Search } from "lucide-react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { AuthLayout } from "@/components/layout";
import { Button, Card, FormField, SerialHelpLink, SerialNumberInput } from "@/components/ui";
import { toApiError } from "@/lib/api-error";
import { WarrantyResultCard } from "../components/WarrantyResultCard";
import { useWarrantyCheck } from "../hooks";
import { warrantyCheckSchema, type WarrantyCheckForm } from "../schemas";

// Section 8.1: public, no login, one serial input. Serial lives in the URL so results are shareable.

export default function CheckWarrantyPage() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const serial = searchParams.get("serial");
  const check = useWarrantyCheck(serial);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<WarrantyCheckForm, unknown, { serial: string }>({
    resolver: zodResolver(warrantyCheckSchema),
    defaultValues: { serial: serial ?? "" },
  });

  const onSubmit = handleSubmit(({ serial: value }) => setSearchParams({ serial: value }, { replace: true }));
  const apiError = check.error ? toApiError(check.error) : null;

  return (
    <AuthLayout wide>
      <h1 className="text-display">{t("check.title")}</h1>
      <p className="mb-6 mt-2 text-body text-text-muted">{t("check.intro")}</p>

      <Card as="div" className="mb-6">
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-3 sm:flex-row sm:items-start">
          <FormField
            className="flex-1"
            label={t("fields.serialNumber")}
            error={errors.serial?.message}
            required
            labelAction={<SerialHelpLink />}
          >
            <SerialNumberInput placeholder="AER-SPL15-240917" {...register("serial")} />
          </FormField>
          <Button type="submit" size="lg" icon={Search} loading={check.isFetching} className="sm:mt-6">
            {t("check.submit")}
          </Button>
        </form>
      </Card>

      {apiError ? (
        <p role="alert" className="rounded border-s-4 border-danger bg-danger-bg p-4 text-body">
          {apiError.status === 404 ? t("check.notFound") : apiError.message}
        </p>
      ) : null}
      {check.data ? <WarrantyResultCard result={check.data} /> : null}
    </AuthLayout>
  );
}

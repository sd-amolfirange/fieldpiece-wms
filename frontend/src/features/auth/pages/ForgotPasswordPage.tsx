import { zodResolver } from "@hookform/resolvers/zod";
import { Mail } from "lucide-react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { toast } from "@/components/feedback";
import { AuthLayout } from "@/components/layout";
import { Button, Card, FormField, Input } from "@/components/ui";
import { toApiError } from "@/lib/api-error";
import { env } from "@/lib/env";
import { useForgotPassword } from "../hooks";
import { forgotPasswordSchema, type ForgotPasswordForm } from "../schemas";

export default function ForgotPasswordPage() {
  const { t } = useTranslation();
  const forgot = useForgotPassword();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ForgotPasswordForm>({ resolver: zodResolver(forgotPasswordSchema) });

  const onSubmit = handleSubmit(({ email }) =>
    forgot.mutate(email, { onError: (error) => toast.error(toApiError(error).message) }),
  );

  return (
    <AuthLayout>
      <Card as="div">
        <h1 className="mb-2 text-h1">{t("auth.forgotTitle")}</h1>
        {!env.showForgotPassword ? (
          // Demo build: no password reset behind this page (VITE_SHOW_FORGOT_PASSWORD=false).
          <p role="status" className="text-body">
            {t("auth.contactAdmin")}
          </p>
        ) : forgot.isSuccess ? (
          <p role="status" className="text-body">
            {t("auth.resetSent")}
          </p>
        ) : (
          <>
            <p className="mb-6 text-body text-text-muted">{t("auth.forgotBody")}</p>
            <form onSubmit={onSubmit} noValidate className="space-y-4">
              <FormField label={t("fields.email")} error={errors.email?.message} required>
                <Input type="email" autoComplete="email" {...register("email")} />
              </FormField>
              <Button type="submit" size="lg" icon={Mail} loading={forgot.isPending} className="w-full">
                {t("auth.sendResetLink")}
              </Button>
            </form>
          </>
        )}
      </Card>
      <p className="mt-6 text-center">
        <Link to="/login" className="text-info underline underline-offset-2">
          {t("auth.backToSignIn")}
        </Link>
      </p>
    </AuthLayout>
  );
}

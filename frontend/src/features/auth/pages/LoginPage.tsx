import { zodResolver } from "@hookform/resolvers/zod";
import { LogIn } from "lucide-react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { toast } from "@/components/feedback";
import { AuthLayout } from "@/components/layout";
import { Button, Card, FormField, Input, NativeSelect } from "@/components/ui";
import { applyFieldErrors, toApiError } from "@/lib/api-error";
import { env } from "@/lib/env";
import { useSession } from "@/lib/session";
import { useLogin } from "../hooks";
import { loginSchema, type LoginForm } from "../schemas";
import { DEMO_ACCOUNTS, DEMO_PASSWORD } from "../types";

const showDemoAccounts = env.enableMocks || env.demoMode;

export default function LoginPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const status = useSession((s) => s.status);
  const login = useLogin();
  const from = (location.state as { from?: string } | null)?.from ?? "/";

  const {
    register,
    handleSubmit,
    setError,
    setValue,
    formState: { errors },
  } = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  const pickAccount = (email: string) => {
    setValue("email", email, { shouldValidate: !!email });
    setValue("password", email ? DEMO_PASSWORD : "", { shouldValidate: !!email });
  };

  if (status === "authenticated") return <Navigate to={from} replace />;

  const onSubmit = handleSubmit((values) =>
    login.mutate(values, {
      onSuccess: () => navigate(from, { replace: true }),
      onError: (error) => {
        if (!applyFieldErrors(error, setError)) toast.error(toApiError(error).message);
      },
    }),
  );

  return (
    <AuthLayout>
      <Card as="div">
        <h1 className="mb-6 text-h1">{t("auth.signInTitle")}</h1>
        {showDemoAccounts ? (
          <p className="mb-4 rounded bg-info-bg p-3 text-sm text-info">{t("auth.demoNotice")}</p>
        ) : null}
        <form onSubmit={onSubmit} noValidate className="space-y-4">
          <FormField label={t("fields.email")} error={errors.email?.message} required>
            <Input type="email" autoComplete="email" {...register("email")} />
          </FormField>
          <FormField
            label={t("fields.password")}
            error={errors.password?.message}
            required
            labelAction={
              <Link to="/forgot-password" className="text-sm text-info underline underline-offset-2">
                {t("auth.forgotPassword")}
              </Link>
            }
          >
            <Input type="password" autoComplete="current-password" {...register("password")} />
          </FormField>
          {showDemoAccounts ? (
            <FormField label={t("auth.mockRole")}>
              <NativeSelect defaultValue="" onChange={(e) => pickAccount(e.target.value)}>
                <option value="">{t("auth.pickAccount")}</option>
                {DEMO_ACCOUNTS.map((account) => (
                  <option key={account.email} value={account.email}>
                    {t(account.labelKey)}
                  </option>
                ))}
              </NativeSelect>
            </FormField>
          ) : null}
          <Button type="submit" size="lg" icon={LogIn} loading={login.isPending} className="w-full">
            {t("auth.signIn")}
          </Button>
        </form>
      </Card>
    </AuthLayout>
  );
}

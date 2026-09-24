import { HelpCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { env } from "@/lib/env";
import { supportedLanguages } from "@/lib/i18n";

// Section 6.1: ink-900, 32px: environment tag, help, language.

export function TopBar() {
  const { t, i18n } = useTranslation();
  const envKey = env.enableMocks ? "mock" : env.mode === "production" ? "production" : "development";

  return (
    <div className="no-print flex h-topbar items-center justify-between bg-topbar px-4 text-xs text-ink-300 md:px-6">
      {env.showEnvironmentTag ? (
        <span className="text-overline rounded-sm bg-ink-700 px-2 py-0.5 text-brand-500">
          {t(`app.environment.${envKey}`)}
        </span>
      ) : (
        <span />
      )}
      <div className="flex items-center gap-4">
        <a
          href="https://www.fieldpiece.com/support/"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-link-on-dark hover:underline"
        >
          <HelpCircle size={14} strokeWidth={1.75} aria-hidden />
          {t("topbar.help")}
        </a>
        <label className="inline-flex items-center gap-1">
          <span className="sr-only">{t("topbar.language")}</span>
          <select
            value={i18n.resolvedLanguage}
            onChange={(e) => void i18n.changeLanguage(e.target.value)}
            className="h-6 rounded-sm border-ink-600 bg-ink-900 py-0 pe-7 ps-2 text-xs text-ink-100 focus:border-brand-500 focus:ring-brand-500"
          >
            {supportedLanguages.map((lang) => (
              <option key={lang.code} value={lang.code}>
                {lang.label}
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
}

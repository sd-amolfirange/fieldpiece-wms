import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import logoUrl from "@/assets/brand/fieldpiece-logo-dev.png";
import { cn } from "@/lib/cn";

// Section 3.1 lockup: wordmark | thin 1px divider | "Warranty" in Myriad Pro Regular.
// [CONFIRM] swap the dev PNG for the official SVG (black / white / single-colour) and the sub-brand name.

interface LogoProps {
  className?: string;
  /** Hide the "Warranty" sub-brand, e.g. on very narrow screens. */
  compact?: boolean;
}

export function Logo({ className, compact }: LogoProps) {
  const { t } = useTranslation();
  return (
    <Link to="/" className={cn("inline-flex items-center gap-3 p-1", className)}>
      <img
        src={logoUrl}
        alt={t("app.logoAlt")}
        width={136}
        height={24}
        className="h-6 w-auto min-w-[120px] dark:invert"
      />
      {compact ? null : (
        <>
          <span className="hidden h-6 w-px bg-current opacity-60 md:block" aria-hidden />
          <span className="hidden text-h3 font-normal md:block">{t("app.name")}</span>
        </>
      )}
    </Link>
  );
}

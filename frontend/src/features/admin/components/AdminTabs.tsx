import { NavLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/cn";

// A11 / A12 / A13. The legacy users, policies and settings screens are out of scope and not routed.
const tabs = [
  { to: "/admin/dealers", key: "admin.dealers" },
  { to: "/admin/integrations", key: "admin.integrations" },
  { to: "/admin/simulate", key: "admin.simulate" },
];

export function AdminTabs() {
  const { t } = useTranslation();
  return (
    <nav aria-label={t("nav.admin")} className="mb-6 flex gap-1 border-b border-border">
      {tabs.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          className={({ isActive }) =>
            cn(
              "-mb-px flex h-11 items-center border-b-4 px-4 text-body",
              isActive ? "border-brand-500 font-bold" : "border-transparent text-text-muted hover:text-text",
            )
          }
        >
          {t(tab.key)}
        </NavLink>
      ))}
    </nav>
  );
}

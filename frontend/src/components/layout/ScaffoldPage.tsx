import { Construction } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { EmptyState } from "../feedback/EmptyState";
import { Card } from "../ui/Card";
import { PageHeader, type Crumb } from "./PageHeader";

// Placeholder for screens that are routed but not built yet. Lists what the build guide asks for,
// so whoever picks the screen up has the checklist in front of them. Delete once the screen is real.

interface ScaffoldPageProps {
  title: string;
  breadcrumbs?: Crumb[];
  actions?: ReactNode;
  /** Build guide section, e.g. "8.6". */
  section: string;
  todo: string[];
  children?: ReactNode;
}

export function ScaffoldPage({ title, breadcrumbs, actions, section, todo, children }: ScaffoldPageProps) {
  const { t } = useTranslation();
  return (
    <>
      <PageHeader title={title} breadcrumbs={breadcrumbs} actions={actions} />
      {children}
      <Card>
        <EmptyState icon={Construction} message={t("common.comingSoon")} className="py-6" />
        <div className="mx-auto max-w-xl">
          <p className="text-overline mb-2 text-text-muted">{t("screens.comingLater", { section })}</p>
          <ul className="list-disc space-y-1 ps-5 text-body">
            {todo.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      </Card>
    </>
  );
}

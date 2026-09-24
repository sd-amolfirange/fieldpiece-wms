import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ScaffoldPage } from "@/components/layout";
import { useCurrentRole } from "@/lib/session";
import type { Role } from "@/types";

// Stand-in for a demo screen that a later phase builds. Shows the screen code and its "must contain" list
// from docs/Demo workflows.md, so every route is reachable and checkable from Phase 1 on.

export type ScreenCode =
  | "A02"
  | "A03"
  | "A04"
  | "A05"
  | "A06"
  | "A07"
  | "A08"
  | "A09"
  | "A10"
  | "A11"
  | "A12"
  | "A13"
  | "DL02"
  | "DL03"
  | "DL04"
  | "DL05"
  | "DL06"
  | "DL07"
  | "CU01"
  | "CU03"
  | "CU04"
  | "CU05";

const PHASE: Record<ScreenCode, number> = {
  A02: 2,
  A03: 2,
  A04: 2,
  A05: 2,
  A06: 2,
  A07: 3,
  A08: 3,
  A09: 3,
  A10: 3,
  A11: 5,
  A12: 3,
  A13: 3,
  DL02: 2,
  DL03: 2,
  DL04: 2,
  DL05: 2,
  DL06: 4,
  DL07: 4,
  CU01: 2,
  CU03: 2,
  CU04: 3,
  CU05: 3,
};

export default function ScreenPlaceholderPage({
  screens,
  children,
}: {
  screens: Partial<Record<Role, ScreenCode>>;
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  const role = useCurrentRole();
  const code = (role && screens[role]) ?? Object.values(screens)[0] ?? "A02";
  const mustContain = t(`screens.${code}.mustContain`, { returnObjects: true }) as unknown;

  return (
    <ScaffoldPage
      title={`${code} · ${t(`screens.${code}.title`)}`}
      section={t("screens.phase", { code, phase: PHASE[code] })}
      todo={Array.isArray(mustContain) ? mustContain.map(String) : []}
    >
      {children}
    </ScaffoldPage>
  );
}

import type { UnitView } from "@wms/domain";
import type { TFunction } from "i18next";
import { formatDate } from "@/lib/format";

/** One-line warranty summary: countdown, expiry date, or why it isn't covered. */
export function unitStatusLine(unit: UnitView, t: TFunction, lang: string): string {
  const unitPart = unit.parts.find((p) => p.partType === "UNIT" && !p.replacedAt);
  switch (unit.status) {
    case "ACTIVE":
    case "EXPIRING_SOON":
      return t("units.countdown", { count: unit.daysRemaining });
    case "EXPIRED":
      return t("units.expiredOn", { date: formatDate(unitPart?.warrantyEnd, lang) });
    case "VOID":
      return t("units.voidLine");
    default:
      return t("units.notRegistered");
  }
}

/** The part covered longest after the unit warranty has ended (e.g. "Compressor covered until 11 Mar 2031"). */
export function stillCoveredLine(unit: UnitView, t: TFunction, lang: string): string | null {
  if (unit.status !== "EXPIRED") return null;
  const covered = unit.parts
    .filter(
      (p) =>
        !p.replacedAt && p.partType !== "UNIT" && (p.status === "ACTIVE" || p.status === "EXPIRING_SOON"),
    )
    .sort((a, b) => b.warrantyEnd.localeCompare(a.warrantyEnd))[0];
  return covered
    ? t("units.partStillCovered", {
        part: t(`parts.type.${covered.partType}`),
        date: formatDate(covered.warrantyEnd, lang),
      })
    : null;
}

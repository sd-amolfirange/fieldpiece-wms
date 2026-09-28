import type { UnitView } from "@wms/domain";
import type { TFunction } from "i18next";
import { formatDate } from "@/lib/format";

/** One-line warranty summary: countdown, expiry date, or why it isn't covered. */
export function unitStatusLine(unit: UnitView, t: TFunction, lang: string): string {
  if (unit.replacedBySerial) return t("units.replacedLine", { serial: unit.replacedBySerial });
  switch (unit.status) {
    case "ACTIVE":
    case "EXPIRING_SOON":
      return t("units.countdown", { count: unit.daysRemaining });
    case "EXPIRED":
      return t("units.expiredOn", { date: formatDate(unit.warrantyEnd, lang) });
    case "VOID":
      return t("units.voidLine");
    default:
      return t("units.notRegistered");
  }
}

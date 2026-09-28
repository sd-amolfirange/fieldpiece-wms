import { addDaysIso, addMonthsIso, daysBetween } from "./dates";
import type { Coverage, IsoDate, Model, Unit, WarrantyStatus } from "./types";

// Warranty rules (Fieldpiece: "All of our products have a 1 year warranty from date of purchase"):
// - one warranty per product: it starts on the purchase date and runs for the model's warranty months;
// - the end day itself is still covered (end = start + months - 1 day);
// - "Expiring soon" means 30 days or fewer remain;
// - Void overrides everything; a product that was replaced is no longer covered (its replacement is);
// - a replacement product carries the rest of the original warranty. [CONFIRM replacement warranty rule]

export const EXPIRING_SOON_DAYS = 30;

export interface WarrantyState {
  status: WarrantyStatus;
  daysRemaining: number;
}

/** Last covered day for a warranty that starts on `start` and runs for `months`. */
export const warrantyEndFor = (start: IsoDate, months: number): IsoDate =>
  addDaysIso(addMonthsIso(start, months), -1);

/** Warranty status of a product for `today`: Pending before registration, Void once voided. */
export function unitWarranty(
  unit: Pick<Unit, "warrantyEnd" | "void" | "replacedBySerial">,
  today: IsoDate,
): WarrantyState {
  if (unit.void) return { status: "VOID", daysRemaining: 0 };
  if (!unit.warrantyEnd) return { status: "PENDING", daysRemaining: 0 };
  if (unit.replacedBySerial) return { status: "EXPIRED", daysRemaining: 0 };
  const days = daysBetween(today, unit.warrantyEnd);
  if (days < 0) return { status: "EXPIRED", daysRemaining: 0 };
  return {
    status: days <= EXPIRING_SOON_DAYS ? "EXPIRING_SOON" : "ACTIVE",
    daysRemaining: days,
  };
}

export const isCovered = (status: WarrantyStatus) =>
  status === "ACTIVE" || status === "EXPIRING_SOON";

/** Whether a warranty claim on this product is covered today. */
export function coverageFor(
  unit: Pick<Unit, "warrantyEnd" | "void" | "replacedBySerial">,
  today: IsoDate,
): Coverage {
  const { status } = unitWarranty(unit, today);
  const warrantyEnd = unit.warrantyEnd;
  if (status === "VOID")
    return { covered: false, reason: "VOID", warrantyEnd };
  if (status === "PENDING")
    return { covered: false, reason: "NOT_REGISTERED" };
  if (!isCovered(status))
    return { covered: false, reason: "EXPIRED", warrantyEnd };
  return { covered: true, reason: "IN_WARRANTY", warrantyEnd };
}

/** Warranty dates set when a registration is approved: from the purchase date, or today when it's unknown. */
export function warrantyFromPurchase(
  model: Pick<Model, "warrantyMonths">,
  purchaseDate: IsoDate | undefined,
  today: IsoDate,
): { warrantyStart: IsoDate; warrantyEnd: IsoDate } {
  const warrantyStart = purchaseDate ?? today;
  return {
    warrantyStart,
    warrantyEnd: warrantyEndFor(warrantyStart, model.warrantyMonths),
  };
}

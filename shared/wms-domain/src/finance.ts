import { addMonthsIso } from "./dates";
import type { IsoDate, Model, Resolution, Unit } from "./types";
import { unitWarranty } from "./warranty";

// Warranty economics: what a settled claim costs, and the extended-warranty offer. [CONFIRM with Fieldpiece Finance]
// - Repair: the model's standard repair cost.
// - Replace: the replacement's cost to Fieldpiece, taken as a share of list price.
// - Credit: the credit amount issued to the dealer.
// Extended warranty: sold in 12-month steps, up to 36 extra months in total, priced as a share of list price, while
// the product is registered, not void, not replaced and still in warranty (active or expiring soon).

/** Cost of a replacement unit as a share of its list price. */
export const REPLACEMENT_COST_RATIO = 0.55;

export function claimCost(
  resolution: Resolution | undefined,
  model: Pick<Model, "listPrice" | "repairCost">,
  creditAmount?: number,
): number {
  switch (resolution) {
    case "REPAIR":
      return model.repairCost;
    case "REPLACE":
      return roundMoney(model.listPrice * REPLACEMENT_COST_RATIO);
    case "CREDIT":
      return creditAmount ?? 0;
    default:
      return 0;
  }
}

export const EXTENSION_PLANS = [
  { months: 12, priceRatio: 0.15 },
  { months: 24, priceRatio: 0.26 },
  { months: 36, priceRatio: 0.35 },
] as const;
export const MAX_EXTENSION_MONTHS = 36;

export type ExtensionBlock = "NOT_REGISTERED" | "VOID" | "REPLACED" | "EXPIRED" | "LIMIT_REACHED";

export interface ExtensionOption {
  months: number;
  price: number;
  newEnd: IsoDate;
}

export interface ExtensionQuote {
  eligible: boolean;
  /** Why it can't be extended (when not eligible). */
  reason?: ExtensionBlock;
  currentEnd?: IsoDate;
  /** Months already added by earlier extensions. */
  extendedMonths: number;
  options: ExtensionOption[];
}

/** Whole dollars minus a cent (e.g. 49.99), never below 19.99. */
export function extensionPrice(listPrice: number, months: number): number {
  const plan = EXTENSION_PLANS.find((p) => p.months === months);
  if (!plan) return 0;
  return Math.max(20, Math.round(listPrice * plan.priceRatio)) - 0.01;
}

export function extensionQuote(
  unit: Pick<Unit, "warrantyEnd" | "void" | "replacedBySerial" | "extensions">,
  model: Pick<Model, "listPrice">,
  today: IsoDate,
): ExtensionQuote {
  const extendedMonths = (unit.extensions ?? []).reduce((n, e) => n + e.months, 0);
  const base = { currentEnd: unit.warrantyEnd, extendedMonths, options: [] as ExtensionOption[] };
  const block = (reason: ExtensionBlock): ExtensionQuote => ({ ...base, eligible: false, reason });
  if (!unit.warrantyEnd) return block("NOT_REGISTERED");
  if (unit.void) return block("VOID");
  if (unit.replacedBySerial) return block("REPLACED");
  const { status } = unitWarranty(unit, today);
  if (status !== "ACTIVE" && status !== "EXPIRING_SOON") return block("EXPIRED");
  const end = unit.warrantyEnd;
  const options = EXTENSION_PLANS.filter((p) => extendedMonths + p.months <= MAX_EXTENSION_MONTHS).map((p) => ({
    months: p.months,
    price: extensionPrice(model.listPrice, p.months),
    newEnd: addMonthsIso(end, p.months),
  }));
  if (!options.length) return block("LIMIT_REACHED");
  return { ...base, eligible: true, options };
}

export const roundMoney = (n: number) => Math.round(n * 100) / 100;

/** Share of `part` in `whole` as a whole-number percentage (0 when whole is 0). */
export const percent = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

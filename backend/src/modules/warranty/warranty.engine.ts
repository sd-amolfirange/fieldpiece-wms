import {
  addUtcDays,
  addUtcMonths,
  differenceInUtcCalendarDays,
  startOfUtcDay,
} from "../../common/time/utc-date";

// Warranty engine (build guide Section 8.1). Pure functions, no I/O.
// [CONFIRM] the real Fieldpiece terms; durations always come from WarrantyPolicy.

export interface PolicyTerms {
  baseMonths: number;
  registrationBonusMonths: number;
  registrationWindowDays?: number | null;
}

export interface WarrantyComputation {
  start: Date;
  end: Date;
  bonusApplied: boolean;
}

export function computeWarranty(input: {
  purchaseDate: Date;
  registeredAt: Date;
  policy: PolicyTerms;
}): WarrantyComputation {
  const start = startOfUtcDay(input.purchaseDate);
  const windowDays = input.policy.registrationWindowDays;
  const withinWindow =
    windowDays == null || differenceInUtcCalendarDays(input.registeredAt, input.purchaseDate) <= windowDays;
  const bonus = withinWindow ? input.policy.registrationBonusMonths : 0;
  const end = addUtcDays(addUtcMonths(start, input.policy.baseMonths + bonus), -1);
  return { start, end, bonusApplied: bonus > 0 };
}

/** Section 5.3: computed at read time, never stored. */
export type WarrantyStatus = "ACTIVE" | "EXPIRING_SOON" | "EXPIRED" | "VOID";

export function computeWarrantyStatus(input: {
  status: "ACTIVE" | "VOID";
  warrantyEnd: Date;
  today: Date;
  expiringSoonDays: number;
}): WarrantyStatus {
  if (input.status === "VOID") return "VOID";
  const daysLeft = differenceInUtcCalendarDays(input.warrantyEnd, input.today);
  if (daysLeft < 0) return "EXPIRED";
  if (daysLeft <= input.expiringSoonDays) return "EXPIRING_SOON";
  return "ACTIVE";
}

export interface PolicyCandidate extends PolicyTerms {
  id: string;
  productId: string | null;
  effectiveFrom: Date;
  effectiveTo: Date | null;
}

/**
 * Picks the policy in effect on the purchase date: the product's own policy first, then the default
 * (productId = null). Returns null when nothing applies.
 */
export function selectPolicy<T extends PolicyCandidate>(
  candidates: readonly T[],
  productId: string,
  purchaseDate: Date,
): T | null {
  const day = startOfUtcDay(purchaseDate).getTime();
  const inEffect = (p: T) =>
    p.effectiveFrom.getTime() <= day && (p.effectiveTo === null || p.effectiveTo.getTime() > day);
  return (
    candidates.find((p) => p.productId === productId && inEffect(p)) ??
    candidates.find((p) => p.productId === null && inEffect(p)) ??
    null
  );
}

import type { Dealer, User } from "@wms/domain";
import { ServiceError } from "./errors";

// Data scoping: server-side only (same rules as backend/src/domain/scope.ts). The UI never relies on hiding.
// - admin: everything
// - distributor: rows of every dealer linked to it
// - dealer: only its own rows
// - customer: only rows that belong to them (their products, registrations and warranty claims)
// A row outside the caller's scope answers 404, never 403, so ids can't be probed.

export interface Scoped {
  dealerId?: string;
  customerId?: string;
}

/** Dealer ids the user may see, or null for "all dealers" (admin). Empty for customers (who see by customerId). */
export function visibleDealerIds(user: User, dealers: readonly Dealer[]): string[] | null {
  switch (user.role) {
    case "admin":
      return null;
    case "distributor":
      return dealers.filter((d) => d.distributorId === user.distributorId).map((d) => d.id);
    case "dealer":
      return user.dealerId ? [user.dealerId] : [];
    case "customer":
      return [];
  }
}

export function canSee(user: User, row: Scoped, dealers: readonly Dealer[]): boolean {
  if (user.role === "admin") return true;
  if (user.role === "customer") return !!user.customerId && row.customerId === user.customerId;
  const ids = visibleDealerIds(user, dealers) ?? [];
  return !!row.dealerId && ids.includes(row.dealerId);
}

export const scopeRows = <T extends Scoped>(user: User, rows: readonly T[], dealers: readonly Dealer[]) =>
  rows.filter((row) => canSee(user, row, dealers));

/** Dealer the caller may act for: a dealer's own; a distributor or admin must pick one they can see. */
export function dealerIdFor(user: User, requested: string | undefined, dealers: readonly Dealer[]): string {
  if (user.role === "dealer" && user.dealerId) return user.dealerId;
  const allowed = visibleDealerIds(user, dealers);
  const ok =
    !!requested &&
    dealers.some((d) => d.id === requested) &&
    (allowed === null || allowed.includes(requested));
  if (!ok) {
    throw new ServiceError(422, "validation_error", "Pick the dealer.", {
      dealerId: "validation.pickDealer",
    });
  }
  return requested;
}

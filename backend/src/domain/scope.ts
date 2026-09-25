import type { Actor } from "../common/auth/context";
import { AppError } from "../common/errors/app-error";

// Data scoping (server side only; the UI merely hides menus):
// - admin: everything
// - distributor: rows of every dealer linked to it
// - dealer: only its own rows
// - customer: only rows that belong to them, and never claims or integration messages
// A row outside the caller's scope answers 404, never 403, so ids can't be probed.

export interface ScopedRow {
  dealerId?: string | null;
  customerId?: string | null;
}

export function canSee(user: Actor, row: ScopedRow): boolean {
  if (user.role === "admin") return true;
  if (user.role === "customer") return !!user.customerId && row.customerId === user.customerId;
  const ids = user.visibleDealerIds ?? [];
  return !!row.dealerId && ids.includes(row.dealerId);
}

/** Claims: customers never see them; dealers and distributors see their own, read-only. */
export const canSeeClaim = (user: Actor, row: ScopedRow) => user.role !== "customer" && canSee(user, row);

/** Prisma `where` fragment for tables with dealer_id / customer_id columns. Same rules as `canSee`. */
export function scopeWhere(user: Actor): { dealerId?: { in: string[] }; customerId?: string } {
  if (user.role === "admin") return {};
  // A customer login without a customer record sees nothing (a value no row has).
  if (user.role === "customer") return { customerId: user.customerId ?? "\u0000" };
  return { dealerId: { in: user.visibleDealerIds ?? [] } };
}

/** Dealer the caller may act for: a dealer's own; a distributor or admin must pick one they can see. */
export function dealerIdFor(user: Actor, requested: string | undefined, knownDealerIds: readonly string[]): string {
  if (user.role === "dealer" && user.dealerId) return user.dealerId;
  const allowed = user.visibleDealerIds;
  const ok =
    !!requested && knownDealerIds.includes(requested) && (allowed === null || allowed.includes(requested));
  if (!ok) throw AppError.validation("Pick the dealer.", { dealerId: "validation.pickDealer" });
  return requested;
}

export function requireRole(user: Actor, ...roles: Actor["role"][]): void {
  if (!roles.includes(user.role)) throw AppError.forbidden();
}

import type { Dealer, User } from "@wms/domain";

// Data scoping: server-side only. The demo server applies these to every response; the UI never relies on hiding.
// - admin: everything
// - distributor: rows of every dealer linked to it
// - dealer: only its own rows
// - customer: only rows that belong to them (and never claims or integration messages)

export interface Scoped {
  dealerId?: string;
  customerId?: string;
}

/** Dealer ids the user may see, or null for "all dealers" (admin). */
export function visibleDealerIds(
  user: User,
  dealers: readonly Dealer[],
): string[] | null {
  switch (user.role) {
    case "admin":
      return null;
    case "distributor":
      return dealers
        .filter((d) => d.distributorId === user.distributorId)
        .map((d) => d.id);
    case "dealer":
      return user.dealerId ? [user.dealerId] : [];
    case "customer":
      return [];
  }
}

export function canSee(
  user: User,
  row: Scoped,
  dealers: readonly Dealer[],
): boolean {
  if (user.role === "admin") return true;
  if (user.role === "customer")
    return !!user.customerId && row.customerId === user.customerId;
  const ids = visibleDealerIds(user, dealers) ?? [];
  return !!row.dealerId && ids.includes(row.dealerId);
}

/** Claims: customers never see them; dealers and distributors see their own, read-only. */
export const canSeeClaim = (
  user: User,
  row: Scoped,
  dealers: readonly Dealer[],
) => user.role !== "customer" && canSee(user, row, dealers);

export const scopeRows = <T extends Scoped>(
  user: User,
  rows: readonly T[],
  dealers: readonly Dealer[],
) => rows.filter((row) => canSee(user, row, dealers));

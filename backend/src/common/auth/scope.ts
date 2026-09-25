import type { Prisma } from "@prisma/client";
import type { AuthUser } from "./auth-user";

// Layer 2 authorisation (Section 7.2): which ROWS this user may see. Every repository read merges one of
// these into its `where`. Out-of-scope rows return 404, never 403, so their existence doesn't leak.
//
// An organisation-bound role without an organisation sees nothing (a sentinel UUID that can't match).

const NOTHING = "00000000-0000-0000-0000-000000000000";
const orgOf = (user: AuthUser) => user.organizationId ?? NOTHING;

export function claimScope(user: AuthUser): Prisma.ClaimWhereInput {
  if (user.hasAny("claims_agent", "admin")) return {};
  if (user.has("service_center")) return { rma: { serviceCenterId: orgOf(user) } };
  if (user.has("distributor")) return { registration: { distributorId: orgOf(user) } };
  return { createdBy: user.id }; // technician
}

export function registrationScope(user: AuthUser): Prisma.RegistrationWhereInput {
  if (user.hasAny("claims_agent", "admin")) return {};
  if (user.has("distributor")) return { distributorId: orgOf(user) };
  if (user.has("service_center")) return { claims: { some: { rma: { serviceCenterId: orgOf(user) } } } };
  return { OR: [{ createdBy: user.id }, { customer: { userId: user.id } }] }; // technician
}

export function customerScope(user: AuthUser): Prisma.CustomerWhereInput {
  const live = { deletedAt: null };
  if (user.hasAny("claims_agent", "admin")) return live;
  if (user.has("distributor")) return { ...live, distributorId: orgOf(user) };
  if (user.has("technician")) return { ...live, userId: user.id };
  return { ...live, id: NOTHING };
}

export function rmaScope(user: AuthUser): Prisma.RmaWhereInput {
  if (user.hasAny("claims_agent", "admin")) return {};
  if (user.has("service_center")) return { serviceCenterId: orgOf(user) };
  return { claim: claimScope(user) }; // customers, e.g. to add inbound tracking
}

import type { Role } from "./roles";

const PRIORITY: readonly Role[] = ["admin", "claims_agent", "service_center", "distributor", "technician"];

/**
 * The authenticated caller. Roles come from our database, managed by admins, not straight from token
 * claims (Section 7.1). [CONFIRM] whether the IdP should become the source of truth for roles.
 */
export class AuthUser {
  constructor(
    readonly id: string,
    readonly email: string,
    readonly displayName: string,
    readonly roles: readonly Role[],
    readonly organizationId: string | null,
    readonly currency: string,
    readonly isActive: boolean,
  ) {}

  has(role: Role): boolean {
    return this.roles.includes(role);
  }

  hasAny(...roles: Role[]): boolean {
    return roles.some((role) => this.roles.includes(role));
  }

  /** The most privileged role, used where the UI needs a single role. */
  get primaryRole(): Role | null {
    return PRIORITY.find((role) => this.roles.includes(role)) ?? null;
  }
}

/** Per-request context handed from controllers to services (services never touch FastifyRequest). */
export interface RequestContext {
  user: AuthUser;
  ip: string | null;
  requestId: string;
}

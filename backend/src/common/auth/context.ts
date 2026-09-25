import type { IsoDate, Role } from "@wms/domain";

/** The signed-in caller, as every service sees it. Roles and organisation come from our database. */
export interface Actor {
  id: string;
  name: string;
  email: string;
  role: Role;
  dealerId?: string;
  distributorId?: string;
  customerId?: string;
  /**
   * Dealers whose rows this user may see: null = all (admin); a distributor's dealers; a dealer's own id;
   * empty for customers (who see rows by customerId instead).
   */
  visibleDealerIds: string[] | null;
  sessionId: string;
}

/** Per-request context handed from controllers to services. `today` and `now` are fixed for the request. */
export interface Ctx {
  user: Actor;
  /** Business calendar date (APP_TIMEZONE). */
  today: IsoDate;
  now: Date;
  requestId: string;
}

/** Context for work done by the system itself (seed, reset), not on behalf of a signed-in user. */
export interface SystemCtx {
  today: IsoDate;
  now: Date;
}

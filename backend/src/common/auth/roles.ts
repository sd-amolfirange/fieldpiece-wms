// The five user roles (build guide Section 1.1 of the frontend doc, 7.3 here). Must match the frontend exactly.
export const ROLES = ["technician", "distributor", "claims_agent", "service_center", "admin"] as const;
export type Role = (typeof ROLES)[number];

/** Pseudo-role for transitions only the system may perform (e.g. issuing an RMA after approval). */
export type Actor = Role | "system";

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

/** Roles that may see internal notes (Section 7.3). */
export const INTERNAL_NOTE_ROLES: readonly Role[] = ["claims_agent", "service_center", "admin"];

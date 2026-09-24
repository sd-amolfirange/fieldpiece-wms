import type { Role } from "@/types";

// UI-only permission helper. It decides what to HIDE, nothing more.
// The demo server scopes every response and refuses every action the caller isn't allowed to take.

export type Permission =
  | "registrations:inbox" // A02/A03 registration inbox and review
  | "registrations:create" // DL03 register a unit (admin: manual add)
  | "registrations:bulk" // DL02 bulk import
  | "registrations:self" // CU01 customer self-registration
  | "units:list" // A04 / DL04
  | "units:void"
  | "units:qr_label"
  | "models:manage" // A06
  | "complaints:create"
  | "complaints:send" // hand a complaint to the service system
  | "claims:view"
  | "claims:act" // submit, approve, reject, mark paid
  | "admin:manage" // A11, A12
  | "simulate:run" // A13
  // Legacy permissions still referenced by the old claim pages until their rebuild.
  | "claims:create"
  | "claims:review"
  | "claims:internal_notes";

const rolePermissions: Record<Role, readonly Permission[]> = {
  admin: [
    "registrations:inbox",
    "registrations:create",
    "registrations:bulk",
    "units:list",
    "units:void",
    "units:qr_label",
    "models:manage",
    "complaints:create",
    "complaints:send",
    "claims:view",
    "claims:act",
    "admin:manage",
    "simulate:run",
    "claims:review",
    "claims:internal_notes",
  ],
  distributor: [
    "registrations:create",
    "registrations:bulk",
    "units:list",
    "complaints:create",
    "claims:view",
  ],
  dealer: ["registrations:create", "registrations:bulk", "units:list", "complaints:create", "claims:view"],
  customer: ["registrations:self", "complaints:create"],
};

export function can(role: Role | undefined | null, permission: Permission): boolean {
  if (!role) return false;
  return rolePermissions[role].includes(permission);
}

export function hasRole(role: Role | undefined | null, allowed: readonly Role[]): boolean {
  return !!role && allowed.includes(role);
}

/** Office staff see internal notes and integration details that dealers and customers never see. */
export const isStaff = (role: Role | undefined | null) => role === "admin";

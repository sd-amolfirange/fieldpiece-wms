import type { Role } from "@/types";

// UI-only permission helper. It decides what to HIDE, nothing more.
// The server scopes every response and refuses every action the caller isn't allowed to take.

export type Permission =
  | "registrations:inbox" // A02/A03 registration inbox and review
  | "registrations:create" // DL03 register a product (admin: manual add)
  | "registrations:bulk" // DL02 bulk import
  | "registrations:self" // CU01 customer self-registration
  | "registrations:hub" // registration channels (web form, email, partner API)
  | "partners:manage" // partner API keys
  | "units:list" // A04 / DL04
  | "units:void"
  | "units:qr_label"
  | "models:manage" // A06
  | "claims:create" // file a warranty claim
  | "claims:act" // start review, approve, reject, close
  | "admin:manage" // A11, A12
  | "simulate:run"; // A13

const rolePermissions: Record<Role, readonly Permission[]> = {
  admin: [
    "registrations:inbox",
    "registrations:create",
    "registrations:bulk",
    "registrations:hub",
    "partners:manage",
    "units:list",
    "units:void",
    "units:qr_label",
    "models:manage",
    "claims:create",
    "claims:act",
    "admin:manage",
    "simulate:run",
  ],
  distributor: [
    "registrations:create",
    "registrations:bulk",
    "registrations:hub",
    "units:list",
    "claims:create",
  ],
  dealer: ["registrations:create", "registrations:bulk", "registrations:hub", "units:list", "claims:create"],
  customer: ["registrations:self", "claims:create"],
};

export function can(role: Role | undefined | null, permission: Permission): boolean {
  if (!role) return false;
  return rolePermissions[role].includes(permission);
}

export function hasRole(role: Role | undefined | null, allowed: readonly Role[]): boolean {
  return !!role && allowed.includes(role);
}

/** Office staff see integration details that dealers and customers never see. */
export const isStaff = (role: Role | undefined | null) => role === "admin";

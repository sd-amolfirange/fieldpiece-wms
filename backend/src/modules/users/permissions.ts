import type { Role } from "../../common/auth/roles";

// Coarse permissions returned by GET /me so the UI can decide what to show (Section 7.3).
// The API still enforces everything with @Roles() and data scope; this list is for display only.

export const PERMISSIONS = [
  "registrations:view",
  "registrations:create",
  "registrations:bulk",
  "registrations:void",
  "claims:view",
  "claims:create",
  "claims:review",
  "claims:internal_notes",
  "rma:view",
  "rma:inspect",
  "customers:view",
  "products:view",
  "products:edit",
  "reports:view",
  "admin:manage",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const BY_ROLE: Record<Role, readonly Permission[]> = {
  technician: ["registrations:view", "registrations:create", "claims:view", "claims:create", "products:view"],
  distributor: [
    "registrations:view",
    "registrations:create",
    "registrations:bulk",
    "claims:view",
    "claims:create",
    "customers:view",
    "products:view",
    "reports:view",
  ],
  claims_agent: [
    "registrations:view",
    "registrations:create",
    "claims:view",
    "claims:create",
    "claims:review",
    "claims:internal_notes",
    "rma:view",
    "customers:view",
    "products:view",
    "reports:view",
  ],
  service_center: ["claims:view", "claims:internal_notes", "rma:view", "rma:inspect", "products:view"],
  admin: PERMISSIONS,
};

export function permissionsFor(roles: readonly Role[]): Permission[] {
  const set = new Set<Permission>();
  for (const role of roles) for (const p of BY_ROLE[role]) set.add(p);
  return PERMISSIONS.filter((p) => set.has(p));
}

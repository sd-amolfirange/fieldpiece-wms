import type { Actor, Role } from "../../common/auth/roles";

// RMA lifecycle (build guide Sections 6.2 and 8.3). Pure functions.
// ISSUED → IN_TRANSIT → RECEIVED → INSPECTED → COMPLETED, with CANCELLED from ISSUED / IN_TRANSIT.

export const RMA_STATUSES = [
  "ISSUED",
  "IN_TRANSIT",
  "RECEIVED",
  "INSPECTED",
  "COMPLETED",
  "CANCELLED",
] as const;
export type RmaStatus = (typeof RMA_STATUSES)[number];

export const RMA_TYPES = ["repair", "replace", "credit"] as const;
export type RmaType = (typeof RMA_TYPES)[number];

interface RmaTransition {
  from: readonly RmaStatus[];
  to: RmaStatus;
  roles: readonly Actor[];
}

export const RMA_TRANSITIONS = {
  shipInbound: {
    from: ["ISSUED"],
    to: "IN_TRANSIT",
    roles: ["technician", "distributor", "service_center", "claims_agent", "admin"],
  },
  receive: { from: ["ISSUED", "IN_TRANSIT"], to: "RECEIVED", roles: ["service_center", "admin"] },
  inspect: { from: ["RECEIVED"], to: "INSPECTED", roles: ["service_center", "admin"] },
  complete: {
    from: ["RECEIVED", "INSPECTED"],
    to: "COMPLETED",
    roles: ["service_center", "claims_agent", "admin"],
  },
  cancel: { from: ["ISSUED", "IN_TRANSIT"], to: "CANCELLED", roles: ["claims_agent", "admin"] },
} as const satisfies Record<string, RmaTransition>;

export type RmaAction = keyof typeof RMA_TRANSITIONS;
export const RMA_ACTIONS = Object.keys(RMA_TRANSITIONS) as RmaAction[];

export function isRmaStatus(value: string): value is RmaStatus {
  return (RMA_STATUSES as readonly string[]).includes(value);
}

export type RmaTransitionCheck =
  { ok: true; to: RmaStatus } | { ok: false; error: "FORBIDDEN" | "RMA_INVALID_TRANSITION" };

export function checkRmaTransition(
  action: RmaAction,
  current: RmaStatus,
  actors: readonly Actor[],
): RmaTransitionCheck {
  const t: RmaTransition = RMA_TRANSITIONS[action];
  if (!actors.some((a) => t.roles.includes(a))) return { ok: false, error: "FORBIDDEN" };
  if (!t.from.includes(current)) return { ok: false, error: "RMA_INVALID_TRANSITION" };
  return { ok: true, to: t.to };
}

export function allowedRmaActions(status: RmaStatus, roles: readonly Role[]): RmaAction[] {
  return RMA_ACTIONS.filter((action) => checkRmaTransition(action, status, roles).ok);
}

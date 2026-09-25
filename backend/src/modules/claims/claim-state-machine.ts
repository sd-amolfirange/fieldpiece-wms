import type { ClaimStatus } from "@prisma/client";
import type { Actor, Role } from "../../common/auth/roles";

// Claim state machine (build guide Section 8.3). Pure: no I/O, 100% unit tested.
// The same table drives `allowedActions` in GET /claims/{id}, so the frontend never copies this logic.
//
// DRAFT → SUBMITTED → IN_REVIEW ─┬→ APPROVED → RMA_ISSUED → IN_TRANSIT → RECEIVED ─┬→ REPAIRED ─┐
//                         ↑      │                                                 ├→ REPLACED ─┼→ CLOSED
//                         │      ├→ NEEDS_INFO ──(customer responds)──┐            └→ CREDITED ─┘
//                         └──────┼─────────────────────────────────────┘
//                                └→ REJECTED → CLOSED

export type Resolution = "repair" | "replace" | "credit";

export interface TransitionInput {
  message?: string | null;
  resolution?: Resolution | null;
  reason?: string | null;
}

export type RequirementError = "MESSAGE_REQUIRED" | "RESOLUTION_REQUIRED" | "REASON_REQUIRED";

interface Transition {
  from: readonly ClaimStatus[];
  /** Target status, or a function of the resolution for `complete`. */
  to: ClaimStatus | ((resolution: Resolution) => ClaimStatus);
  roles: readonly Actor[];
  requires?: (input: TransitionInput) => RequirementError | null;
}

const COMPLETE_TARGET: Record<Resolution, ClaimStatus> = {
  repair: "REPAIRED",
  replace: "REPLACED",
  credit: "CREDITED",
};

export const TRANSITIONS = {
  submit: { from: ["DRAFT"], to: "SUBMITTED", roles: ["technician", "distributor", "claims_agent", "admin"] },
  startReview: { from: ["SUBMITTED"], to: "IN_REVIEW", roles: ["claims_agent", "admin"] },
  requestInfo: {
    from: ["IN_REVIEW"],
    to: "NEEDS_INFO",
    roles: ["claims_agent", "admin"],
    requires: (i) => (i.message?.trim() ? null : "MESSAGE_REQUIRED"),
  },
  respond: { from: ["NEEDS_INFO"], to: "IN_REVIEW", roles: ["technician", "distributor"] },
  approve: {
    from: ["IN_REVIEW"],
    to: "APPROVED",
    roles: ["claims_agent", "admin"],
    requires: (i) => (i.resolution ? null : "RESOLUTION_REQUIRED"),
  },
  reject: {
    from: ["IN_REVIEW"],
    to: "REJECTED",
    roles: ["claims_agent", "admin"],
    requires: (i) => (i.reason?.trim() ? null : "REASON_REQUIRED"),
  },
  issueRma: { from: ["APPROVED"], to: "RMA_ISSUED", roles: ["system"] }, // automatic after approve
  shipInbound: {
    from: ["RMA_ISSUED"],
    to: "IN_TRANSIT",
    roles: ["technician", "distributor", "service_center", "claims_agent", "admin"],
  },
  receive: { from: ["IN_TRANSIT", "RMA_ISSUED"], to: "RECEIVED", roles: ["service_center", "admin"] },
  complete: {
    from: ["RECEIVED"],
    to: (resolution: Resolution) => COMPLETE_TARGET[resolution],
    roles: ["service_center", "claims_agent", "admin"],
  },
  close: {
    from: ["REPAIRED", "REPLACED", "CREDITED", "REJECTED"],
    to: "CLOSED",
    roles: ["system", "claims_agent", "admin"],
  },
} as const satisfies Record<string, Transition>;

export type ClaimAction = keyof typeof TRANSITIONS;

/** Actions exposed on claim endpoints. RMA-driven ones (shipInbound, receive, complete) live on /rmas. */
export const CLAIM_ENDPOINT_ACTIONS = [
  "submit",
  "startReview",
  "requestInfo",
  "respond",
  "approve",
  "reject",
  "close",
] as const satisfies readonly ClaimAction[];

export type ClaimEndpointAction = (typeof CLAIM_ENDPOINT_ACTIONS)[number];

export type TransitionCheck =
  | { ok: true; to: ClaimStatus }
  | { ok: false; error: "FORBIDDEN" | "CLAIM_INVALID_TRANSITION" | RequirementError };

function hasActor(allowed: readonly Actor[], actors: readonly Actor[]): boolean {
  return actors.some((actor) => allowed.includes(actor));
}

/**
 * Validates a transition in the order the service must report it:
 * role (403) → from-status (409) → required input (422).
 */
export function checkTransition(
  action: ClaimAction,
  current: ClaimStatus,
  actors: readonly Actor[],
  input: TransitionInput & { rmaType?: Resolution } = {},
): TransitionCheck {
  const t: Transition = TRANSITIONS[action];
  if (!hasActor(t.roles, actors)) return { ok: false, error: "FORBIDDEN" };
  if (!t.from.includes(current)) return { ok: false, error: "CLAIM_INVALID_TRANSITION" };
  const missing = t.requires?.(input) ?? null;
  if (missing) return { ok: false, error: missing };

  if (typeof t.to === "function") {
    if (!input.rmaType) return { ok: false, error: "RESOLUTION_REQUIRED" };
    return { ok: true, to: t.to(input.rmaType) };
  }
  return { ok: true, to: t.to };
}

/** Claim-endpoint actions this user may take right now (ignores input requirements). */
export function allowedActions(status: ClaimStatus, roles: readonly Role[]): ClaimEndpointAction[] {
  return CLAIM_ENDPOINT_ACTIONS.filter((action) => {
    const t: Transition = TRANSITIONS[action];
    return t.from.includes(status) && hasActor(t.roles, roles);
  });
}

/** Open = submitted and not yet resolved or closed. */
export const OPEN_STATUSES: readonly ClaimStatus[] = [
  "SUBMITTED",
  "IN_REVIEW",
  "NEEDS_INFO",
  "APPROVED",
  "RMA_ISSUED",
  "IN_TRANSIT",
  "RECEIVED",
];

/** Statuses the SLA clock runs in (Section 8.4). */
export const SLA_STATUSES: readonly ClaimStatus[] = ["SUBMITTED", "IN_REVIEW"];

/** Statuses in which the owner may still edit the claim body (Section 6.2). */
export const EDITABLE_STATUSES: readonly ClaimStatus[] = ["DRAFT", "NEEDS_INFO"];

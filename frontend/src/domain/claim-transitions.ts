import type { ClaimStatus, Role } from "./types";

// Manufacturer claim state machine: the ONE place that decides which claim actions exist.
//
//   DRAFT ─submit→ SUBMITTED ─approve→ APPROVED ─mark_paid→ PAID
//                      └──────reject→ REJECTED
//
// Only the admin acts on claims. Dealers and distributors see status only; customers don't see claims.
// "approve" and "reject" are also fired by the OEM decision in the simulator (actor "system").

export type ClaimActionName = "submit" | "approve" | "reject" | "mark_paid";
export type ClaimActor = Role | "system";

export interface ClaimTransitionDef {
  action: ClaimActionName;
  from: ClaimStatus;
  to: ClaimStatus;
  actors: readonly ClaimActor[];
  /** Extra input the UI must collect first. */
  requires?: readonly ("rmaNumber" | "amount" | "reason")[];
  tone: "primary" | "secondary" | "danger";
}

export const CLAIM_TRANSITION_DEFS: readonly ClaimTransitionDef[] = [
  {
    action: "submit",
    from: "DRAFT",
    to: "SUBMITTED",
    actors: ["admin"],
    requires: ["amount"],
    tone: "primary",
  },
  { action: "approve", from: "SUBMITTED", to: "APPROVED", actors: ["admin", "system"], tone: "primary" },
  {
    action: "reject",
    from: "SUBMITTED",
    to: "REJECTED",
    actors: ["admin", "system"],
    requires: ["reason"],
    tone: "danger",
  },
  { action: "mark_paid", from: "APPROVED", to: "PAID", actors: ["admin"], tone: "primary" },
];

export function claimActionsFor(
  status: ClaimStatus,
  actor: ClaimActor | undefined | null,
): ClaimTransitionDef[] {
  if (!actor) return [];
  return CLAIM_TRANSITION_DEFS.filter((t) => t.from === status && t.actors.includes(actor));
}

export function nextClaimStatus(
  status: ClaimStatus,
  action: ClaimActionName,
  actor: ClaimActor,
): ClaimStatus | null {
  return claimActionsFor(status, actor).find((t) => t.action === action)?.to ?? null;
}

/** Counted as "open" on dashboards: raised but not yet paid or rejected. */
export const isOpenClaim = (status: ClaimStatus) =>
  status === "DRAFT" || status === "SUBMITTED" || status === "APPROVED";

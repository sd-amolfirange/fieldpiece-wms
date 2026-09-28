import type { ClaimStatus, Role } from "./types";

// Warranty claim state machine: the ONE place that decides which claim actions exist.
//
//   SUBMITTED -start_review-> IN_REVIEW -approve-> APPROVED -close-> CLOSED
//        └──────────────reject──────┴──────reject-> REJECTED
//
// Customers and dealers file and follow claims; only the Fieldpiece warranty desk (admin) decides them.

export type ClaimActionName = "start_review" | "approve" | "reject" | "close";
export type ClaimActor = Role;

/** Extra input the UI must collect before the action. */
export type ClaimInputField =
  | "resolution"
  | "creditAmount"
  | "reason"
  | "replacementSerial";

export interface ClaimTransitionDef {
  action: ClaimActionName;
  from: readonly ClaimStatus[];
  to: ClaimStatus;
  actors: readonly ClaimActor[];
  requires?: readonly ClaimInputField[];
  tone: "primary" | "secondary" | "danger";
}

export const CLAIM_TRANSITION_DEFS: readonly ClaimTransitionDef[] = [
  {
    action: "start_review",
    from: ["SUBMITTED"],
    to: "IN_REVIEW",
    actors: ["admin"],
    tone: "primary",
  },
  {
    action: "approve",
    from: ["IN_REVIEW"],
    to: "APPROVED",
    actors: ["admin"],
    // creditAmount only for a CREDIT resolution (checked by the server).
    requires: ["resolution"],
    tone: "primary",
  },
  {
    action: "reject",
    from: ["SUBMITTED", "IN_REVIEW"],
    to: "REJECTED",
    actors: ["admin"],
    requires: ["reason"],
    tone: "danger",
  },
  {
    action: "close",
    from: ["APPROVED"],
    to: "CLOSED",
    actors: ["admin"],
    // replacementSerial only for a REPLACE resolution (checked by the server).
    tone: "primary",
  },
];

export function claimActionsFor(
  status: ClaimStatus,
  actor: ClaimActor | undefined | null,
): ClaimTransitionDef[] {
  if (!actor) return [];
  return CLAIM_TRANSITION_DEFS.filter(
    (t) => t.from.includes(status) && t.actors.includes(actor),
  );
}

export function nextClaimStatus(
  status: ClaimStatus,
  action: ClaimActionName,
  actor: ClaimActor,
): ClaimStatus | null {
  return (
    claimActionsFor(status, actor).find((t) => t.action === action)?.to ?? null
  );
}

/** Counted as "open" on dashboards: filed and not yet decided or closed. */
export const isOpenClaim = (status: ClaimStatus) =>
  status === "SUBMITTED" || status === "IN_REVIEW" || status === "APPROVED";

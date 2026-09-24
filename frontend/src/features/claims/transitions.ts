import type { ClaimStatus, Role } from "@/types";

// Claim state machine (Section 7.1). The ONE place that decides which actions a role may take
// from a given status. The UI only shows buttons this file allows; the API still enforces it.
//
// DRAFT → SUBMITTED → IN_REVIEW ─┬→ APPROVED → RMA_ISSUED → IN_TRANSIT → RECEIVED ─┬→ REPAIRED ─┐
//                         ↑      │                                                 ├→ REPLACED ─┼→ CLOSED
//                         │      ├→ NEEDS_INFO ──(customer responds)──┐            └→ CREDITED ─┘
//                         └──────┼─────────────────────────────────────┘
//                                └→ REJECTED → CLOSED

export type ClaimAction =
  | "submit"
  | "start_review"
  | "request_info"
  | "respond"
  | "approve"
  | "reject"
  | "issue_rma"
  | "mark_in_transit"
  | "mark_received"
  | "mark_repaired"
  | "mark_replaced"
  | "mark_credited"
  | "close";

export interface ClaimTransition {
  action: ClaimAction;
  from: ClaimStatus;
  to: ClaimStatus;
  roles: readonly Role[];
  /** Opens a modal that collects extra data (reason, resolution...) before submitting. */
  requiresInput?: boolean;
  tone?: "primary" | "secondary" | "danger";
}

// LEGACY state machine for the old claim pages (rebuilt in Phase 3 on domain/claim-transitions.ts).
const CUSTOMER: readonly Role[] = ["dealer", "distributor", "admin"];
const AGENT: readonly Role[] = ["admin"];
const SERVICE: readonly Role[] = ["admin"];

export const CLAIM_TRANSITIONS: readonly ClaimTransition[] = [
  { action: "submit", from: "DRAFT", to: "SUBMITTED", roles: CUSTOMER, tone: "primary" },
  { action: "start_review", from: "SUBMITTED", to: "IN_REVIEW", roles: AGENT, tone: "primary" },
  {
    action: "request_info",
    from: "IN_REVIEW",
    to: "NEEDS_INFO",
    roles: AGENT,
    requiresInput: true,
    tone: "secondary",
  },
  {
    action: "respond",
    from: "NEEDS_INFO",
    to: "IN_REVIEW",
    roles: CUSTOMER,
    requiresInput: true,
    tone: "primary",
  },
  {
    action: "approve",
    from: "IN_REVIEW",
    to: "APPROVED",
    roles: AGENT,
    requiresInput: true,
    tone: "primary",
  },
  { action: "reject", from: "IN_REVIEW", to: "REJECTED", roles: AGENT, requiresInput: true, tone: "danger" },
  { action: "issue_rma", from: "APPROVED", to: "RMA_ISSUED", roles: AGENT, tone: "primary" },
  {
    action: "mark_in_transit",
    from: "RMA_ISSUED",
    to: "IN_TRANSIT",
    roles: ["dealer", "distributor", "admin"],
    requiresInput: true, // tracking number
    tone: "primary",
  },
  { action: "mark_received", from: "IN_TRANSIT", to: "RECEIVED", roles: SERVICE, tone: "primary" },
  {
    action: "mark_repaired",
    from: "RECEIVED",
    to: "REPAIRED",
    roles: SERVICE,
    requiresInput: true,
    tone: "primary",
  },
  {
    action: "mark_replaced",
    from: "RECEIVED",
    to: "REPLACED",
    roles: SERVICE,
    requiresInput: true,
    tone: "secondary",
  },
  {
    action: "mark_credited",
    from: "RECEIVED",
    to: "CREDITED",
    roles: SERVICE,
    requiresInput: true,
    tone: "secondary",
  },
  { action: "close", from: "REJECTED", to: "CLOSED", roles: AGENT, tone: "secondary" },
  { action: "close", from: "REPAIRED", to: "CLOSED", roles: AGENT, tone: "secondary" },
  { action: "close", from: "REPLACED", to: "CLOSED", roles: AGENT, tone: "secondary" },
  { action: "close", from: "CREDITED", to: "CLOSED", roles: AGENT, tone: "secondary" },
];

/** Every transition out of `status`, ignoring role. */
export function transitionsFrom(status: ClaimStatus): ClaimTransition[] {
  return CLAIM_TRANSITIONS.filter((t) => t.from === status);
}

/** The actions `role` may take on a claim in `status`. */
export function allowedTransitions(status: ClaimStatus, role: Role | undefined | null): ClaimTransition[] {
  if (!role) return [];
  return transitionsFrom(status).filter((t) => t.roles.includes(role));
}

export function canPerform(status: ClaimStatus, action: ClaimAction, role: Role | undefined | null): boolean {
  return allowedTransitions(status, role).some((t) => t.action === action);
}

/** The status a claim moves to, or null when the action isn't valid from `status`. */
export function nextStatus(status: ClaimStatus, action: ClaimAction): ClaimStatus | null {
  return transitionsFrom(status).find((t) => t.action === action)?.to ?? null;
}

const TERMINAL: ReadonlySet<ClaimStatus> = new Set(["CLOSED"]);
const OPEN_EXCLUDED: ReadonlySet<ClaimStatus> = new Set(["DRAFT", "CLOSED", "REJECTED"]);

export const isTerminal = (status: ClaimStatus) => TERMINAL.has(status);

/** "Open" for dashboards: submitted and not yet resolved or closed. */
export const isOpen = (status: ClaimStatus) =>
  !OPEN_EXCLUDED.has(status) && !["REPAIRED", "REPLACED", "CREDITED"].includes(status);

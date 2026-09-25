import type { ClaimStatus } from "@prisma/client";
import type { DomainEventType } from "../../infra/outbox/event-types";

// Domain events emitted to the outbox by claim transitions.

export interface ClaimStatusChangedPayload {
  claimId: string;
  displayNo: string;
  from: ClaimStatus;
  to: ClaimStatus;
  actorId: string;
}

/** The specific event (for notifications) that accompanies a status change, if any. */
export function specificEventFor(to: ClaimStatus): DomainEventType | null {
  switch (to) {
    case "SUBMITTED":
      return "claim.submitted";
    case "NEEDS_INFO":
      return "claim.needs_info";
    case "APPROVED":
      return "claim.approved";
    case "REJECTED":
      return "claim.rejected";
    default:
      return null;
  }
}

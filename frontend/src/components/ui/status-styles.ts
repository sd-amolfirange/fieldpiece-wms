import type {
  BulkRowStatus,
  ClaimSource,
  ClaimStatus as DomainClaimStatus,
  IntegrationDirection,
  IntegrationStatus,
  RegistrationChannel,
  RegistrationFlag,
  RegistrationStatus,
  WarrantyStatus as DomainWarrantyStatus,
} from "@wms/domain";
import type { ClaimStatus as LegacyClaimStatus, WarrantyStatus as LegacyWarrantyStatus } from "@/types";

// The existing colour variants, reused by every status (no new colours).
const NEUTRAL = "bg-ink-100 text-ink-600";
const INFO = "bg-info-bg text-info";
const WARNING = "bg-warning-bg text-warning";
const SUCCESS = "bg-success-bg text-success";
const DANGER = "bg-danger-bg text-danger";
const BRAND = "bg-brand-100 text-brand-800";

export type AnyWarrantyStatus = LegacyWarrantyStatus | DomainWarrantyStatus;
export type AnyClaimStatus = LegacyClaimStatus | DomainClaimStatus;

// Status is never shown by colour alone: pair these with a label (Section 3.2).

export const claimStatusStyle: Record<AnyClaimStatus, string> = {
  DRAFT: "bg-ink-100 text-ink-600",
  SUBMITTED: "bg-info-bg text-info",
  IN_REVIEW: "bg-info-bg text-info",
  NEEDS_INFO: "bg-warning-bg text-warning",
  APPROVED: "bg-success-bg text-success",
  REJECTED: "bg-danger-bg text-danger",
  IN_TRANSIT: "bg-info-bg text-info",
  RECEIVED: "bg-info-bg text-info",
  REPAIRED: "bg-success-bg text-success",
  REPLACED: "bg-success-bg text-success",
  CREDITED: "bg-success-bg text-success",
  CLOSED: "bg-ink-100 text-ink-600",
};

export const warrantyStatusStyle: Record<AnyWarrantyStatus, string> = {
  ACTIVE: "bg-success-bg text-success",
  EXPIRING_SOON: "bg-warning-bg text-warning",
  EXPIRED: "bg-danger-bg text-danger",
  NOT_REGISTERED: "bg-ink-100 text-ink-600",
  PENDING: NEUTRAL,
  VOID: "bg-ink-100 text-ink-600 line-through",
};

export const registrationStatusStyle: Record<RegistrationStatus, string> = {
  PENDING: WARNING,
  APPROVED: SUCCESS,
  REJECTED: DANGER,
};

export const channelStyle: Record<RegistrationChannel, string> = {
  DEALER: BRAND,
  BULK: BRAND,
  PORTAL: INFO,
  WEB: INFO,
  EMAIL: NEUTRAL,
  ERP: NEUTRAL,
  API: NEUTRAL,
  RETAIL: WARNING,
  OVERWATCH: SUCCESS,
  JOBLINK: SUCCESS,
};

export const registrationFlagStyle: Record<RegistrationFlag, string> = {
  EXCEPTION: DANGER,
  DUPLICATE: DANGER,
  MODEL_MISMATCH: WARNING,
};

export const bulkRowStatusStyle: Record<BulkRowStatus, string> = {
  REGISTERED: SUCCESS,
  FIXED: INFO,
  ERROR: DANGER,
  REVIEW: WARNING,
};

export const claimSourceStyle: Record<ClaimSource, string> = {
  CUSTOMER: INFO,
  DEALER: BRAND,
  ADMIN: NEUTRAL,
};

export type PartnerKeyStatus = "ACTIVE" | "INACTIVE";

export const partnerKeyStyle: Record<PartnerKeyStatus, string> = {
  ACTIVE: SUCCESS,
  INACTIVE: NEUTRAL,
};

export const integrationStatusStyle: Record<IntegrationStatus, string> = {
  PENDING: NEUTRAL,
  SUCCESS: SUCCESS,
  FAILED: DANGER,
};

export const integrationDirectionStyle: Record<IntegrationDirection, string> = {
  IN: INFO,
  OUT: BRAND,
};

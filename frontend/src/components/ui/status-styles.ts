import type {
  BulkRowStatus,
  ClaimStatus as DomainClaimStatus,
  ComplaintSource,
  ComplaintStatus,
  Coverage,
  FinancePostingStatus,
  IntegrationDirection,
  IntegrationStatus,
  RegistrationChannel,
  RegistrationFlag,
  RegistrationStatus,
  WarrantyStatus as DomainWarrantyStatus,
} from "@wms/domain";
import type {
  ClaimStatus as LegacyClaimStatus,
  RmaStatus,
  WarrantyStatus as LegacyWarrantyStatus,
} from "@/types";

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
  RMA_ISSUED: "bg-brand-100 text-brand-800",
  IN_TRANSIT: "bg-info-bg text-info",
  RECEIVED: "bg-info-bg text-info",
  REPAIRED: "bg-success-bg text-success",
  REPLACED: "bg-success-bg text-success",
  CREDITED: "bg-success-bg text-success",
  PAID: SUCCESS,
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

export const rmaStatusStyle: Record<RmaStatus, string> = {
  ISSUED: "bg-brand-100 text-brand-800",
  IN_TRANSIT: "bg-info-bg text-info",
  RECEIVED: "bg-info-bg text-info",
  INSPECTED: "bg-info-bg text-info",
  COMPLETED: "bg-success-bg text-success",
  CANCELLED: "bg-ink-100 text-ink-600",
};

export const registrationStatusStyle: Record<RegistrationStatus, string> = {
  PENDING: WARNING,
  APPROVED: SUCCESS,
  REJECTED: DANGER,
};

export const channelStyle: Record<RegistrationChannel, string> = {
  DEALER: BRAND,
  PORTAL: INFO,
  EMAIL: NEUTRAL,
  ERP: NEUTRAL,
  BULK: BRAND,
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

export const coverageStyle: Record<Coverage, string> = {
  COVERED: SUCCESS,
  CHARGEABLE: WARNING,
};

export const complaintStatusStyle: Record<ComplaintStatus, string> = {
  NEW: INFO,
  WITH_SERVICE: BRAND,
  RESOLVED: SUCCESS,
};

export const complaintSourceStyle: Record<ComplaintSource, string> = {
  CUSTOMER: INFO,
  DEALER: BRAND,
  ADMIN: NEUTRAL,
};

export const financePostingStyle: Record<FinancePostingStatus, string> = {
  NOT_POSTED: NEUTRAL,
  POSTED: SUCCESS,
  FAILED: DANGER,
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

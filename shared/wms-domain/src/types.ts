// Domain model for the HVAC warranty demo (docs/demo-workflows.md).
// Package @wms/domain: shared by frontend/ and backend/demo-server/. Pure data and rules only.

/** ISO calendar date, yyyy-MM-dd. */
export type IsoDate = string;
/** ISO timestamp. */
export type IsoDateTime = string;

export type Role = "admin" | "dealer" | "distributor" | "customer";

export const WARRANTY_STATUSES = [
  "ACTIVE",
  "EXPIRING_SOON",
  "EXPIRED",
  "VOID",
  "PENDING",
] as const;
export type WarrantyStatus = (typeof WARRANTY_STATUSES)[number];

export const PART_TYPES = ["UNIT", "COMPRESSOR", "PCB"] as const;
export type PartType = (typeof PART_TYPES)[number];

export interface Brand {
  id: string;
  name: string;
}

/** One line of a model template: which part, how long it's covered, and what the cover includes. */
export interface ModelPart {
  partType: PartType;
  warrantyMonths: number;
  coversParts: boolean;
  coversLabour: boolean;
  /** Key parts carry their own serial number. */
  serialised: boolean;
}

export interface Model {
  id: string;
  /** e.g. "AER-SPL15" */
  code: string;
  brandId: string;
  name: string;
  capacity: string;
  type: string;
  parts: ModelPart[];
}

export interface Distributor {
  id: string;
  name: string;
  city: string;
}

export interface Dealer {
  id: string;
  name: string;
  city: string;
  distributorId?: string;
}

export interface Customer {
  id: string;
  name: string;
  phone: string;
  email?: string;
  city: string;
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  dealerId?: string;
  distributorId?: string;
  customerId?: string;
}

export interface UnitPart {
  id: string;
  partType: PartType;
  serial?: string;
  warrantyStart: IsoDate;
  warrantyEnd: IsoDate;
  coversParts: boolean;
  coversLabour: boolean;
  /** Set when this part was taken out; the replacement is a new UnitPart. */
  replacedAt?: IsoDate;
  replacedBySerial?: string;
  /** Set on a replacement part: the serial it replaced. */
  replacesSerial?: string;
}

export interface VoidRecord {
  reason: VoidReason;
  note?: string;
  by: string;
  byName: string;
  at: IsoDateTime;
}

export const VOID_REASONS = [
  "UNAUTHORISED_REPAIR",
  "MISSED_SERVICING",
  "PHYSICAL_DAMAGE",
  "OTHER",
] as const;
export type VoidReason = (typeof VOID_REASONS)[number];

export type UnitEventType =
  | "registered"
  | "part_replaced"
  | "voided"
  | "complaint_raised"
  | "claim_created"
  | "note";

export interface UnitEvent {
  at: IsoDateTime;
  type: UnitEventType;
  byName: string;
  /** Free text, e.g. the unauthorised-repair note. */
  text?: string;
  /** "voided" events: why the warranty was voided. */
  reason?: VoidReason;
  refId?: string;
}

export interface Unit {
  serial: string;
  modelId: string;
  brandId: string;
  dealerId?: string;
  customerId?: string;
  /** Site or address where the unit is installed. */
  location?: string;
  installDate?: IsoDate;
  purchaseDate?: IsoDate;
  /** Empty until the unit is registered (approved); the warranty starts then. */
  parts: UnitPart[];
  void?: VoidRecord;
  registrationId?: string;
  attachmentIds: string[];
  history: UnitEvent[];
}

export const REGISTRATION_CHANNELS = [
  "DEALER",
  "PORTAL",
  "EMAIL",
  "ERP",
  "BULK",
] as const;
export type RegistrationChannel = (typeof REGISTRATION_CHANNELS)[number];

export const REGISTRATION_STATUSES = [
  "PENDING",
  "APPROVED",
  "REJECTED",
] as const;
export type RegistrationStatus = (typeof REGISTRATION_STATUSES)[number];

export const REGISTRATION_FLAGS = [
  "EXCEPTION",
  "DUPLICATE",
  "MODEL_MISMATCH",
] as const;
export type RegistrationFlag = (typeof REGISTRATION_FLAGS)[number];

export interface RegistrationCustomer {
  name: string;
  phone?: string;
  email?: string;
  city?: string;
}

export interface Registration {
  id: string;
  channel: RegistrationChannel;
  status: RegistrationStatus;
  flags: RegistrationFlag[];
  serial: string;
  modelCode: string;
  customer: RegistrationCustomer;
  customerId?: string;
  dealerId?: string;
  installDate?: IsoDate;
  purchaseDate?: IsoDate;
  invoiceNumber?: string;
  /** Site where the unit is installed. */
  location?: string;
  attachmentIds: string[];
  submittedBy: string;
  submittedByName: string;
  submittedAt: IsoDateTime;
  /** Serial of the existing unit this one duplicates. */
  duplicateOfSerial?: string;
  rejectReason?: string;
  reviewedByName?: string;
  reviewedAt?: IsoDateTime;
  /** Bulk upload this row came from. */
  batchId?: string;
}

export const COMPLAINT_SOURCES = ["CUSTOMER", "DEALER", "ADMIN"] as const;
export type ComplaintSource = (typeof COMPLAINT_SOURCES)[number];

export const COMPLAINT_STATUSES = ["NEW", "WITH_SERVICE", "RESOLVED"] as const;
export type ComplaintStatus = (typeof COMPLAINT_STATUSES)[number];

export type Coverage = "COVERED" | "CHARGEABLE";

export type EntitlementReason =
  "VOID" | "NOT_REGISTERED" | "NOTHING_ACTIVE" | "PARTIAL" | "FULL";

export interface Entitlement {
  parts: Coverage;
  labour: Coverage;
  /** Part types whose parts are still covered. */
  coveredPartTypes: PartType[];
  /** False for void units and when nothing is covered: no manufacturer claim will be raised. */
  claimable: boolean;
  reason: EntitlementReason;
}

export interface ComplaintEvent {
  at: IsoDateTime;
  status: ComplaintStatus;
  byName: string;
  text?: string;
}

export interface Complaint {
  id: string;
  unitSerial: string;
  source: ComplaintSource;
  raisedBy: string;
  raisedByName: string;
  dealerId?: string;
  customerId?: string;
  description: string;
  attachmentIds: string[];
  status: ComplaintStatus;
  entitlement: Entitlement;
  serviceRequestId?: string;
  jobResultId?: string;
  claimId?: string;
  createdAt: IsoDateTime;
  history: ComplaintEvent[];
}

export interface ReplacedPart {
  partType: PartType;
  oldSerial?: string;
  newSerial: string;
}

export interface JobResult {
  id: string;
  complaintId: string;
  technician: string;
  completedAt: IsoDateTime;
  partsReplaced: ReplacedPart[];
  photoIds: string[];
  signOffName: string;
  notes?: string;
}

export const CLAIM_STATUSES = [
  "DRAFT",
  "SUBMITTED",
  "APPROVED",
  "PAID",
  "REJECTED",
] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

export const FINANCE_POSTING_STATUSES = [
  "NOT_POSTED",
  "POSTED",
  "FAILED",
] as const;
export type FinancePostingStatus = (typeof FINANCE_POSTING_STATUSES)[number];

export interface ClaimEvent {
  at: IsoDateTime;
  status: ClaimStatus;
  byName: string;
  text?: string;
}

export interface Claim {
  id: string;
  complaintId?: string;
  unitSerial: string;
  brandId: string;
  dealerId?: string;
  status: ClaimStatus;
  rmaNumber?: string;
  amount?: number;
  /** Evidence pulled from the job result. */
  jobResultId?: string;
  photoIds: string[];
  partsReplaced: ReplacedPart[];
  financePosting: FinancePostingStatus;
  rejectReason?: string;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  history: ClaimEvent[];
}

export const INTEGRATION_SYSTEMS = [
  "CRM",
  "ERP",
  "FINANCE",
  "SERVICE",
  "OEM",
  "EMAIL",
] as const;
export type IntegrationSystem = (typeof INTEGRATION_SYSTEMS)[number];

export type IntegrationDirection = "IN" | "OUT";

export const INTEGRATION_STATUSES = ["PENDING", "SUCCESS", "FAILED"] as const;
export type IntegrationStatus = (typeof INTEGRATION_STATUSES)[number];

export interface IntegrationMessage {
  id: string;
  system: IntegrationSystem;
  direction: IntegrationDirection;
  /** e.g. "service_request", "job_result", "oem_decision", "finance_posting", "erp_invoice", "crm_update" */
  type: string;
  status: IntegrationStatus;
  payload: unknown;
  attempts: number;
  lastError?: string;
  refId?: string;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface Notification {
  id: string;
  userId: string;
  /** i18n key under `notifications.` in the UI. */
  key: string;
  params?: Record<string, string | number>;
  link?: string;
  createdAt: IsoDateTime;
  read: boolean;
}

export interface Attachment {
  id: string;
  name: string;
  mime: string;
  size: number;
  url: string;
  uploadedBy: string;
  createdAt: IsoDateTime;
}

// Domain model for the Fieldpiece warranty management system.
// Package @wms/domain: shared by frontend/, backend/ and backend/demo-server/. Pure data and rules only.

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

// ── Catalogue ────────────────────────────────────────────────────────────────

/** Product category from the Fieldpiece catalogue, e.g. "Clamp meters". */
export interface ProductCategory {
  id: string;
  name: string;
}

/** A Fieldpiece product model, e.g. SC680 Swivel Head Wireless Clamp Meter. */
export interface Model {
  id: string;
  /** Model number as printed on the product, e.g. "SC680". */
  code: string;
  categoryId: string;
  name: string;
  /** One-line description, e.g. "600A AC/DC swivel head clamp meter with Job Link". */
  description: string;
  /** Warranty from the date of purchase. */
  warrantyMonths: number;
  /** Regular expression every serial number of this model must match. */
  serialPattern: string;
  /** Regular expression every batch (production lot) number of this model must match. */
  batchPattern: string;
}

// ── Organisation ─────────────────────────────────────────────────────────────

export interface Distributor {
  id: string;
  name: string;
  city: string;
  state: string;
}

export interface Dealer {
  id: string;
  name: string;
  city: string;
  state: string;
  distributorId?: string;
}

/** US postal address parts kept for customers. */
export interface Customer {
  id: string;
  name: string;
  phone: string;
  email?: string;
  city: string;
  state: string;
  zip: string;
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

// ── Registered products ──────────────────────────────────────────────────────

export const VOID_REASONS = [
  "UNAUTHORIZED_REPAIR",
  "MISUSE",
  "PHYSICAL_DAMAGE",
  "OTHER",
] as const;
export type VoidReason = (typeof VOID_REASONS)[number];

export interface VoidRecord {
  reason: VoidReason;
  note?: string;
  by: string;
  byName: string;
  at: IsoDateTime;
}

export type UnitEventType =
  | "registered"
  | "voided"
  | "claim_filed"
  | "claim_closed"
  | "replaced"
  | "note";

export interface UnitEvent {
  at: IsoDateTime;
  type: UnitEventType;
  byName: string;
  /** Free text, e.g. a note or the replacement serial. */
  text?: string;
  /** "voided" events: why the warranty was voided. */
  reason?: VoidReason;
  refId?: string;
}

/**
 * One physical product, identified by its serial number. Known before registration (e.g. from an ERP invoice) with
 * no warranty dates; registration (approval) sets them.
 */
export interface Unit {
  serial: string;
  /** Production lot the product was built in, printed next to the serial. */
  batchNumber?: string;
  modelId: string;
  dealerId?: string;
  customerId?: string;
  purchaseDate?: IsoDate;
  /** Where it was bought, when not from a dealer in the system (e.g. an online marketplace). */
  placeOfPurchase?: string;
  /** Empty until the product is registered (approved). */
  warrantyStart?: IsoDate;
  warrantyEnd?: IsoDate;
  void?: VoidRecord;
  registrationId?: string;
  /** Set on a replacement product: the serial it replaced. */
  replacesSerial?: string;
  /** Set when this product was replaced under warranty. */
  replacedBySerial?: string;
  attachmentIds: string[];
  history: UnitEvent[];
}

// ── Registrations ────────────────────────────────────────────────────────────

/**
 * Where a registration came from. BULK is a dealer file upload, WEB the public form on the website, PORTAL a
 * signed-in customer, API a partner system, RETAIL an online marketplace or retailer feed.
 */
export const REGISTRATION_CHANNELS = [
  "DEALER",
  "BULK",
  "PORTAL",
  "WEB",
  "EMAIL",
  "ERP",
  "API",
  "RETAIL",
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
  state?: string;
  zip?: string;
}

export interface Registration {
  id: string;
  channel: RegistrationChannel;
  status: RegistrationStatus;
  flags: RegistrationFlag[];
  serial: string;
  batchNumber?: string;
  modelCode: string;
  customer: RegistrationCustomer;
  customerId?: string;
  dealerId?: string;
  purchaseDate?: IsoDate;
  invoiceNumber?: string;
  placeOfPurchase?: string;
  attachmentIds: string[];
  submittedBy: string;
  submittedByName: string;
  submittedAt: IsoDateTime;
  /** Serial of the existing registered product this one duplicates. */
  duplicateOfSerial?: string;
  rejectReason?: string;
  reviewedByName?: string;
  reviewedAt?: IsoDateTime;
  /** Bulk upload this row came from. */
  importId?: string;
}

// ── Warranty claims ──────────────────────────────────────────────────────────

export const CLAIM_SOURCES = ["CUSTOMER", "DEALER", "ADMIN"] as const;
export type ClaimSource = (typeof CLAIM_SOURCES)[number];

export const CLAIM_STATUSES = [
  "SUBMITTED",
  "IN_REVIEW",
  "APPROVED",
  "REJECTED",
  "CLOSED",
] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

/** What the claimant reports is wrong. */
export const ISSUE_TYPES = [
  "NO_POWER",
  "INACCURATE_READING",
  "DISPLAY",
  "CONNECTIVITY",
  "LEAK_OR_PRESSURE",
  "MECHANICAL",
  "OTHER",
] as const;
export type IssueType = (typeof ISSUE_TYPES)[number];

/** How an approved claim is settled. */
export const RESOLUTIONS = ["REPAIR", "REPLACE", "CREDIT"] as const;
export type Resolution = (typeof RESOLUTIONS)[number];

export type CoverageReason =
  "IN_WARRANTY" | "EXPIRED" | "VOID" | "NOT_REGISTERED";

/** Whether the product's warranty covers a claim on a given day. */
export interface Coverage {
  covered: boolean;
  reason: CoverageReason;
  warrantyEnd?: IsoDate;
}

export interface ClaimEvent {
  at: IsoDateTime;
  status: ClaimStatus;
  byName: string;
  text?: string;
}

export interface WarrantyClaim {
  id: string;
  unitSerial: string;
  source: ClaimSource;
  raisedBy: string;
  raisedByName: string;
  dealerId?: string;
  customerId?: string;
  issueType: IssueType;
  description: string;
  attachmentIds: string[];
  status: ClaimStatus;
  /** Coverage when the claim was filed (re-checked when the product is voided later). */
  coverage: Coverage;
  resolution?: Resolution;
  /** Credit issued, in the account currency (CREDIT resolution). */
  creditAmount?: number;
  /** Serial (and batch) of the product sent as the replacement (REPLACE resolution). */
  replacementSerial?: string;
  replacementBatchNumber?: string;
  decisionNote?: string;
  rejectReason?: string;
  reviewedByName?: string;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  history: ClaimEvent[];
}

// ── Integrations, notifications, files ──────────────────────────────────────

export const INTEGRATION_SYSTEMS = [
  "ERP",
  "EMAIL",
  "PARTNER",
  "CRM",
  "FINANCE",
] as const;
export type IntegrationSystem = (typeof INTEGRATION_SYSTEMS)[number];

export type IntegrationDirection = "IN" | "OUT";

export const INTEGRATION_STATUSES = ["PENDING", "SUCCESS", "FAILED"] as const;
export type IntegrationStatus = (typeof INTEGRATION_STATUSES)[number];

export interface IntegrationMessage {
  id: string;
  system: IntegrationSystem;
  direction: IntegrationDirection;
  /** e.g. "erp_invoice", "registration_email", "partner_registration", "crm_update", "credit_memo" */
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

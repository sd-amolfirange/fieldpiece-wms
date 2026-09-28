import type {
  Attachment,
  ClaimStatus,
  Dealer,
  Distributor,
  IsoDate,
  Model,
  ProductCategory,
  Registration,
  RegistrationChannel,
  Role,
  Unit,
  UnitEvent,
  User,
  WarrantyClaim,
  WarrantyStatus,
} from "./types";
import type { BulkImport, bulkCounts } from "./registration-rules";

// Shapes the API returns: domain records plus computed warranty status and display names,
// so screens don't repeat the rules or the lookups.

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  dealerId?: string;
  distributorId?: string;
  customerId?: string;
  /** Dealer, distributor or customer display name for the account menu. */
  orgName?: string;
  /** ISO 4217 code for money on screen, e.g. "USD". */
  currency: string;
}

export interface UnitView extends Unit {
  modelCode: string;
  modelName: string;
  modelDescription: string;
  /** The model's product photo, for anywhere this product is shown. */
  modelImageUrl?: string;
  categoryName: string;
  dealerName?: string;
  customerName?: string;
  status: WarrantyStatus;
  daysRemaining: number;
}

export interface RegistrationView extends Registration {
  /** The model's product photo, for anywhere this registration is shown. */
  modelImageUrl?: string;
  dealerName?: string;
  /** Existing product with the same serial, for the duplicate comparison. */
  duplicateOf?: UnitView;
}

export interface WarrantyClaimView extends WarrantyClaim {
  batchNumber?: string;
  modelCode: string;
  modelName: string;
  /** The model's product photo, for anywhere this claim is shown. */
  modelImageUrl?: string;
  categoryName: string;
  dealerName?: string;
  customerName?: string;
  /** The product's purchase date and warranty end, for the review. */
  purchaseDate?: IsoDate;
  warrantyEnd?: IsoDate;
  /** The product's warranty status today. */
  warrantyStatus: WarrantyStatus;
  attachments: Attachment[];
}

export interface BulkImportView extends BulkImport {
  dealerName?: string;
  counts: ReturnType<typeof bulkCounts>;
}

export interface ModelView extends Model {
  categoryName: string;
}

export interface DealerView extends Dealer {
  distributorName?: string;
}

export interface UserView extends User {
  orgName?: string;
}

export interface OrgStructure {
  distributors: (Distributor & { dealers: Dealer[] })[];
  directDealers: Dealer[];
  users: UserView[];
}

export interface ChannelCount {
  channel: Exclude<RegistrationChannel, "BULK">;
  count: number;
}

export interface CategoryCount {
  categoryId: ProductCategory["id"];
  categoryName: string;
  count: number;
}

/** A01 expiring-soon list: products whose warranty ends within 30 days. */
export interface ExpiringUnit {
  serial: string;
  modelName: string;
  customerName?: string;
  dealerName?: string;
  warrantyEnd: IsoDate;
  daysRemaining: number;
}

/** A01 recent activity: the latest product events across the system. */
export interface ActivityItem extends UnitEvent {
  serial: string;
}

export interface DealerStats {
  dealerId: string;
  dealerName: string;
  registrationsThisMonth: number;
  pending: number;
  openClaims: number;
}

export type DashboardSummary =
  | {
      role: "admin";
      /** Every product in the Registered products list; equals active + expiring30 + expired + pending + voided. */
      units: number;
      active: number;
      expiring30: number;
      expired: number;
      /** Known to the system (e.g. from an ERP invoice) but not registered yet. */
      pending: number;
      voided: number;
      openClaims: number;
      /** Registrations waiting for review. */
      pendingRegistrations: number;
      /** Approved registrations by channel; bulk uploads count under Dealer. */
      registrationsByChannel: ChannelCount[];
      claimsByStatus: { status: ClaimStatus; count: number }[];
      claimsByCategory: CategoryCount[];
      expiringSoon: ExpiringUnit[];
      recentActivity: ActivityItem[];
    }
  | {
      role: "dealer" | "distributor";
      registrationsThisMonth: number;
      pending: number;
      rejected: number;
      openClaims: number;
      dealers: DealerStats[];
    }
  | {
      role: "customer";
      units: number;
      active: number;
      expiringSoon: number;
      openClaims: number;
    };

/** Where registrations can come in (the registration hub). */
export interface IntakeInfo {
  /** Path of the public registration form on the web app, e.g. "/register-product". */
  publicFormPath: string;
  /** Mailbox that turns emailed invoices into registrations. */
  inboundEmail: string;
  /** Base URL of the partner API, e.g. "/api/partner/v1". */
  partnerApiPath: string;
}

/** A partner system allowed to send registrations (admin view; the key itself is never shown again). */
export interface PartnerClientView {
  id: string;
  name: string;
  channel: Extract<RegistrationChannel, "API" | "RETAIL" | "ERP">;
  dealerId?: string;
  dealerName?: string;
  keyPrefix: string;
  active: boolean;
  lastUsedAt?: string;
}

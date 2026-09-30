import type {
  Attachment,
  ClaimStatus,
  Dealer,
  Distributor,
  FieldpieceAppChannel,
  IsoDate,
  Model,
  ProductCategory,
  Registration,
  RegistrationChannel,
  PartnerChannel,
  Resolution,
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
  /** Channel of the registration that started the warranty (absent while not registered). */
  registrationChannel?: RegistrationChannel;
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

/** Internal finance figures of a model: sent to the warranty desk only (never to other roles or the public API). */
export const INTERNAL_MODEL_FIELDS = ["repairCost", "warrantyBudget", "claimQuota"] as const;
type InternalModelField = (typeof INTERNAL_MODEL_FIELDS)[number];

/** A model as the API returns it. `listPrice` (the retail price) is public; the internal figures are admin-only. */
export interface ModelView extends Omit<Model, InternalModelField>, Partial<Pick<Model, InternalModelField>> {
  categoryName: string;
}

/** The model without its internal finance figures, for every caller except the warranty desk. */
export function publicModelView(model: ModelView): ModelView {
  const view: ModelView = { ...model };
  for (const field of INTERNAL_MODEL_FIELDS) delete view[field];
  return view;
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

/** One month of activity for trend charts ("YYYY-MM"), the last 12 months, oldest first. */
export interface MonthlyTrend {
  month: string;
  /** Registrations approved that month. */
  registrations: number;
  /** Warranty claims filed that month. */
  claims: number;
}

export interface WarrantyStatusCount {
  status: WarrantyStatus;
  count: number;
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
      trend: MonthlyTrend[];
      /** Warranties registered from Fieldpiece's apps, one entry per app. */
      apps: AppChannelStats[];
    }
  | {
      role: "dealer" | "distributor";
      registrationsThisMonth: number;
      pending: number;
      rejected: number;
      openClaims: number;
      dealers: DealerStats[];
      /** Products sold by the dealer(s) in scope, by warranty status today. */
      unitsByStatus: WarrantyStatusCount[];
      claimsByStatus: { status: ClaimStatus; count: number }[];
      trend: MonthlyTrend[];
    }
  | {
      role: "customer";
      units: number;
      active: number;
      expiringSoon: number;
      openClaims: number;
      unitsByStatus: WarrantyStatusCount[];
    };

// ── Finance (A01 / DL01 finance insights) ────────────────────────────────────────────────────────────────────────

/** A01 "Fieldpiece apps": warranties registered from Overwatch and Job Link. */
export interface AppChannelStats {
  channel: FieldpieceAppChannel;
  /** Registered products whose registration came from this app. */
  units: number;
  active: number;
  expiringSoon: number;
  expired: number;
  /** Registrations from this app waiting for review. */
  pendingRegistrations: number;
  /** Products registered from this app in the last 30 days. */
  last30Days: number;
  /** Warranty claims on these products (any status). */
  claims: number;
}

/** A model's warranty quota and how much of it the last 12 months used. */
export interface ModelQuota {
  modelId: string;
  modelCode: string;
  modelName: string;
  categoryName: string;
  imageUrl?: string;
  /** Registered products of this model (in scope). */
  units: number;
  budget: number;
  /** Cost of approved and closed claims in the period. */
  spent: number;
  budgetUsedPct: number;
  claimQuota: number;
  claims: number;
  claimQuotaUsedPct: number;
}

export interface FinanceSummary {
  currency: string;
  /** Rolling 12 months: periodStart .. periodEnd (today), inclusive. */
  periodStart: IsoDate;
  periodEnd: IsoDate;
  /** Cost of approved and closed claims (repairs, replacements, credits). */
  warrantyCost: number;
  creditsIssued: number;
  extensionRevenue: number;
  extensionsSold: number;
  /** warrantyCost - extensionRevenue. */
  netWarrantyCost: number;
  /** Sum of the warranty budgets of the models in scope. */
  budget: number;
  budgetUsedPct: number;
  /** Average cost per settled claim. */
  averageClaimCost: number;
  costByResolution: { resolution: Resolution; amount: number; count: number }[];
  costByCategory: { categoryId: string; categoryName: string; amount: number }[];
  /** Last 12 months, oldest first. */
  monthly: { month: string; cost: number; extensionRevenue: number }[];
  /** Models with activity or a budget, highest budget use first. */
  quotas: ModelQuota[];
}

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
  channel: PartnerChannel;
  dealerId?: string;
  dealerName?: string;
  keyPrefix: string;
  active: boolean;
  lastUsedAt?: string;
}

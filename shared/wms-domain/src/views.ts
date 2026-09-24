import type {
  Brand,
  Claim,
  Complaint,
  Dealer,
  Distributor,
  JobResult,
  Model,
  Registration,
  RegistrationChannel,
  Role,
  Unit,
  UnitPart,
  User,
  WarrantyStatus,
} from "./types";

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
  currency: string;
}

export interface UnitPartView extends UnitPart {
  status: WarrantyStatus;
  daysRemaining: number;
}

export interface UnitView extends Omit<Unit, "parts"> {
  modelCode: string;
  modelName: string;
  capacity: string;
  unitType: string;
  brandName: string;
  dealerName?: string;
  customerName?: string;
  status: WarrantyStatus;
  daysRemaining: number;
  parts: UnitPartView[];
}

export interface RegistrationView extends Registration {
  dealerName?: string;
  /** Existing unit with the same serial, for the duplicate comparison. */
  duplicateOf?: UnitView;
}

export interface ComplaintView extends Complaint {
  modelCode: string;
  brandName: string;
  dealerName?: string;
  customerName?: string;
  jobResult?: JobResult;
  claimStatus?: Claim["status"];
}

export interface ClaimView extends Claim {
  brandName: string;
  dealerName?: string;
  modelCode: string;
}

export interface ModelView extends Model {
  brandName: string;
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

export interface BrandCount {
  brandId: Brand["id"];
  brandName: string;
  count: number;
}

export interface DealerStats {
  dealerId: string;
  dealerName: string;
  registrationsThisMonth: number;
  pending: number;
  openComplaints: number;
}

export type DashboardSummary =
  | {
      role: "admin";
      /** Every unit in the Units list; equals active + expiring30 + expired + pending + voided. */
      units: number;
      active: number;
      expiring30: number;
      expired: number;
      /** Known to the system (e.g. sold, QR label printed) but not registered yet. */
      pending: number;
      voided: number;
      openClaims: number;
      /** Approved registrations; bulk uploads count under Dealer. */
      registrationsByChannel: ChannelCount[];
      claimsByBrand: BrandCount[];
    }
  | {
      role: "dealer" | "distributor";
      registrationsThisMonth: number;
      pending: number;
      rejected: number;
      openComplaints: number;
      claimsInProgress: number;
      dealers: DealerStats[];
    }
  | {
      role: "customer";
      units: number;
      active: number;
      expiringSoon: number;
      openComplaints: number;
    };

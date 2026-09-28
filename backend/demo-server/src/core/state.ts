import type {
  Attachment,
  BulkImport,
  Customer,
  Dealer,
  Distributor,
  IntegrationMessage,
  Model,
  Notification,
  ProductCategory,
  Registration,
  RegistrationChannel,
  Unit,
  User,
  WarrantyClaim,
} from "@wms/domain";

// The whole mock database. Plain JSON so the demo server can save it to disk and reload it.

/** A partner system allowed to use the partner API. */
export interface PartnerClientRecord {
  id: string;
  name: string;
  channel: Extract<RegistrationChannel, "API" | "RETAIL" | "ERP">;
  dealerId?: string;
  /**
   * The key itself. The real backend keeps only its SHA-256; the mock keeps it in plain text (it's demo data and the
   * core also runs in the browser, without node:crypto). Never returned by the API after creation.
   */
  apiKey: string;
  keyPrefix: string;
  active: boolean;
  lastUsedAt?: string;
  createdAt: string;
}

export interface DemoState {
  /** Bumped when the shape changes, so a saved file from an older mock is replaced by the seed. */
  version: 2;
  categories: ProductCategory[];
  models: Model[];
  distributors: Distributor[];
  dealers: Dealer[];
  customers: Customer[];
  users: User[];
  units: Unit[];
  registrations: Registration[];
  claims: WarrantyClaim[];
  integrations: IntegrationMessage[];
  notifications: Notification[];
  attachments: Attachment[];
  bulkImports: BulkImport[];
  partnerClients: PartnerClientRecord[];
  /** Last value used per id prefix (REG, CLM, MSG, ...) and plain counters (ERPINV). */
  counters: Record<string, number>;
}

/** Next id for `prefix`, e.g. nextId(state, "REG") -> "REG-1043". */
export function nextId(state: DemoState, prefix: string): string {
  const next = (state.counters[prefix] ?? 1000) + 1;
  state.counters[prefix] = next;
  return `${prefix}-${next}`;
}

/** Next value of a plain counter (not an id), starting at 1. */
export function nextCounter(state: DemoState, name: string): number {
  const next = (state.counters[name] ?? 0) + 1;
  state.counters[name] = next;
  return next;
}

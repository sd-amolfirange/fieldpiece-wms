import type {
  Attachment,
  Brand,
  Claim,
  Complaint,
  Customer,
  Dealer,
  Distributor,
  IntegrationMessage,
  JobResult,
  Model,
  Notification,
  Registration,
  Unit,
  User,
} from "@wms/domain";

// The whole demo database. Plain JSON so the demo server can save it to disk and reload it.

export interface DemoState {
  version: 1;
  brands: Brand[];
  models: Model[];
  distributors: Distributor[];
  dealers: Dealer[];
  customers: Customer[];
  users: User[];
  units: Unit[];
  registrations: Registration[];
  complaints: Complaint[];
  jobResults: JobResult[];
  claims: Claim[];
  integrations: IntegrationMessage[];
  notifications: Notification[];
  attachments: Attachment[];
  counters: Record<string, number>;
}

/** Next id for `prefix`, e.g. nextId(state, "REG") -> "REG-1043". */
export function nextId(state: DemoState, prefix: string): string {
  const next = (state.counters[prefix] ?? 1000) + 1;
  state.counters[prefix] = next;
  return `${prefix}-${next}`;
}

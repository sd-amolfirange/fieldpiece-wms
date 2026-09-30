import {
  addDaysIso,
  addMonthsIso,
  CLAIM_STATUSES,
  claimCost,
  extensionQuote,
  FIELDPIECE_APP_CHANNELS,
  INTEGRATION_STATUSES,
  INTEGRATION_SYSTEMS,
  coverageFor,
  isOpenClaim,
  percent,
  publicModelView,
  REGISTRATION_CHANNELS,
  RESOLUTIONS,
  roundMoney,
  unitWarranty,
  VOID_REASONS,
  WARRANTY_STATUSES,
  type AppChannelStats,
  type Attachment,
  type ChannelCount,
  type ClaimStatus,
  type Coverage,
  type DashboardSummary,
  type DealerStats,
  type DealerView,
  type ExtensionBlock,
  type ExtensionQuote,
  type FinanceSummary,
  type IntegrationDirection,
  type IntegrationMessage,
  type IntegrationStatus,
  type IntegrationSystem,
  type IsoDate,
  type Model,
  type ModelQuota,
  type ModelView,
  type MonthlyTrend,
  type Notification,
  type OrgStructure,
  type Paginated,
  type ProductCategory,
  type Registration,
  type RegistrationChannel,
  type RegistrationView,
  type Role,
  type SessionUser,
  type Unit,
  type UnitEvent,
  type UnitView,
  type User,
  type VoidReason,
  type WarrantyClaim,
  type WarrantyClaimView,
  type WarrantyStatus,
  type WarrantyStatusCount,
} from "@wms/domain";
import { conflict, forbidden, notFound, ServiceError, validation } from "./errors";
import { canSee, visibleDealerIds, type Scoped } from "./scope";
import { DEMO_PASSWORD } from "./seed";
import { nextId, type DemoState } from "./state";

// Services behind every mock endpoint (server-side only), mirroring the real backend's modules. The Express adapter
// and the frontend's test-only MSW adapter only parse the request, call dispatch() and serialise the result.

/** File bytes as the adapters keep them. */
export type DemoFileData = Uint8Array | string;

/** Where the adapter keeps uploaded bytes (the server: on disk; the test adapter: in memory). */
export interface FileStore {
  /** Public URL of a stored file, as Attachment.url. */
  url(id: string): string;
  save(attachment: Attachment, data: DemoFileData): void;
  load(id: string): DemoFileData | undefined;
}

/** Context for work without a signed-in user (public form, partner API, email intake). */
export interface SystemCtx {
  state: DemoState;
  today: IsoDate;
  /** ISO timestamp for records written now. */
  now: string;
  files: FileStore;
}

export interface Ctx extends SystemCtx {
  user: User;
}

/** A file that came with a request (multipart upload or email attachment). */
export interface DemoFile {
  name: string;
  mime: string;
  size: number;
  data?: DemoFileData;
}

// ---- helpers -------------------------------------------------------------------------------------

export function requireRole(ctx: Ctx, ...roles: Role[]) {
  if (!roles.includes(ctx.user.role)) throw forbidden();
}

/**
 * Runs `fn` like a database transaction: when it throws, every change it made to the state is undone. The dispatcher
 * wraps each write; services use it where the backend commits part of a request on its own (bulk rows, bulk approve).
 */
export function transaction<T>(state: DemoState, fn: () => T): T {
  const snapshot = JSON.parse(JSON.stringify(state)) as DemoState;
  try {
    return fn();
  } catch (e) {
    Object.assign(state, snapshot);
    throw e;
  }
}

export interface ListQuery {
  page: number;
  pageSize: number;
  sort?: string;
  q?: string;
}

export type RawQuery = Record<string, string | undefined>;

const positiveInt = (value: string | undefined) => {
  const n = value ? Number(value) : NaN;
  return Number.isInteger(n) && n > 0 ? n : undefined;
};

/** A single query value, trimmed; blank means "not given". */
export const queryString = (query: RawQuery, key: string) => query[key]?.trim() || undefined;

/** A query value that must be one of `allowed`; anything else is treated as "no filter". */
export function queryEnum<T extends string>(query: RawQuery, key: string, allowed: readonly T[]) {
  const value = queryString(query, key);
  return value && (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
}

/** ?page=1&pageSize=25&sort=-field&q=text. pageSize is clamped to 1..100 rather than rejected. */
export const listQuery = (query: RawQuery): ListQuery => ({
  page: positiveInt(query.page) ?? 1,
  pageSize: Math.min(100, positiveInt(query.pageSize) ?? 25),
  sort: queryString(query, "sort")?.slice(0, 50),
  q: queryString(query, "q")?.slice(0, 100),
});

export function paginate<T>(items: T[], { page, pageSize }: ListQuery): Paginated<T> {
  return { items: items.slice((page - 1) * pageSize, page * pageSize), total: items.length, page, pageSize };
}

type SortValue = string | number | undefined;
export type SortKeys<T> = Record<string, (row: T) => SortValue>;

function compareValues(a: SortValue, b: SortValue): number {
  if (a === undefined || b === undefined) return a === b ? 0 : a === undefined ? 1 : -1; // nulls last
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b));
}

/** Numeric order of readable ids ("REG-999" before "REG-1000"). */
export const idOrder = (id: string) => Number(/(\d+)$/.exec(id)?.[1] ?? 0);

/**
 * Sorts by "-field" from an allow-list of sortable fields; an unknown field falls back to the default order instead
 * of failing the page (as the backend does). Ties keep `tieBreak` ascending.
 */
export function sortRows<T>(
  items: readonly T[],
  sort: string | undefined,
  keys: SortKeys<T>,
  fallback: string,
  tieBreak: (row: T) => SortValue,
): T[] {
  const keyOf = (spec: string | undefined) => (spec ? keys[spec.replace(/^-/, "")] : undefined);
  const spec = keyOf(sort) ? (sort as string) : fallback;
  const desc = spec.startsWith("-");
  const key = keyOf(spec) ?? (() => undefined);
  return [...items].sort((a, b) => {
    const va = key(a);
    const vb = key(b);
    // Nulls stay last in both directions.
    const primary =
      va === undefined || vb === undefined ? compareValues(va, vb) : compareValues(va, vb) * (desc ? -1 : 1);
    return primary || compareValues(tieBreak(a), tieBreak(b));
  });
}

/** Case-insensitive "contains" over the given values. */
export const matches = (q: string | undefined, ...values: (string | undefined)[]) => {
  if (!q) return true;
  const needle = q.toLowerCase();
  return values.some((v) => v?.toLowerCase().includes(needle));
};

const text = (value: unknown, max: number) => (typeof value === "string" ? value.trim().slice(0, max) : "");

export const dealerName = (state: DemoState, id?: string) => state.dealers.find((d) => d.id === id)?.name;
export const customerName = (state: DemoState, id?: string) => state.customers.find((c) => c.id === id)?.name;

// ---- auth ----------------------------------------------------------------------------------------

export function authenticate(state: DemoState, email: unknown, password: unknown): User {
  const address = typeof email === "string" ? email.trim().toLowerCase() : "";
  const user = state.users.find((u) => u.email.toLowerCase() === address);
  if (!user || password !== DEMO_PASSWORD) {
    throw new ServiceError(
      401,
      "invalid_credentials",
      "Email or password is wrong. Check them and try again.",
    );
  }
  return user;
}

export function toSessionUser(state: DemoState, user: User): SessionUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    dealerId: user.dealerId,
    distributorId: user.distributorId,
    customerId: user.customerId,
    orgName:
      dealerName(state, user.dealerId) ??
      state.distributors.find((d) => d.id === user.distributorId)?.name ??
      customerName(state, user.customerId),
    currency: "USD",
  };
}

// ---- views ---------------------------------------------------------------------------------------

export function toModelView(state: DemoState, modelId: string): ModelView | undefined {
  const model = state.models.find((m) => m.id === modelId);
  if (!model) return undefined;
  return { ...model, categoryName: state.categories.find((c) => c.id === model.categoryId)?.name ?? "" };
}

export function toUnitView(state: DemoState, unit: Unit, today: IsoDate): UnitView {
  const model = toModelView(state, unit.modelId);
  const warranty = unitWarranty(unit, today);
  return {
    ...unit,
    extensions: unit.extensions ?? [],
    modelCode: model?.code ?? unit.modelId,
    modelName: model?.name ?? "",
    modelDescription: model?.description ?? "",
    modelImageUrl: model?.imageUrl,
    categoryName: model?.categoryName ?? "",
    dealerName: dealerName(state, unit.dealerId),
    customerName: customerName(state, unit.customerId),
    status: warranty.status,
    daysRemaining: warranty.daysRemaining,
    registrationChannel: unit.registrationId
      ? state.registrations.find((r) => r.id === unit.registrationId)?.channel
      : undefined,
  };
}

/** `duplicateOf` (the existing product, for the A03 comparison) is shown to admins only. */
export function toRegistrationView(ctx: Ctx, r: Registration): RegistrationView {
  const duplicate =
    r.duplicateOfSerial && ctx.user.role === "admin"
      ? ctx.state.units.find((u) => u.serial === r.duplicateOfSerial)
      : undefined;
  return {
    ...r,
    modelImageUrl: ctx.state.models.find((m) => m.code === r.modelCode)?.imageUrl,
    dealerName: dealerName(ctx.state, r.dealerId),
    duplicateOf: duplicate ? toUnitView(ctx.state, duplicate, ctx.today) : undefined,
  };
}

export const attachmentsById = (state: DemoState, ids: readonly string[]): Attachment[] =>
  ids.flatMap((id) => state.attachments.find((a) => a.id === id) ?? []);

export function toClaimView(state: DemoState, c: WarrantyClaim, today: IsoDate): WarrantyClaimView {
  const unit = state.units.find((u) => u.serial === c.unitSerial);
  const model = unit ? toModelView(state, unit.modelId) : undefined;
  return {
    ...c,
    batchNumber: unit?.batchNumber,
    modelCode: model?.code ?? "",
    modelName: model?.name ?? "",
    modelImageUrl: model?.imageUrl,
    categoryName: model?.categoryName ?? "",
    dealerName: dealerName(state, c.dealerId),
    customerName: customerName(state, c.customerId),
    purchaseDate: unit?.purchaseDate,
    warrantyEnd: unit?.warrantyEnd,
    warrantyStatus: unit ? unitWarranty(unit, today).status : "PENDING",
    attachments: attachmentsById(state, c.attachmentIds),
  };
}

// ---- units ---------------------------------------------------------------------------------------

const UNIT_SORTS: SortKeys<UnitView> = {
  serial: (u) => u.serial,
  status: (u) => u.status,
  daysRemaining: (u) => u.daysRemaining,
  modelCode: (u) => u.modelCode,
  modelName: (u) => u.modelName,
  batchNumber: (u) => u.batchNumber,
  categoryName: (u) => u.categoryName,
  dealerName: (u) => u.dealerName,
  customerName: (u) => u.customerName,
  purchaseDate: (u) => u.purchaseDate,
  warrantyEnd: (u) => u.warrantyEnd,
};

/** The unit if the caller may see it; 404 otherwise (never 403, so serials can't be probed). */
export function findUnit(ctx: Ctx, serial: string): Unit {
  const unit = ctx.state.units.find((u) => u.serial === serial.trim().toUpperCase());
  if (!unit || !canSee(ctx.user, unit, ctx.state.dealers)) throw notFound("Product");
  return unit;
}

/** `channel` of the product list: one registration channel, or APPS for either Fieldpiece app. Else no filter. */
const UNIT_CHANNEL_FILTERS = [...REGISTRATION_CHANNELS, "APPS"] as const;

function channelFilter(query: RawQuery): readonly RegistrationChannel[] | undefined {
  const value = queryEnum(query, "channel", UNIT_CHANNEL_FILTERS);
  return value === "APPS" ? FIELDPIECE_APP_CHANNELS : value ? [value] : undefined;
}

/**
 * A04, DL04, CU02. `q` matches serial, batch, customer, dealer and model. `channel` is the channel of the registration
 * that started the warranty (APPS: either Fieldpiece app). Default sort `serial`.
 */
export function listUnits(ctx: Ctx, query: RawQuery = {}): Paginated<UnitView> {
  const list = listQuery(query);
  const status = queryEnum<WarrantyStatus>(query, "status", WARRANTY_STATUSES);
  const dealerId = queryString(query, "dealerId");
  const channels = channelFilter(query);
  const rows = ctx.state.units
    .filter((u) => canSee(ctx.user, u, ctx.state.dealers))
    .map((u) => toUnitView(ctx.state, u, ctx.today))
    .filter(
      (u) =>
        (!status || u.status === status) &&
        (!dealerId || u.dealerId === dealerId) &&
        (!channels || (!!u.registrationChannel && channels.includes(u.registrationChannel))) &&
        matches(list.q, u.serial, u.batchNumber, u.customerName, u.dealerName, u.modelCode),
    );
  return paginate(
    sortRows(rows, list.sort, UNIT_SORTS, "serial", (u) => u.serial),
    list,
  );
}

export const getUnit = (ctx: Ctx, serial: string): UnitView =>
  toUnitView(ctx.state, findUnit(ctx, serial), ctx.today);

/** Whether a warranty claim on this product would be covered today (shown before filing a claim). */
export const unitCoverage = (ctx: Ctx, serial: string): Coverage =>
  coverageFor(findUnit(ctx, serial), ctx.today);

/** The product for its warranty certificate: registered products only. */
export function certificateUnit(ctx: Ctx, serial: string): UnitView {
  const unit = getUnit(ctx, serial);
  if (!unit.warrantyEnd) throw conflict("not_registered", "This product isn't registered yet.");
  return unit;
}

export function addUnitEvent(unit: Unit, event: UnitEvent) {
  unit.history.push(event);
}

/** W5: the warranty desk voids a product's warranty with a reason and note, recorded with user and date. */
export function voidWarranty(ctx: Ctx, serial: string, body: { reason?: unknown; note?: unknown }): UnitView {
  requireRole(ctx, "admin");
  const unit = findUnit(ctx, serial);
  const reason = body.reason as VoidReason;
  if (!VOID_REASONS.includes(reason))
    throw validation("Choose a reason.", { reason: "validation.voidReason" });
  if (unit.void) throw conflict("already_void", "This warranty is already void.");
  if (!unit.warrantyEnd) throw conflict("not_registered", "This product isn't registered yet.");
  const note = text(body.note, 2000) || undefined;
  unit.void = { reason, note, by: ctx.user.id, byName: ctx.user.name, at: ctx.now };
  addUnitEvent(unit, { at: ctx.now, type: "voided", byName: ctx.user.name, reason, text: note });
  notify(ctx.state, followers(ctx.state, unit), "unit_voided", ctx.now, {
    params: { serial: unit.serial },
    link: `/units/${unit.serial}`,
  });
  return getUnit(ctx, unit.serial);
}

/** Why a product can't get an extended warranty (409 not_extendable). */
const NOT_EXTENDABLE: Record<ExtensionBlock, string> = {
  NOT_REGISTERED: "This product isn't registered yet.",
  VOID: "This warranty is void, so it can't be extended.",
  REPLACED: "This product was replaced; extend the replacement's warranty instead.",
  EXPIRED: "This warranty has expired; only a warranty still in force can be extended.",
  LIMIT_REACHED: "This warranty was already extended by the maximum 36 months.",
};

const quoteFor = (state: DemoState, unit: Unit, today: IsoDate): ExtensionQuote =>
  extensionQuote(unit, { listPrice: state.models.find((m) => m.id === unit.modelId)?.listPrice ?? 0 }, today);

/** Extended-warranty offer for this product today: the plans still open, their price and new end date. */
export const unitExtensionQuote = (ctx: Ctx, serial: string): ExtensionQuote =>
  quoteFor(ctx.state, findUnit(ctx, serial), ctx.today);

/**
 * Sells an extended warranty: moves the warranty end date by the chosen plan, records who sold it (the dealer is
 * credited when a dealer sells it) and invoices it through Finance. Anyone who can see the product can buy one.
 */
export function extendWarranty(ctx: Ctx, serial: string, body: { months?: unknown }): UnitView {
  const unit = findUnit(ctx, serial);
  const quote = quoteFor(ctx.state, unit, ctx.today);
  if (!quote.eligible || !unit.warrantyEnd) {
    throw conflict("not_extendable", NOT_EXTENDABLE[quote.reason ?? "NOT_REGISTERED"]);
  }
  const option = quote.options.find((o) => o.months === body.months);
  if (!option) throw validation("Choose a plan.", { months: "validation.extensionPlan" });
  const id = nextId(ctx.state, "EXT");
  const dealerId = ctx.user.role === "dealer" && ctx.user.dealerId ? ctx.user.dealerId : unit.dealerId;
  unit.extensions = [
    ...(unit.extensions ?? []),
    {
      id,
      months: option.months,
      price: option.price,
      previousEnd: unit.warrantyEnd,
      newEnd: option.newEnd,
      soldBy: ctx.user.id,
      soldByName: ctx.user.name,
      dealerId,
      at: ctx.now,
    },
  ];
  unit.warrantyEnd = option.newEnd;
  addUnitEvent(unit, {
    at: ctx.now,
    type: "extended",
    byName: ctx.user.name,
    text: `Warranty extended by ${option.months} months to ${option.newEnd}`,
    refId: id,
  });
  notify(ctx.state, followers(ctx.state, unit), "unit_extended", ctx.now, {
    params: { serial: unit.serial, months: option.months, newEnd: option.newEnd },
    link: `/units/${unit.serial}`,
  });
  logMessage(ctx, {
    system: "FINANCE",
    direction: "OUT",
    type: "extension_invoice",
    refId: id,
    payload: {
      extensionId: id,
      serial: unit.serial,
      model: ctx.state.models.find((m) => m.id === unit.modelId)?.code,
      months: option.months,
      price: option.price,
      currency: "USD",
      soldBy: ctx.user.id,
      dealerId,
    },
  });
  return getUnit(ctx, unit.serial);
}

// ---- catalogue and organisation --------------------------------------------------------------------

/** A06 and every model picker: grouped by category, in catalogue order. */
/** `withFinance`: include the internal finance figures (warranty desk only), like the backend. */
export function listModels(state: DemoState, withFinance = false): ModelView[] {
  const position = (categoryId: string) => state.categories.findIndex((c) => c.id === categoryId);
  const views = [...state.models]
    .sort((a, b) => position(a.categoryId) - position(b.categoryId))
    .flatMap((m) => toModelView(state, m.id) ?? []);
  return withFinance ? views : views.map(publicModelView);
}

const MODEL_MONEY_FIELDS = ["listPrice", "repairCost", "warrantyBudget"] as const;

/** A non-negative amount with at most 2 decimals, up to 1,000,000. */
const isMoney = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  value >= 0 &&
  value <= 1_000_000 &&
  Math.abs(Math.round(value * 100) - value * 100) < 1e-6;

/** A06: the warranty desk sets a model's list price, repair cost and warranty quota. Omitted fields keep their value. */
export function updateModel(ctx: Ctx, id: string, body: Record<string, unknown>): ModelView {
  requireRole(ctx, "admin");
  const errors: Record<string, string> = {};
  const changes: Partial<Pick<Model, "listPrice" | "repairCost" | "warrantyBudget" | "claimQuota">> = {};
  for (const field of MODEL_MONEY_FIELDS) {
    const value = body[field];
    if (value === undefined) continue;
    if (!isMoney(value)) errors[field] = "validation.amount";
    else changes[field] = roundMoney(value);
  }
  const quota = body.claimQuota;
  if (quota !== undefined) {
    if (typeof quota !== "number" || !Number.isInteger(quota) || quota < 0 || quota > 10_000)
      errors.claimQuota = "validation.quota";
    else changes.claimQuota = quota;
  }
  if (Object.keys(errors).length) throw validation("Check the highlighted fields.", errors);
  const model = ctx.state.models.find((m) => m.id === id);
  if (!model) throw notFound("Model");
  Object.assign(model, changes);
  return toModelView(ctx.state, model.id) ?? { ...model, categoryName: "" };
}

export const listCategories = (state: DemoState): ProductCategory[] =>
  state.categories.map((c) => ({ id: c.id, name: c.name }));

/** Dealers the caller may see: admin all, distributor its dealers, dealer itself. */
export function listDealers(ctx: Ctx): DealerView[] {
  const ids = visibleDealerIds(ctx.user, ctx.state.dealers);
  return ctx.state.dealers
    .filter((d) => ids === null || ids.includes(d.id))
    .map((d) => ({
      ...d,
      distributorName: ctx.state.distributors.find((x) => x.id === d.distributorId)?.name,
    }));
}

export function orgStructure(ctx: Ctx): OrgStructure {
  requireRole(ctx, "admin");
  const { state } = ctx;
  return {
    distributors: state.distributors.map((d) => ({
      ...d,
      dealers: state.dealers.filter((x) => x.distributorId === d.id),
    })),
    directDealers: state.dealers.filter((d) => !d.distributorId),
    users: state.users.map((u) => ({ ...u, orgName: toSessionUser(state, u).orgName })),
  };
}

// ---- dashboard -----------------------------------------------------------------------------------

const OPEN_CLAIM = CLAIM_STATUSES.filter(isOpenClaim);
const DASHBOARD_CHANNELS: ChannelCount["channel"][] = [
  "DEALER",
  "PORTAL",
  "WEB",
  "EMAIL",
  "ERP",
  "API",
  "RETAIL",
  "OVERWATCH",
  "JOBLINK",
];

function statusCounts(units: readonly UnitView[]): Record<WarrantyStatus, number> {
  const counts = Object.fromEntries(WARRANTY_STATUSES.map((s) => [s, 0])) as Record<WarrantyStatus, number>;
  for (const u of units) counts[u.status] += 1;
  return counts;
}

const byWarrantyStatus = (counts: Record<WarrantyStatus, number>): WarrantyStatusCount[] =>
  WARRANTY_STATUSES.map((status) => ({ status, count: counts[status] }));

/** The last `count` calendar months ("YYYY-MM") up to today's, oldest first. */
function lastMonths(today: IsoDate, count: number): string[] {
  const first = `${today.slice(0, 7)}-01`;
  return Array.from({ length: count }, (_, i) => addMonthsIso(first, i - count + 1).slice(0, 7));
}

/** Dealers in scope: null = all (admin); a distributor may narrow to one of its dealers. */
function scopeDealers(ctx: Ctx, query: RawQuery): string[] | null {
  const { user, state } = ctx;
  if (user.role === "admin") return null;
  const ids = visibleDealerIds(user, state.dealers) ?? [];
  const dealerId = user.role === "distributor" ? queryString(query, "dealerId") : undefined;
  return dealerId ? ids.filter((id) => id === dealerId) : ids;
}

const inDealers = (dealerIds: readonly string[] | null, dealerId: string | undefined) =>
  dealerIds === null || (!!dealerId && dealerIds.includes(dealerId));

/**
 * A01 "Fieldpiece apps": registered products whose registration came from Overwatch or Job Link, one entry per app
 * (zeros allowed). `last30Days`: registered (COALESCE(reviewedAt, submittedAt)) in the 30 days up to today.
 */
function appChannelStats(state: DemoState, units: readonly UnitView[], today: IsoDate): AppChannelStats[] {
  const since = addDaysIso(today, -29);
  return FIELDPIECE_APP_CHANNELS.map((channel) => {
    const fromApp = units.filter((u) => u.warrantyEnd && u.registrationChannel === channel);
    const serials = new Set(fromApp.map((u) => u.serial));
    const registeredAt = (u: UnitView) => {
      const r = state.registrations.find((x) => x.id === u.registrationId);
      return (r?.reviewedAt ?? r?.submittedAt ?? "").slice(0, 10);
    };
    return {
      channel,
      units: fromApp.length,
      active: fromApp.filter((u) => u.status === "ACTIVE").length,
      expiringSoon: fromApp.filter((u) => u.status === "EXPIRING_SOON").length,
      expired: fromApp.filter((u) => u.status === "EXPIRED").length,
      last30Days: fromApp.filter((u) => registeredAt(u) >= since).length,
      claims: state.claims.filter((c) => serials.has(c.unitSerial)).length,
      pendingRegistrations: state.registrations.filter((r) => r.status === "PENDING" && r.channel === channel)
        .length,
    };
  });
}

/** Registrations approved and claims filed per month, the last 12 months (oldest first), for the dealers in scope. */
function monthlyTrend(state: DemoState, today: IsoDate, dealerIds: readonly string[] | null): MonthlyTrend[] {
  const registrations = state.registrations.filter(
    (r) => r.status === "APPROVED" && inDealers(dealerIds, r.dealerId),
  );
  const claims = state.claims.filter((c) => inDealers(dealerIds, c.dealerId));
  return lastMonths(today, 12).map((month) => ({
    month,
    registrations: registrations.filter((r) => (r.reviewedAt ?? r.submittedAt).slice(0, 7) === month).length,
    claims: claims.filter((c) => c.createdAt.slice(0, 7) === month).length,
  }));
}

/** A01 warranty desk, DL01 dealer / distributor, customer home. `dealerId` narrows a distributor's numbers. */
export function dashboardSummary(ctx: Ctx, query: RawQuery = {}): DashboardSummary {
  const { state, user, today } = ctx;
  const units = state.units
    .filter((u) => canSee(user, u, state.dealers))
    .map((u) => toUnitView(state, u, today));
  const counts = statusCounts(units);
  const claims = state.claims.filter((c) => canSee(user, c, state.dealers));

  if (user.role === "admin") {
    const channel = new Map<ChannelCount["channel"], number>(DASHBOARD_CHANNELS.map((c) => [c, 0]));
    for (const r of state.registrations) {
      if (r.status !== "APPROVED") continue;
      // Bulk uploads are dealer registrations.
      const bucket = r.channel === "BULK" ? "DEALER" : r.channel;
      channel.set(bucket, (channel.get(bucket) ?? 0) + 1);
    }
    const byStatus = (s: ClaimStatus) => claims.filter((c) => c.status === s).length;
    const categoryOf = (c: WarrantyClaim) => {
      const unit = state.units.find((u) => u.serial === c.unitSerial);
      return state.models.find((m) => m.id === unit?.modelId)?.categoryId;
    };
    return {
      role: "admin",
      units: units.length,
      active: counts.ACTIVE,
      expiring30: counts.EXPIRING_SOON,
      expired: counts.EXPIRED,
      pending: counts.PENDING,
      voided: counts.VOID,
      openClaims: claims.filter((c) => isOpenClaim(c.status)).length,
      pendingRegistrations: state.registrations.filter((r) => r.status === "PENDING").length,
      registrationsByChannel: DASHBOARD_CHANNELS.map((c) => ({ channel: c, count: channel.get(c) ?? 0 })),
      claimsByStatus: CLAIM_STATUSES.map((status) => ({ status, count: byStatus(status) })),
      claimsByCategory: state.categories.map((c) => ({
        categoryId: c.id,
        categoryName: c.name,
        count: claims.filter((x) => categoryOf(x) === c.id).length,
      })),
      expiringSoon: sortRows(
        units.filter((u) => u.status === "EXPIRING_SOON"),
        undefined,
        { daysRemaining: (u) => u.daysRemaining },
        "daysRemaining",
        (u) => u.serial,
      )
        .slice(0, 5)
        .map((u) => ({
          serial: u.serial,
          modelName: u.modelName,
          customerName: u.customerName,
          dealerName: u.dealerName,
          warrantyEnd: u.warrantyEnd ?? today,
          daysRemaining: u.daysRemaining,
        })),
      // Same instant: keep the order the events were written in (stable sort).
      recentActivity: state.units
        .flatMap((u) => u.history.map((e) => ({ ...e, serial: u.serial })))
        .sort((a, b) => b.at.localeCompare(a.at))
        .slice(0, 8),
      trend: monthlyTrend(state, today, null),
      apps: appChannelStats(state, units, today),
    };
  }

  if (user.role === "customer") {
    return {
      role: "customer",
      units: units.length,
      active: counts.ACTIVE,
      expiringSoon: counts.EXPIRING_SOON,
      openClaims: claims.filter((c) => isOpenClaim(c.status)).length,
      unitsByStatus: byWarrantyStatus(counts),
    };
  }

  // DL01 for a distributor: optionally one of its dealers (scoping still applies first).
  const dealerId = user.role === "distributor" ? queryString(query, "dealerId") : undefined;
  const ids = visibleDealerIds(user, state.dealers) ?? [];
  const visible = dealerId ? ids.filter((id) => id === dealerId) : ids;
  const month = today.slice(0, 7);
  const registrations = state.registrations.filter((r) => !!r.dealerId && visible.includes(r.dealerId));
  const dealerClaims = claims.filter((c) => !dealerId || c.dealerId === dealerId);
  const openClaims = dealerClaims.filter((c) => isOpenClaim(c.status));
  const thisMonth = (r: Registration) => r.submittedAt.slice(0, 7) === month;
  const dealers: DealerStats[] = listDealers(ctx).map((d) => ({
    dealerId: d.id,
    dealerName: d.name,
    registrationsThisMonth: registrations.filter((r) => r.dealerId === d.id && thisMonth(r)).length,
    pending: registrations.filter((r) => r.dealerId === d.id && r.status === "PENDING").length,
    openClaims: openClaims.filter((c) => c.dealerId === d.id).length,
  }));
  return {
    role: user.role,
    registrationsThisMonth: registrations.filter(thisMonth).length,
    pending: registrations.filter((r) => r.status === "PENDING").length,
    rejected: registrations.filter((r) => r.status === "REJECTED").length,
    openClaims: openClaims.length,
    dealers,
    unitsByStatus: byWarrantyStatus(statusCounts(units.filter((u) => !dealerId || u.dealerId === dealerId))),
    claimsByStatus: CLAIM_STATUSES.map((status) => ({
      status,
      count: dealerClaims.filter((c) => c.status === status).length,
    })),
    trend: monthlyTrend(state, today, visible),
  };
}

/**
 * Warranty cost against budget over the rolling 12 months up to today (finance insights). Cost counts approved and
 * closed claims filed in the period; extension revenue counts extended warranties sold in the period. Dealers and
 * distributors see their dealers' figures; `dealerId` narrows a distributor's to one dealer.
 */
export function financeSummary(ctx: Ctx, query: RawQuery = {}): FinanceSummary {
  requireRole(ctx, "admin", "dealer", "distributor");
  const { state, today } = ctx;
  const dealerIds = scopeDealers(ctx, query);
  const periodStart = addDaysIso(addMonthsIso(today, -12), 1);
  const inPeriod = (at: string) => at.slice(0, 10) >= periodStart && at.slice(0, 10) <= today;
  const modelOf = (serial: string) => {
    const unit = state.units.find((u) => u.serial === serial);
    return state.models.find((m) => m.id === unit?.modelId);
  };

  const claims = state.claims.filter((c) => inDealers(dealerIds, c.dealerId) && inPeriod(c.createdAt));
  const settled = claims.flatMap((c) => {
    const model = modelOf(c.unitSerial);
    if ((c.status !== "APPROVED" && c.status !== "CLOSED") || !c.resolution || !model) return [];
    return [
      {
        modelId: model.id,
        categoryId: model.categoryId,
        resolution: c.resolution,
        month: c.createdAt.slice(0, 7),
        cost: claimCost(c.resolution, model, c.creditAmount),
      },
    ];
  });
  const extensions = state.units
    .flatMap((u) => u.extensions ?? [])
    .filter((e) => inDealers(dealerIds, e.dealerId) && inPeriod(e.at));
  const registered = state.units.filter((u) => !!u.warrantyEnd && inDealers(dealerIds, u.dealerId));

  const total = (rows: { cost: number }[]) => roundMoney(rows.reduce((n, r) => n + r.cost, 0));
  const revenue = (rows: { price: number }[]) => roundMoney(rows.reduce((n, r) => n + r.price, 0));
  const warrantyCost = total(settled);
  const extensionRevenue = revenue(extensions);
  const models = listModels(state, true).map((m) => ({
    ...m,
    warrantyBudget: m.warrantyBudget ?? 0,
    claimQuota: m.claimQuota ?? 0,
  }));
  const budget = roundMoney(
    models
      .filter((m) => registered.some((u) => u.modelId === m.id))
      .reduce((n, m) => n + m.warrantyBudget, 0),
  );
  const quotas: ModelQuota[] = models.flatMap((m) => {
    const units = registered.filter((u) => u.modelId === m.id).length;
    const spent = total(settled.filter((c) => c.modelId === m.id));
    const claimCount = claims.filter((c) => modelOf(c.unitSerial)?.id === m.id).length;
    if (!units && !spent && !claimCount) return [];
    return [
      {
        modelId: m.id,
        modelCode: m.code,
        modelName: m.name,
        categoryName: m.categoryName,
        imageUrl: m.imageUrl,
        units,
        budget: m.warrantyBudget,
        spent,
        budgetUsedPct: percent(spent, m.warrantyBudget),
        claimQuota: m.claimQuota,
        claims: claimCount,
        claimQuotaUsedPct: percent(claimCount, m.claimQuota),
      },
    ];
  });
  quotas.sort(
    (a, b) =>
      b.budgetUsedPct - a.budgetUsedPct || b.claims - a.claims || a.modelCode.localeCompare(b.modelCode),
  );

  return {
    currency: "USD",
    periodStart,
    periodEnd: today,
    warrantyCost,
    creditsIssued: total(settled.filter((c) => c.resolution === "CREDIT")),
    extensionRevenue,
    extensionsSold: extensions.length,
    netWarrantyCost: roundMoney(warrantyCost - extensionRevenue),
    budget,
    budgetUsedPct: percent(warrantyCost, budget),
    averageClaimCost: settled.length ? roundMoney(warrantyCost / settled.length) : 0,
    costByResolution: RESOLUTIONS.map((resolution) => {
      const rows = settled.filter((c) => c.resolution === resolution);
      return { resolution, amount: total(rows), count: rows.length };
    }),
    costByCategory: state.categories.map((c) => ({
      categoryId: c.id,
      categoryName: c.name,
      amount: total(settled.filter((s) => s.categoryId === c.id)),
    })),
    monthly: lastMonths(today, 12).map((month) => ({
      month,
      cost: total(settled.filter((c) => c.month === month)),
      extensionRevenue: revenue(extensions.filter((e) => e.at.slice(0, 7) === month)),
    })),
    quotas,
  };
}

/** Claim counts by status in the caller's scope (count tiles). */
export function claimCounts(ctx: Ctx): Record<ClaimStatus, number> {
  const counts = Object.fromEntries(CLAIM_STATUSES.map((s) => [s, 0])) as Record<ClaimStatus, number>;
  for (const c of ctx.state.claims) if (canSee(ctx.user, c, ctx.state.dealers)) counts[c.status] += 1;
  return counts;
}

export const openClaimStatuses = OPEN_CLAIM;

// ---- notifications -------------------------------------------------------------------------------

/** The caller's latest 30 notifications, newest first (same instant: in the order they were written). */
export const listNotifications = (ctx: Ctx): Notification[] =>
  sortRows(
    ctx.state.notifications.filter((n) => n.userId === ctx.user.id),
    undefined,
    { createdAt: (n) => n.createdAt },
    "-createdAt",
    (n) => idOrder(n.id),
  ).slice(0, 30);

/** No ids = all of the caller's notifications. */
export function markNotificationsRead(ctx: Ctx, rawIds: unknown): void {
  const ids = Array.isArray(rawIds) ? rawIds.filter((id): id is string => typeof id === "string") : undefined;
  for (const n of ctx.state.notifications) {
    if (n.userId === ctx.user.id && (!ids || ids.includes(n.id))) n.read = true;
  }
}

/** In-app notifications. Only real users get them (submitters like "system" or "public" aren't logins). */
export function notify(
  state: DemoState,
  userIds: readonly string[],
  key: string,
  now: string,
  extra: Pick<Notification, "params" | "link"> = {},
) {
  for (const userId of new Set(userIds)) {
    if (!state.users.some((u) => u.id === userId)) continue;
    state.notifications.push({
      id: nextId(state, "NTF"),
      userId,
      key,
      ...extra,
      createdAt: now,
      read: false,
    });
  }
}

export const adminIds = (state: DemoState) => state.users.filter((u) => u.role === "admin").map((u) => u.id);

/** Users who follow a record: its customer and, unless excluded, the selling dealer and that dealer's distributor. */
export function followers(state: DemoState, record: Scoped, { includeDealer = true } = {}): string[] {
  const dealer = includeDealer ? state.dealers.find((d) => d.id === record.dealerId) : undefined;
  return state.users
    .filter(
      (u) =>
        (!!record.customerId && u.customerId === record.customerId) ||
        (!!dealer && u.dealerId === dealer.id) ||
        (!!dealer?.distributorId && u.distributorId === dealer.distributorId),
    )
    .map((u) => u.id);
}

// ---- integration log -----------------------------------------------------------------------------

export interface LogEntry {
  system: IntegrationSystem;
  direction: IntegrationDirection;
  type: string;
  payload: unknown;
  refId?: string;
  status?: IntegrationStatus;
  lastError?: string;
}

/**
 * Records a message in the integration log (A12). Outbound messages are recorded as delivered, as the backend does
 * while no external system is connected.
 */
export function logMessage(ctx: Pick<SystemCtx, "state" | "now">, entry: LogEntry): IntegrationMessage {
  const message: IntegrationMessage = {
    id: nextId(ctx.state, "MSG"),
    system: entry.system,
    direction: entry.direction,
    type: entry.type,
    status: entry.status ?? "SUCCESS",
    // JSON-safe copy (drops undefined), like the backend's jsonb column.
    payload: JSON.parse(JSON.stringify(entry.payload ?? {})) as unknown,
    attempts: 1,
    lastError: entry.lastError,
    refId: entry.refId,
    createdAt: ctx.now,
    updatedAt: ctx.now,
  };
  ctx.state.integrations.push(message);
  return message;
}

const INTEGRATION_SORTS: SortKeys<IntegrationMessage> = {
  id: (m) => idOrder(m.id),
  system: (m) => m.system,
  direction: (m) => m.direction,
  type: (m) => m.type,
  status: (m) => m.status,
  attempts: (m) => m.attempts,
  refId: (m) => m.refId,
  createdAt: (m) => m.createdAt,
  updatedAt: (m) => m.updatedAt,
};

export function listIntegrations(ctx: Ctx, query: RawQuery = {}): Paginated<IntegrationMessage> {
  requireRole(ctx, "admin");
  const list = listQuery(query);
  const system = queryEnum(query, "system", INTEGRATION_SYSTEMS);
  const direction = queryEnum<IntegrationDirection>(query, "direction", ["IN", "OUT"]);
  const status = queryEnum(query, "status", INTEGRATION_STATUSES);
  const rows = ctx.state.integrations.filter(
    (m) =>
      (!system || m.system === system) &&
      (!direction || m.direction === direction) &&
      (!status || m.status === status) &&
      matches(list.q, m.id, m.type, m.refId),
  );
  return paginate(
    sortRows(rows, list.sort, INTEGRATION_SORTS, "-createdAt", (m) => idOrder(m.id)),
    list,
  );
}

/** Sends a FAILED message again (attempts + 1). With no external system connected, a retry is recorded as delivered. */
export function retryIntegration(ctx: Ctx, id: string): IntegrationMessage {
  requireRole(ctx, "admin");
  const message = ctx.state.integrations.find((m) => m.id === id);
  if (!message) throw notFound("Message");
  if (message.status !== "FAILED") throw conflict("not_failed", "Only failed messages can be retried.");
  message.status = "SUCCESS";
  message.attempts += 1;
  delete message.lastError;
  message.updatedAt = ctx.now;
  return message;
}

// ---- files ---------------------------------------------------------------------------------------

/** Photos, videos and PDFs. SVG is refused: it can carry script. */
export const ALLOWED_UPLOAD_TYPES = /^(image\/|video\/|application\/pdf$)/;
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

/**
 * Photos, videos and PDFs only, within the size limit. Used for every file that comes in, signed in or not. The
 * backend also checks that the bytes look like the declared type; the mock doesn't (tests upload stand-in bytes).
 */
export function checkFile(file: DemoFile | undefined, name?: string): DemoFile {
  if (!file || !file.size) throw validation("Choose a file to upload.");
  const mime = file.mime.toLowerCase();
  if (!ALLOWED_UPLOAD_TYPES.test(mime) || mime === "image/svg+xml") {
    throw new ServiceError(415, "unsupported_type", "Upload a photo, video or PDF.");
  }
  if (file.size > MAX_UPLOAD_BYTES) throw new ServiceError(413, "too_large", "Files can be up to 15 MB.");
  return { ...file, name: (name?.trim() || file.name || "upload").slice(0, 255), mime };
}

/** Records a checked file and hands its bytes to the adapter's store. */
export function storeFile(ctx: SystemCtx, file: DemoFile, uploadedBy: string): Attachment {
  const id = nextId(ctx.state, "ATT");
  const attachment: Attachment = {
    id,
    name: file.name,
    mime: file.mime,
    size: file.size,
    url: ctx.files.url(id),
    uploadedBy,
    createdAt: ctx.now,
  };
  ctx.state.attachments.push(attachment);
  if (file.data !== undefined) ctx.files.save(attachment, file.data);
  return attachment;
}

/** POST /uploads: checks type and size, stores the file, records the attachment. */
export const addAttachment = (ctx: Ctx, file: DemoFile | undefined, name?: string): Attachment =>
  storeFile(ctx, checkFile(file, name), ctx.user.id);

/** GET /files/:id: the uploader, admins, or anyone who can see a record that references the file. */
export function getAttachment(ctx: Ctx, id: string): Attachment {
  const { state, user } = ctx;
  const attachment = state.attachments.find((a) => a.id === id);
  if (!attachment) throw notFound("File");
  const uses = (row: Scoped & { attachmentIds: string[] }) =>
    row.attachmentIds.includes(id) && canSee(user, row, state.dealers);
  const visible =
    user.role === "admin" ||
    attachment.uploadedBy === user.id ||
    state.registrations.some(uses) ||
    state.claims.some(uses) ||
    state.units.some(uses);
  if (!visible) throw notFound("File");
  return attachment;
}

/** Only files the caller uploaded (or any, for admins) can be linked to a new record. */
export function assertOwnAttachments(ctx: Ctx, ids: readonly string[] = []) {
  for (const id of ids) {
    const a = ctx.state.attachments.find((x) => x.id === id);
    if (!a || (a.uploadedBy !== ctx.user.id && ctx.user.role !== "admin")) {
      throw new ServiceError(
        422,
        "invalid_attachment",
        "One of the files couldn't be found. Upload it again.",
      );
    }
  }
}

/** Up to `max` string ids from a request body. */
export const idList = (value: unknown, max = 20): string[] | undefined =>
  Array.isArray(value) ? value.filter((id): id is string => typeof id === "string").slice(0, max) : undefined;

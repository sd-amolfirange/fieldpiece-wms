import {
  isOpenClaim,
  partWarranty,
  unitWarranty,
  type Attachment,
  type BrandCount,
  type ChannelCount,
  type Claim,
  type ClaimStatus,
  type ClaimView,
  type Complaint,
  type ComplaintSource,
  type ComplaintStatus,
  type ComplaintView,
  type DashboardSummary,
  type DealerStats,
  type DealerView,
  type IntegrationMessage,
  type IsoDate,
  type ModelView,
  type Notification,
  type OrgStructure,
  type Paginated,
  type Registration,
  type RegistrationChannel,
  type RegistrationFlag,
  type RegistrationStatus,
  type RegistrationView,
  type Role,
  type SessionUser,
  type Unit,
  type UnitView,
  type User,
  type WarrantyStatus,
} from "@wms/domain";
import { canSee, canSeeClaim, visibleDealerIds } from "./scope";
import { DEMO_PASSWORD } from "./seed";
import { nextId, type DemoState } from "./state";

// Scoped read services behind every demo endpoint (server-side only). The Express adapter (and the
// frontend's test-only MSW adapter) only parse the request, call one of these and serialise the result.

export class ServiceError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fieldErrors?: Record<string, string>,
  ) {
    super(message);
  }
}

export interface Ctx {
  state: DemoState;
  user: User;
  today: IsoDate;
  /** ISO timestamp for records written now. */
  now: string;
}

export interface ListQuery {
  page?: number;
  pageSize?: number;
  sort?: string;
  q?: string;
}

// ---- helpers -------------------------------------------------------------------------------------

export function requireRole(ctx: Ctx, ...roles: Role[]) {
  if (!roles.includes(ctx.user.role)) {
    throw new ServiceError(403, "forbidden", "You don't have access to this.");
  }
}

export const notFound = (what: string) =>
  new ServiceError(404, "not_found", `${what} not found.`);

export function paginate<T>(
  items: T[],
  { page = 1, pageSize = 25 }: ListQuery,
): Paginated<T> {
  const size = Math.min(100, Math.max(1, pageSize));
  const current = Math.max(1, page);
  return {
    items: items.slice((current - 1) * size, current * size),
    total: items.length,
    page: current,
    pageSize: size,
  };
}

export function sortRows<T>(
  items: T[],
  sort: string | undefined,
  fallback: string,
): T[] {
  const spec = sort || fallback;
  const desc = spec.startsWith("-");
  const key = spec.replace(/^-/, "") as keyof T;
  return [...items].sort((a, b) => {
    const av = a[key];
    const bv = b[key];
    const cmp =
      typeof av === "number" && typeof bv === "number"
        ? av - bv
        : String(av ?? "").localeCompare(String(bv ?? ""));
    return desc ? -cmp : cmp;
  });
}

export const matches = (
  q: string | undefined,
  ...values: (string | undefined)[]
) => {
  if (!q) return true;
  const needle = q.trim().toLowerCase();
  return values.some((v) => v?.toLowerCase().includes(needle));
};

export const dealerName = (state: DemoState, id?: string) =>
  state.dealers.find((d) => d.id === id)?.name;
const customerName = (state: DemoState, id?: string) =>
  state.customers.find((c) => c.id === id)?.name;
const brandName = (state: DemoState, id: string) =>
  state.brands.find((b) => b.id === id)?.name ?? id;

// ---- auth ----------------------------------------------------------------------------------------

export function authenticate(
  state: DemoState,
  email: string,
  password: string,
): User {
  const user = state.users.find(
    (u) => u.email.toLowerCase() === email.trim().toLowerCase(),
  );
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
  const orgName =
    dealerName(state, user.dealerId) ??
    state.distributors.find((d) => d.id === user.distributorId)?.name ??
    customerName(state, user.customerId);
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    dealerId: user.dealerId,
    distributorId: user.distributorId,
    customerId: user.customerId,
    orgName,
    currency: "INR",
  };
}

// ---- views ---------------------------------------------------------------------------------------

export function toUnitView(
  state: DemoState,
  unit: Unit,
  today: IsoDate,
): UnitView {
  const model = state.models.find((m) => m.id === unit.modelId);
  const overall = unitWarranty(unit, today);
  return {
    ...unit,
    modelCode: model?.code ?? unit.modelId,
    modelName: model?.name ?? "",
    capacity: model?.capacity ?? "",
    unitType: model?.type ?? "",
    brandName: brandName(state, unit.brandId),
    dealerName: dealerName(state, unit.dealerId),
    customerName: customerName(state, unit.customerId),
    status: overall.status,
    daysRemaining: overall.daysRemaining,
    parts: unit.parts.map((part) => ({
      ...part,
      ...partWarranty(part, today, { voided: !!unit.void }),
    })),
  };
}

export function findUnit(ctx: Ctx, serial: string): Unit {
  const unit = ctx.state.units.find((u) => u.serial === serial.toUpperCase());
  if (!unit || !canSee(ctx.user, unit, ctx.state.dealers))
    throw notFound("Unit");
  return unit;
}

// ---- units ---------------------------------------------------------------------------------------

export function listUnits(
  ctx: Ctx,
  query: ListQuery & { status?: WarrantyStatus; dealerId?: string } = {},
): Paginated<UnitView> {
  const rows = ctx.state.units
    .filter((u) => canSee(ctx.user, u, ctx.state.dealers))
    .map((u) => toUnitView(ctx.state, u, ctx.today))
    .filter(
      (u) =>
        (!query.status || u.status === query.status) &&
        (!query.dealerId || u.dealerId === query.dealerId) &&
        matches(query.q, u.serial, u.customerName, u.dealerName, u.modelCode),
    );
  return paginate(sortRows(rows, query.sort, "serial"), query);
}

export const getUnit = (ctx: Ctx, serial: string): UnitView =>
  toUnitView(ctx.state, findUnit(ctx, serial), ctx.today);

// ---- registrations -------------------------------------------------------------------------------

function toRegistrationView(ctx: Ctx, r: Registration): RegistrationView {
  const duplicate = r.duplicateOfSerial
    ? ctx.state.units.find((u) => u.serial === r.duplicateOfSerial)
    : undefined;
  return {
    ...r,
    dealerName: dealerName(ctx.state, r.dealerId),
    duplicateOf:
      duplicate && ctx.user.role === "admin"
        ? toUnitView(ctx.state, duplicate, ctx.today)
        : undefined,
  };
}

export function listRegistrations(
  ctx: Ctx,
  query: ListQuery & {
    status?: RegistrationStatus;
    channel?: RegistrationChannel;
    flag?: RegistrationFlag;
  } = {},
): Paginated<RegistrationView> {
  const rows = ctx.state.registrations.filter(
    (r) =>
      canSee(ctx.user, r, ctx.state.dealers) &&
      (!query.status || r.status === query.status) &&
      (!query.channel || r.channel === query.channel) &&
      (!query.flag || r.flags.includes(query.flag)) &&
      matches(
        query.q,
        r.serial,
        r.customer.name,
        r.modelCode,
        dealerName(ctx.state, r.dealerId),
      ),
  );
  return paginate(
    sortRows(rows, query.sort, "-submittedAt").map((r) =>
      toRegistrationView(ctx, r),
    ),
    query,
  );
}

export function getRegistration(ctx: Ctx, id: string): RegistrationView {
  const r = ctx.state.registrations.find((x) => x.id === id);
  if (!r || !canSee(ctx.user, r, ctx.state.dealers))
    throw notFound("Registration");
  return toRegistrationView(ctx, r);
}

// ---- complaints ----------------------------------------------------------------------------------

function toComplaintView(ctx: Ctx, c: Complaint): ComplaintView {
  const unit = ctx.state.units.find((u) => u.serial === c.unitSerial);
  const model = ctx.state.models.find((m) => m.id === unit?.modelId);
  const claim = ctx.state.claims.find((x) => x.id === c.claimId);
  return {
    ...c,
    modelCode: model?.code ?? "",
    brandName: unit ? brandName(ctx.state, unit.brandId) : "",
    dealerName: dealerName(ctx.state, c.dealerId),
    customerName: customerName(ctx.state, c.customerId),
    jobResult: ctx.state.jobResults.find((j) => j.id === c.jobResultId),
    claimStatus:
      claim && canSeeClaim(ctx.user, claim, ctx.state.dealers)
        ? claim.status
        : undefined,
  };
}

export function listComplaints(
  ctx: Ctx,
  query: ListQuery & {
    status?: ComplaintStatus;
    source?: ComplaintSource;
  } = {},
): Paginated<ComplaintView> {
  const rows = ctx.state.complaints
    .filter(
      (c) =>
        canSee(ctx.user, c, ctx.state.dealers) &&
        (!query.status || c.status === query.status) &&
        (!query.source || c.source === query.source),
    )
    .map((c) => toComplaintView(ctx, c))
    .filter((c) =>
      matches(query.q, c.id, c.unitSerial, c.customerName, c.dealerName),
    );
  return paginate(sortRows(rows, query.sort, "-createdAt"), query);
}

export function getComplaint(ctx: Ctx, id: string): ComplaintView {
  const c = ctx.state.complaints.find((x) => x.id === id);
  if (!c || !canSee(ctx.user, c, ctx.state.dealers))
    throw notFound("Complaint");
  return toComplaintView(ctx, c);
}

// ---- claims --------------------------------------------------------------------------------------

function toClaimView(ctx: Ctx, c: Claim): ClaimView {
  const unit = ctx.state.units.find((u) => u.serial === c.unitSerial);
  return {
    ...c,
    brandName: brandName(ctx.state, c.brandId),
    dealerName: dealerName(ctx.state, c.dealerId),
    modelCode: ctx.state.models.find((m) => m.id === unit?.modelId)?.code ?? "",
  };
}

export function listClaims(
  ctx: Ctx,
  query: ListQuery & { status?: ClaimStatus; brandId?: string } = {},
): Paginated<ClaimView> {
  const rows = ctx.state.claims
    .filter(
      (c) =>
        canSeeClaim(ctx.user, c, ctx.state.dealers) &&
        (!query.status || c.status === query.status) &&
        (!query.brandId || c.brandId === query.brandId),
    )
    .map((c) => toClaimView(ctx, c))
    .filter((c) =>
      matches(query.q, c.id, c.unitSerial, c.rmaNumber, c.brandName),
    );
  return paginate(sortRows(rows, query.sort, "-createdAt"), query);
}

export function getClaim(ctx: Ctx, id: string): ClaimView {
  const c = ctx.state.claims.find((x) => x.id === id);
  if (!c || !canSeeClaim(ctx.user, c, ctx.state.dealers))
    throw notFound("Claim");
  return toClaimView(ctx, c);
}

export function claimCounts(ctx: Ctx): Record<ClaimStatus, number> {
  const counts: Record<ClaimStatus, number> = {
    DRAFT: 0,
    SUBMITTED: 0,
    APPROVED: 0,
    PAID: 0,
    REJECTED: 0,
  };
  for (const c of ctx.state.claims)
    if (canSeeClaim(ctx.user, c, ctx.state.dealers)) counts[c.status] += 1;
  return counts;
}

// ---- master data ---------------------------------------------------------------------------------

export const listModels = (ctx: Ctx): ModelView[] =>
  ctx.state.models.map((m) => ({
    ...m,
    brandName: brandName(ctx.state, m.brandId),
  }));

export const listBrands = (ctx: Ctx) => ctx.state.brands;

export function listDealers(ctx: Ctx): DealerView[] {
  const ids = visibleDealerIds(ctx.user, ctx.state.dealers);
  return ctx.state.dealers
    .filter((d) => ids === null || ids.includes(d.id))
    .map((d) => ({
      ...d,
      distributorName: ctx.state.distributors.find(
        (x) => x.id === d.distributorId,
      )?.name,
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
    users: state.users.map((u) => ({
      ...u,
      orgName: toSessionUser(state, u).orgName,
    })),
  };
}

// ---- dashboard -----------------------------------------------------------------------------------

const DASHBOARD_CHANNELS: ChannelCount["channel"][] = [
  "DEALER",
  "PORTAL",
  "EMAIL",
  "ERP",
];

export function dashboardSummary(ctx: Ctx): DashboardSummary {
  const { state, user, today } = ctx;
  const month = today.slice(0, 7);
  const units = state.units
    .filter((u) => canSee(user, u, state.dealers))
    .map((u) => toUnitView(state, u, today));
  const complaints = state.complaints.filter((c) =>
    canSee(user, c, state.dealers),
  );
  const claims = state.claims.filter((c) =>
    canSeeClaim(user, c, state.dealers),
  );
  const registrations = state.registrations.filter((r) =>
    canSee(user, r, state.dealers),
  );
  const countStatus = (s: WarrantyStatus) =>
    units.filter((u) => u.status === s).length;

  if (user.role === "admin") {
    const channel = new Map<ChannelCount["channel"], number>(
      DASHBOARD_CHANNELS.map((c) => [c, 0]),
    );
    for (const r of registrations) {
      if (r.status !== "APPROVED") continue;
      const bucket = r.channel === "BULK" ? "DEALER" : r.channel;
      channel.set(bucket, (channel.get(bucket) ?? 0) + 1);
    }
    const byBrand: BrandCount[] = state.brands.map((b) => ({
      brandId: b.id,
      brandName: b.name,
      count: claims.filter((c) => c.brandId === b.id).length,
    }));
    return {
      role: "admin",
      units: units.length,
      active: countStatus("ACTIVE"),
      expiring30: countStatus("EXPIRING_SOON"),
      expired: countStatus("EXPIRED"),
      pending: countStatus("PENDING"),
      voided: countStatus("VOID"),
      openClaims: claims.filter((c) => isOpenClaim(c.status)).length,
      registrationsByChannel: DASHBOARD_CHANNELS.map((c) => ({
        channel: c,
        count: channel.get(c) ?? 0,
      })),
      claimsByBrand: byBrand,
    };
  }

  if (user.role === "customer") {
    return {
      role: "customer",
      units: units.length,
      active: countStatus("ACTIVE"),
      expiringSoon: countStatus("EXPIRING_SOON"),
      openComplaints: complaints.filter((c) => c.status !== "RESOLVED").length,
    };
  }

  const thisMonth = (r: Registration) => r.submittedAt.slice(0, 7) === month;
  const dealers: DealerStats[] = listDealers(ctx).map((d) => ({
    dealerId: d.id,
    dealerName: d.name,
    registrationsThisMonth: registrations.filter(
      (r) => r.dealerId === d.id && thisMonth(r),
    ).length,
    pending: registrations.filter(
      (r) => r.dealerId === d.id && r.status === "PENDING",
    ).length,
    openComplaints: complaints.filter(
      (c) => c.dealerId === d.id && c.status !== "RESOLVED",
    ).length,
  }));
  return {
    role: user.role,
    registrationsThisMonth: registrations.filter(thisMonth).length,
    pending: registrations.filter((r) => r.status === "PENDING").length,
    rejected: registrations.filter((r) => r.status === "REJECTED").length,
    openComplaints: complaints.filter((c) => c.status !== "RESOLVED").length,
    claimsInProgress: claims.filter((c) => isOpenClaim(c.status)).length,
    dealers,
  };
}

// ---- notifications -------------------------------------------------------------------------------

export const listNotifications = (ctx: Ctx): Notification[] =>
  sortRows(
    ctx.state.notifications.filter((n) => n.userId === ctx.user.id),
    undefined,
    "-createdAt",
  ).slice(0, 30);

export function markNotificationsRead(ctx: Ctx, ids?: string[]): void {
  for (const n of ctx.state.notifications) {
    if (n.userId === ctx.user.id && (!ids || ids.includes(n.id))) n.read = true;
  }
}

export function notify(
  state: DemoState,
  userIds: string[],
  key: string,
  now: string,
  extra: Partial<Notification> = {},
) {
  for (const userId of new Set(userIds)) {
    state.notifications.push({
      id: nextId(state, "NTF"),
      userId,
      key,
      createdAt: now,
      read: false,
      ...extra,
    });
  }
}

// ---- integration log -----------------------------------------------------------------------------

export function listIntegrations(
  ctx: Ctx,
  query: ListQuery & {
    system?: string;
    direction?: string;
    status?: string;
  } = {},
) {
  requireRole(ctx, "admin");
  const rows = ctx.state.integrations.filter(
    (m) =>
      (!query.system || m.system === query.system) &&
      (!query.direction || m.direction === query.direction) &&
      (!query.status || m.status === query.status) &&
      matches(query.q, m.id, m.type, m.refId),
  );
  return paginate(
    sortRows<IntegrationMessage>(rows, query.sort, "-createdAt"),
    query,
  );
}

// ---- attachments ---------------------------------------------------------------------------------

export const ALLOWED_UPLOAD_TYPES = /^(image\/|video\/|application\/pdf$)/;
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

export function addAttachment(
  ctx: Ctx,
  file: { name: string; mime: string; size: number },
  urlFor: (id: string) => string,
): Attachment {
  if (!ALLOWED_UPLOAD_TYPES.test(file.mime)) {
    throw new ServiceError(
      415,
      "unsupported_type",
      "Upload a photo, video or PDF.",
    );
  }
  if (file.size > MAX_UPLOAD_BYTES)
    throw new ServiceError(413, "too_large", "Files can be up to 15 MB.");
  const id = nextId(ctx.state, "ATT");
  const attachment: Attachment = {
    id,
    name: file.name,
    mime: file.mime,
    size: file.size,
    url: urlFor(id),
    uploadedBy: ctx.user.id,
    createdAt: ctx.now,
  };
  ctx.state.attachments.push(attachment);
  return attachment;
}

/** Uploader, admin, or anyone who can see a record that references the file. */
export function getAttachment(ctx: Ctx, id: string): Attachment {
  const { state, user } = ctx;
  const attachment = state.attachments.find((a) => a.id === id);
  if (!attachment) throw notFound("File");
  const referencedBy = (ids: string[]) => ids.includes(id);
  const visible =
    user.role === "admin" ||
    attachment.uploadedBy === user.id ||
    state.registrations.some(
      (r) => referencedBy(r.attachmentIds) && canSee(user, r, state.dealers),
    ) ||
    state.complaints.some(
      (c) => referencedBy(c.attachmentIds) && canSee(user, c, state.dealers),
    ) ||
    state.units.some(
      (u) => referencedBy(u.attachmentIds) && canSee(user, u, state.dealers),
    ) ||
    state.jobResults.some((j) => {
      const complaint = state.complaints.find((c) => c.id === j.complaintId);
      return (
        referencedBy(j.photoIds) &&
        !!complaint &&
        canSee(user, complaint, state.dealers)
      );
    });
  if (!visible) throw notFound("File");
  return attachment;
}

/** Only attachments the caller uploaded can be linked to a new record. */
export function assertOwnAttachments(ctx: Ctx, ids: string[] = []) {
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

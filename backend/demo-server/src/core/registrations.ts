import {
  bulkCounts,
  hasErrors,
  isIsoDate,
  modelFormat,
  needsAdminReview,
  normalizeBatchValue,
  normalizeSerialValue,
  REGISTRATION_CHANNELS,
  REGISTRATION_FLAGS,
  REGISTRATION_STATUSES,
  SERIAL_PATTERN,
  validateRegistrationRow,
  warrantyFromPurchase,
  type BulkImport,
  type BulkImportView,
  type BulkRowStatus,
  type IsoDate,
  type Paginated,
  type Registration,
  type RegistrationChannel,
  type RegistrationCustomer,
  type RegistrationFlag,
  type RegistrationRowInput,
  type RegistrationView,
  type RowContext,
  type RowErrors,
  type Unit,
} from "@wms/domain";
import { conflict, notFound, ServiceError, throwIfErrors, validation } from "./errors";
import { canSee, dealerIdFor, visibleDealerIds } from "./scope";
import {
  addUnitEvent,
  adminIds,
  assertOwnAttachments,
  dealerName,
  followers,
  idList,
  idOrder,
  listQuery,
  logMessage,
  matches,
  notify,
  paginate,
  queryEnum,
  requireRole,
  sortRows,
  toRegistrationView,
  transaction,
  type Ctx,
  type RawQuery,
  type SortKeys,
  type SystemCtx,
} from "./services";
import { nextId, type DemoState } from "./state";

// Registration rules (same as backend/src/modules/registrations). Every entry point comes through here:
// - trusted senders (dealer form DEALER, bulk file BULK, partner API API / RETAIL / ERP): each row is checked against
//   the catalogue (model, serial and batch format, purchase date); clean rows are approved at once, a serial that's
//   already registered goes to admin review, anything else is returned as field errors;
// - customer-facing channels (signed-in customer PORTAL, public web form WEB, emailed invoices EMAIL, ERP invoices):
//   always Pending for the warranty desk, flagged when the serial is unknown, already registered or the model differs.
// Approval creates or completes the product with its warranty: from the purchase date, for the model's term.

/** Who a registration is written by: a signed-in user, "system" for ERP / email intake, "partner:<id>" for the API. */
export interface Submitter {
  id: string;
  name: string;
}

export interface NewRegistration {
  serial: string;
  batchNumber?: string;
  modelCode: string;
  customer: RegistrationCustomer;
  customerId?: string;
  dealerId?: string;
  purchaseDate?: IsoDate;
  invoiceNumber?: string;
  placeOfPurchase?: string;
  attachmentIds?: string[];
  duplicateOfSerial?: string;
  importId?: string;
}

/** Outcome of a trusted registration (dealer form, bulk row, partner API item). */
export type TrustedResult =
  | { status: "REGISTERED"; registrationId: string }
  | { status: "REVIEW"; registrationId: string; errors: RowErrors }
  | { status: "ERROR"; errors: RowErrors };

export interface CreateRegistrationBody extends RegistrationRowInput {
  placeOfPurchase?: string;
  dealerId?: string;
  attachmentIds?: string[];
}

type WriteCtx = Pick<SystemCtx, "state" | "today" | "now">;

// ---- input ---------------------------------------------------------------------------------------

const ROW_FIELDS = [
  "serial",
  "batchNumber",
  "modelCode",
  "purchaseDate",
  "customerName",
  "customerPhone",
  "customerEmail",
  "city",
  "state",
  "zip",
  "invoiceNumber",
] as const satisfies readonly (keyof RegistrationRowInput)[];

const text = (value: unknown, max = 200): string | undefined =>
  typeof value === "string" ? value.slice(0, max) : typeof value === "number" ? String(value) : undefined;

/** Keeps only the known row fields, as strings. Anything else in the body is ignored. */
export function rowInput(body: unknown): RegistrationRowInput {
  const source = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const row: RegistrationRowInput = {};
  for (const field of ROW_FIELDS) {
    const value = text(source[field]);
    if (value !== undefined) row[field] = value;
  }
  return row;
}

function createBody(body: unknown): CreateRegistrationBody {
  const source = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  return {
    ...rowInput(source),
    placeOfPurchase: text(source.placeOfPurchase, 200),
    dealerId: text(source.dealerId, 100),
    attachmentIds: idList(source.attachmentIds),
  };
}

/** A row's values as registration fields (serial and batch normalised, blanks dropped). */
export const rowToFields = (values: RegistrationRowInput) => ({
  serial: normalizeSerialValue(values.serial),
  batchNumber: normalizeBatchValue(values.batchNumber) || undefined,
  modelCode: (values.modelCode ?? "").trim().toUpperCase(),
  customer: {
    name: (values.customerName ?? "").trim(),
    phone: values.customerPhone?.trim() || undefined,
    email: values.customerEmail?.trim() || undefined,
    city: values.city?.trim() || undefined,
    state: values.state?.trim().toUpperCase() || undefined,
    zip: values.zip?.trim() || undefined,
  } satisfies RegistrationCustomer,
  purchaseDate: values.purchaseDate?.trim() || undefined,
  invoiceNumber: values.invoiceNumber?.trim() || undefined,
});

/** Row errors as form field errors: i18n keys under `rowErrors.`. */
const rowFieldErrors = (errors: RowErrors): Record<string, string> =>
  Object.fromEntries(Object.entries(errors).map(([field, code]) => [field, `rowErrors.${code}`]));

/** Matching keys for customers: the last 10 digits of the phone, and the lower-cased email. */
const phoneKey = (phone: string | undefined) => (phone ?? "").replace(/\D/g, "").slice(-10) || undefined;
const emailKey = (email: string | undefined) => email?.trim().toLowerCase() || undefined;

/** US ZIP (5 digits, optional +4) and two-letter state code. */
const isUsZip = (zip: string | undefined) => !zip || /^\d{5}(-\d{4})?$/.test(zip);
const isUsState = (state: string | undefined) => !state || /^[A-Z]{2}$/.test(state);

const duplicateSerial = () =>
  conflict("duplicate_serial", "This serial is already registered. Merge or reject the registration.");

/** Channels whose approval updates the customer record in CRM (registrations that didn't come through a dealer). */
const CRM_CHANNELS: ReadonlySet<string> = new Set(["EMAIL", "WEB", "RETAIL"]);

// ---- reads ---------------------------------------------------------------------------------------

const SORTS: SortKeys<Registration> = {
  id: (r) => idOrder(r.id),
  channel: (r) => r.channel,
  status: (r) => r.status,
  serial: (r) => r.serial,
  batchNumber: (r) => r.batchNumber,
  modelCode: (r) => r.modelCode,
  customer: (r) => r.customer.name,
  customerName: (r) => r.customer.name,
  purchaseDate: (r) => r.purchaseDate,
  invoiceNumber: (r) => r.invoiceNumber,
  submittedByName: (r) => r.submittedByName,
  submittedAt: (r) => r.submittedAt,
  reviewedAt: (r) => r.reviewedAt,
};

/** Registration inbox (A02) / the customer's own. `q` matches serial, batch, customer, model and dealer. */
export function listRegistrations(ctx: Ctx, query: RawQuery = {}): Paginated<RegistrationView> {
  const list = listQuery(query);
  const status = queryEnum(query, "status", REGISTRATION_STATUSES);
  const channel = queryEnum(query, "channel", REGISTRATION_CHANNELS);
  const flag = queryEnum(query, "flag", REGISTRATION_FLAGS);
  const keys: SortKeys<Registration> = { ...SORTS, dealerName: (r) => dealerName(ctx.state, r.dealerId) };
  const rows = ctx.state.registrations.filter(
    (r) =>
      canSee(ctx.user, r, ctx.state.dealers) &&
      (!status || r.status === status) &&
      (!channel || r.channel === channel) &&
      (!flag || r.flags.includes(flag)) &&
      matches(
        list.q,
        r.serial,
        r.batchNumber,
        r.customer.name,
        r.modelCode,
        dealerName(ctx.state, r.dealerId),
      ),
  );
  const page = paginate(
    sortRows(rows, list.sort, keys, "-submittedAt", (r) => idOrder(r.id)),
    list,
  );
  return { ...page, items: page.items.map((r) => toRegistrationView(ctx, r)) };
}

export function getRegistration(ctx: Ctx, id: string): RegistrationView {
  const r = ctx.state.registrations.find((x) => x.id === id);
  if (!r || !canSee(ctx.user, r, ctx.state.dealers)) throw notFound("Registration");
  return toRegistrationView(ctx, r);
}

// ---- signed-in entry points: dealer form (DL03) and customer portal (CU01) ------------------------

/** Customer: always PENDING (purchase date and an invoice). Dealer, distributor, admin: approved unless a duplicate. */
export function createRegistration(ctx: Ctx, rawBody: unknown): RegistrationView {
  const body = createBody(rawBody);
  assertOwnAttachments(ctx, body.attachmentIds);
  const id = ctx.user.role === "customer" ? createByCustomer(ctx, body) : createByDealer(ctx, body);
  return getRegistration(ctx, id);
}

/** CU01 (PORTAL): always Pending, for the warranty desk to check against the proof of purchase. */
function createByCustomer(ctx: Ctx, body: CreateRegistrationBody): string {
  const { user, state } = ctx;
  throwIfErrors(selfServiceErrors(state, ctx.today, body, { proofRequired: true }));
  const customer = state.customers.find((c) => c.id === user.customerId);
  return submitForReview(
    ctx,
    {
      ...rowToFields(body),
      customer: {
        name: customer?.name ?? user.name,
        phone: customer?.phone || undefined,
        email: customer?.email ?? user.email,
        city: customer?.city || undefined,
        state: customer?.state || undefined,
        zip: customer?.zip || undefined,
      },
      customerId: user.customerId,
      placeOfPurchase: body.placeOfPurchase?.trim() || undefined,
      attachmentIds: body.attachmentIds ?? [],
    },
    "PORTAL",
    { id: user.id, name: user.name },
  );
}

/** DL03: a clean registration is approved at once; a duplicate serial waits for the warranty desk. */
function createByDealer(ctx: Ctx, body: CreateRegistrationBody): string {
  requireRole(ctx, "admin", "dealer", "distributor");
  const dealerId = dealerIdFor(ctx.user, body.dealerId, ctx.state.dealers);
  const result = registerTrusted(ctx, body, "DEALER", ctx.user, {
    dealerId,
    attachmentIds: body.attachmentIds ?? [],
    reviewer: "Auto-approved (dealer registration)",
  });
  if (result.status === "ERROR")
    throw validation("Check the highlighted fields.", rowFieldErrors(result.errors));
  return result.registrationId;
}

// ---- shared by every entry point -------------------------------------------------------------------

const modelFormats = (state: DemoState) => new Map(state.models.map((m) => [m.code, modelFormat(m)]));

/**
 * Field checks for self-service registrations (customer portal, public web form): model, serial and batch against
 * the model's format, purchase date not in the future, proof of purchase. Batch is optional here (the label may be
 * hard to read), but must match the model's format when given.
 */
export function selfServiceErrors(
  state: DemoState,
  today: IsoDate,
  body: RegistrationRowInput & { attachmentIds?: string[] },
  { proofRequired }: { proofRequired: boolean },
): Record<string, string> {
  const errors: Record<string, string> = {};
  const serial = normalizeSerialValue(body.serial);
  const batch = normalizeBatchValue(body.batchNumber);
  const modelCode = (body.modelCode ?? "").trim().toUpperCase();
  const format = modelFormats(state).get(modelCode);
  if (!modelCode) errors.modelCode = "validation.required";
  else if (!format) errors.modelCode = "rowErrors.unknown_model";
  if (!serial) errors.serial = "validation.required";
  else if (!SERIAL_PATTERN.test(serial) || (format && !format.serial.test(serial)))
    errors.serial = "rowErrors.invalid_serial";
  if (batch && format && !format.batch.test(batch)) errors.batchNumber = "rowErrors.invalid_batch";
  if (!isIsoDate(body.purchaseDate)) errors.purchaseDate = "validation.date";
  else if (body.purchaseDate > today) errors.purchaseDate = "rowErrors.future_date";
  if (!isUsState(body.state?.trim().toUpperCase())) errors.state = "validation.state";
  if (!isUsZip(body.zip?.trim())) errors.zip = "validation.zip";
  if (proofRequired && !body.attachmentIds?.length) errors.attachmentIds = "validation.invoiceRequired";
  return errors;
}

/** Row check context: the catalogue and whether this serial is already registered. */
function rowContext(
  state: DemoState,
  today: IsoDate,
  serialInput: string | undefined,
  seenInFile?: ReadonlySet<string>,
): RowContext {
  const serial = normalizeSerialValue(serialInput);
  const registered = state.units.some((u) => u.serial === serial && !!u.warrantyEnd);
  return {
    models: modelFormats(state),
    existingSerials: new Set(registered ? [serial] : []),
    seenInFile,
    today,
  };
}

/**
 * A trusted sender's registration: checked against the catalogue; clean -> approved at once, duplicate serial ->
 * admin review, anything else -> field errors (nothing stored).
 */
export function registerTrusted(
  ctx: WriteCtx,
  values: RegistrationRowInput,
  channel: RegistrationChannel,
  by: Submitter,
  extra: {
    dealerId?: string;
    placeOfPurchase?: string;
    attachmentIds?: string[];
    importId?: string;
    seenInFile?: ReadonlySet<string>;
    reviewer: string;
    notifyDealer?: boolean;
  },
): TrustedResult {
  const errors = validateRegistrationRow(
    values,
    rowContext(ctx.state, ctx.today, values.serial, extra.seenInFile),
  );
  const fields = rowToFields(values);
  const common = {
    ...fields,
    dealerId: extra.dealerId,
    placeOfPurchase: extra.placeOfPurchase,
    attachmentIds: extra.attachmentIds ?? [],
    importId: extra.importId,
  };
  if (needsAdminReview(errors)) {
    const reg = insertRegistration(ctx, { ...common, duplicateOfSerial: fields.serial }, channel, by);
    sendToReview(ctx, reg, ["DUPLICATE", "EXCEPTION"]);
    return { status: "REVIEW", registrationId: reg.id, errors };
  }
  if (hasErrors(errors)) return { status: "ERROR", errors };
  const customerId = customerIdFor(ctx.state, fields.customer);
  const reg = insertRegistration(ctx, { ...common, customerId }, channel, by);
  approve(ctx, reg, extra.reviewer, { notifyDealer: extra.notifyDealer });
  return { status: "REGISTERED", registrationId: reg.id };
}

/** A customer-facing channel's registration: Pending, flagged for the warranty desk. Returns its id. */
export function submitForReview(
  ctx: WriteCtx,
  fields: NewRegistration,
  channel: RegistrationChannel,
  by: Submitter,
): string {
  // The ERP is where new serials come from: an unknown serial is expected there, not an exception.
  const flags = reviewFlags(ctx.state, fields.serial, fields.modelCode).filter(
    (f, _i, all) => channel !== "ERP" || f !== "EXCEPTION" || all.includes("DUPLICATE"),
  );
  const unit = ctx.state.units.find((u) => u.serial === fields.serial);
  const reg = insertRegistration(
    ctx,
    {
      ...fields,
      dealerId: fields.dealerId ?? unit?.dealerId,
      duplicateOfSerial: flags.includes("DUPLICATE") ? fields.serial : undefined,
    },
    channel,
    by,
  );
  sendToReview(ctx, reg, flags);
  return reg.id;
}

/** EXCEPTION when the serial is unknown; DUPLICATE when already registered; MODEL_MISMATCH when the model differs. */
export function reviewFlags(state: DemoState, serial: string, modelCode: string): RegistrationFlag[] {
  const unit = state.units.find((u) => u.serial === serial);
  const flags: RegistrationFlag[] = [];
  if (!unit) flags.push("EXCEPTION");
  else if (unit.warrantyEnd) flags.push("DUPLICATE", "EXCEPTION");
  if (unit && state.models.find((m) => m.id === unit.modelId)?.code !== modelCode)
    flags.push("MODEL_MISMATCH");
  return flags;
}

function insertRegistration(
  ctx: WriteCtx,
  fields: NewRegistration,
  channel: RegistrationChannel,
  by: Submitter,
): Registration {
  const reg: Registration = {
    id: nextId(ctx.state, "REG"),
    channel,
    status: "PENDING",
    flags: [],
    serial: fields.serial,
    batchNumber: fields.batchNumber,
    modelCode: fields.modelCode,
    customer: fields.customer,
    customerId: fields.customerId,
    dealerId: fields.dealerId,
    purchaseDate: fields.purchaseDate,
    invoiceNumber: fields.invoiceNumber,
    placeOfPurchase: fields.placeOfPurchase,
    attachmentIds: fields.attachmentIds ?? [],
    submittedBy: by.id,
    submittedByName: by.name,
    submittedAt: ctx.now,
    duplicateOfSerial: fields.duplicateOfSerial,
    importId: fields.importId,
  };
  ctx.state.registrations.push(reg);
  return reg;
}

/** Flags the registration and tells the warranty desk it's waiting in the inbox. */
function sendToReview(ctx: WriteCtx, reg: Registration, flags: RegistrationFlag[]) {
  reg.flags = flags;
  notify(ctx.state, adminIds(ctx.state), "registration_submitted", ctx.now, {
    params: { serial: reg.serial },
    link: `/registrations/${reg.id}`,
  });
}

/** Matches an existing customer by phone (last 10 digits) or email, otherwise creates one. */
export function customerIdFor(state: DemoState, customer: RegistrationCustomer): string {
  const phone = phoneKey(customer.phone);
  const email = emailKey(customer.email);
  const existing = state.customers.find(
    (c) => (!!phone && phoneKey(c.phone) === phone) || (!!email && emailKey(c.email) === email),
  );
  if (existing) return existing.id;
  const id = nextId(state, "CUS");
  state.customers.push({
    id,
    name: customer.name,
    phone: customer.phone ?? "",
    email: customer.email,
    city: customer.city ?? "",
    state: customer.state ?? "",
    zip: customer.zip ?? "",
  });
  return id;
}

/**
 * Creates or completes the product and starts its warranty: from the purchase date (today when unknown), for the
 * model's warranty term.
 */
function approve(ctx: WriteCtx, reg: Registration, reviewer: string, { notifyDealer = true } = {}) {
  const { state } = ctx;
  const model = state.models.find((m) => m.code === reg.modelCode);
  if (!model) throw conflict("unknown_model", "The model isn't in the product catalog.");
  const existing = state.units.find((u) => u.serial === reg.serial);
  if (existing?.warrantyEnd) throw duplicateSerial();
  // An ERP-known product keeps its catalogue model; its template decides the warranty term.
  const unitModel = (existing && state.models.find((m) => m.id === existing.modelId)) || model;
  const warranty = warrantyFromPurchase(unitModel, reg.purchaseDate, ctx.today);
  const data = {
    batchNumber: reg.batchNumber ?? existing?.batchNumber,
    dealerId: existing?.dealerId ?? reg.dealerId,
    customerId: reg.customerId,
    purchaseDate: warranty.warrantyStart,
    placeOfPurchase: reg.placeOfPurchase ?? existing?.placeOfPurchase,
    warrantyStart: warranty.warrantyStart,
    warrantyEnd: warranty.warrantyEnd,
    registrationId: reg.id,
  };
  const unit: Unit = existing ?? { serial: reg.serial, modelId: model.id, attachmentIds: [], history: [] };
  Object.assign(unit, data, { attachmentIds: [...unit.attachmentIds, ...reg.attachmentIds] });
  if (!existing) state.units.push(unit);
  addUnitEvent(unit, { at: ctx.now, type: "registered", byName: reviewer, refId: reg.id });
  reg.status = "APPROVED";
  reg.reviewedByName = reviewer;
  reg.reviewedAt = ctx.now;

  // Registrations that didn't come through a dealer update the customer record in CRM once approved.
  if (CRM_CHANNELS.has(reg.channel)) {
    const customer = state.customers.find((c) => c.id === reg.customerId);
    logMessage(ctx, {
      system: "CRM",
      direction: "OUT",
      type: "crm_update",
      refId: reg.id,
      payload: {
        action: "customer_product_registered",
        customer: {
          id: customer?.id,
          name: customer?.name,
          email: customer?.email,
          phone: customer?.phone,
          state: customer?.state,
        },
        product: {
          serial: reg.serial,
          batchNumber: reg.batchNumber,
          modelCode: reg.modelCode,
          purchaseDate: reg.purchaseDate,
        },
        registrationId: reg.id,
        channel: reg.channel,
      },
    });
  }
  notify(state, followers(state, reg, { includeDealer: notifyDealer }), "registration_approved", ctx.now, {
    params: { serial: reg.serial },
    link: `/units/${reg.serial}`,
  });
}

// ---- warranty desk decisions (A02, A03) ----------------------------------------------------------

/** A pending registration. 404 if missing, 409 if already decided. */
function pendingRegistration(ctx: Ctx, id: string): Registration {
  requireRole(ctx, "admin");
  const reg = ctx.state.registrations.find((r) => r.id === id);
  if (!reg) throw notFound("Registration");
  if (reg.status !== "PENDING") throw conflict("not_pending", "This registration was already decided.");
  return reg;
}

function ensureCustomer(state: DemoState, reg: Registration) {
  reg.customerId ??= customerIdFor(state, reg.customer);
}

export function approveRegistration(ctx: Ctx, id: string): RegistrationView {
  const reg = pendingRegistration(ctx, id);
  if (reg.flags.includes("DUPLICATE")) throw duplicateSerial();
  ensureCustomer(ctx.state, reg);
  approve(ctx, reg, ctx.user.name);
  return getRegistration(ctx, id);
}

export function rejectRegistration(ctx: Ctx, id: string, rawReason: unknown): RegistrationView {
  const reg = pendingRegistration(ctx, id);
  const reason = typeof rawReason === "string" ? rawReason.trim().slice(0, 1000) : "";
  if (!reason) throw validation("Give a reason.", { reason: "validation.reasonRequired" });
  reg.status = "REJECTED";
  reg.rejectReason = reason;
  reg.reviewedByName = ctx.user.name;
  reg.reviewedAt = ctx.now;
  notify(
    ctx.state,
    [reg.submittedBy, ...followers(ctx.state, reg, { includeDealer: false })],
    "registration_rejected",
    ctx.now,
    { params: { serial: reg.serial, reason } },
  );
  return getRegistration(ctx, id);
}

/** A duplicate of an existing product: keep the existing record, add this submission's files to it. */
export function mergeRegistration(ctx: Ctx, id: string): RegistrationView {
  const reg = pendingRegistration(ctx, id);
  const unit = reg.duplicateOfSerial
    ? ctx.state.units.find((u) => u.serial === reg.duplicateOfSerial)
    : undefined;
  if (!unit) throw conflict("nothing_to_merge", "There's no existing record to merge into.");
  unit.attachmentIds.push(...reg.attachmentIds);
  addUnitEvent(unit, {
    at: ctx.now,
    type: "note",
    byName: ctx.user.name,
    text: `Merged registration ${reg.id}`,
    refId: reg.id,
  });
  reg.status = "APPROVED";
  reg.reviewedByName = ctx.user.name;
  reg.reviewedAt = ctx.now;
  return getRegistration(ctx, id);
}

/** A02 bulk approve. Skips duplicates, decided rows and unknown models; each approval stands on its own. */
export function bulkApproveRegistrations(ctx: Ctx, rawIds: unknown): { approved: number; skipped: number } {
  requireRole(ctx, "admin");
  const ids = idList(rawIds, 500) ?? [];
  let approved = 0;
  let skipped = 0;
  for (const id of ids) {
    let done = false;
    try {
      done = transaction(ctx.state, () => {
        const reg = pendingRegistration(ctx, id);
        if (reg.flags.includes("DUPLICATE") || !ctx.state.models.some((m) => m.code === reg.modelCode))
          return false;
        ensureCustomer(ctx.state, reg);
        approve(ctx, reg, ctx.user.name);
        return true;
      });
    } catch (e) {
      // Missing, already decided, or registered meanwhile: skip it, keep going.
      if (!(e instanceof ServiceError)) throw e;
    }
    if (done) approved += 1;
    else skipped += 1;
  }
  return { approved, skipped };
}

// ---- bulk import (DL02) --------------------------------------------------------------------------

export const BULK_IMPORT_MAX_ROWS = 5000;
export const BULK_IMPORT_MAX_BYTES = 5 * 1024 * 1024;

function toBulkView(state: DemoState, batch: BulkImport): BulkImportView {
  return { ...batch, dealerName: dealerName(state, batch.dealerId), counts: bulkCounts(batch.rows) };
}

/** Checks the rows; clean ones are registered at once, a duplicate serial goes to review, the rest wait for a fix. */
function processRows(
  ctx: Ctx,
  batchId: string,
  rows: { rowNumber: number; values: RegistrationRowInput }[],
  success: BulkRowStatus,
) {
  const batchOf = () => {
    const batch = ctx.state.bulkImports.find((b) => b.id === batchId);
    if (!batch) throw notFound("Upload");
    return batch;
  };
  const numbers = new Set(rows.map((r) => r.rowNumber));
  // Serials already accepted from this file (registered or sent to review) count as "seen" for duplicates.
  const seen = new Set(
    batchOf()
      .rows.filter((r) => r.status !== "ERROR" && !numbers.has(r.rowNumber))
      .map((r) => normalizeSerialValue(r.values.serial)),
  );
  for (const input of rows) {
    // Each row stands on its own, like the backend's per-row transaction.
    transaction(ctx.state, () => {
      const batch = batchOf();
      const result = registerTrusted(ctx, input.values, "BULK", ctx.user, {
        dealerId: batch.dealerId,
        importId: batch.id,
        seenInFile: seen,
        reviewer: "Auto-approved (dealer bulk upload)",
        notifyDealer: false,
      });
      const row = batch.rows.find((r) => r.rowNumber === input.rowNumber);
      if (!row) return;
      row.values = input.values;
      row.status = result.status === "REGISTERED" ? success : result.status;
      row.errors = result.status === "REGISTERED" ? {} : result.errors;
      if (result.status === "ERROR") delete row.registrationId;
      else row.registrationId = result.registrationId;
    });
    seen.add(normalizeSerialValue(input.values.serial));
  }
  const batch = batchOf();
  batch.updatedAt = ctx.now;
  const counts = bulkCounts(batch.rows);
  notify(ctx.state, [ctx.user.id], "bulk_processed", ctx.now, {
    params: {
      file: batch.fileName,
      registered: counts.registered,
      errors: counts.errors,
      review: counts.review,
    },
    link: `/registrations/bulk?batch=${batch.id}`,
  });
}

/** DL02 upload, after the adapter read the sheet into rows (see bulk-parse.ts). */
export function createBulkImport(
  ctx: Ctx,
  input: { fileName: string; dealerId?: string; rows: RegistrationRowInput[] },
): BulkImportView {
  requireRole(ctx, "admin", "dealer", "distributor");
  const dealerId = dealerIdFor(ctx.user, input.dealerId?.trim() || undefined, ctx.state.dealers);
  if (!input.rows.length)
    throw new ServiceError(422, "empty_file", "The file has no rows. Use the template and try again.");
  if (input.rows.length > BULK_IMPORT_MAX_ROWS)
    throw validation(`The file has more than ${BULK_IMPORT_MAX_ROWS} rows. Split it and try again.`);
  const batch: BulkImport = {
    id: nextId(ctx.state, "BLK"),
    fileName: input.fileName.slice(0, 255),
    dealerId,
    uploadedBy: ctx.user.id,
    uploadedByName: ctx.user.name,
    createdAt: ctx.now,
    updatedAt: ctx.now,
    rows: input.rows.map((values, i) => ({ rowNumber: i + 2, values, errors: {}, status: "ERROR" })),
  };
  ctx.state.bulkImports.push(batch);
  processRows(
    ctx,
    batch.id,
    input.rows.map((values, i) => ({ rowNumber: i + 2, values })),
    "REGISTERED",
  );
  return getBulkImport(ctx, batch.id);
}

function findBatch(ctx: Ctx, id: string): BulkImport {
  requireRole(ctx, "admin", "dealer", "distributor");
  const allowed = visibleDealerIds(ctx.user, ctx.state.dealers);
  const batch = ctx.state.bulkImports.find((b) => b.id === id);
  if (!batch || (allowed !== null && !allowed.includes(batch.dealerId))) throw notFound("Upload");
  return batch;
}

export const getBulkImport = (ctx: Ctx, id: string) => toBulkView(ctx.state, findBatch(ctx, id));

/** Upload history, newest first. */
export function listBulkImports(ctx: Ctx): BulkImportView[] {
  requireRole(ctx, "admin", "dealer", "distributor");
  const allowed = visibleDealerIds(ctx.user, ctx.state.dealers);
  return sortRows(
    ctx.state.bulkImports.filter((b) => allowed === null || allowed.includes(b.dealerId)),
    undefined,
    { createdAt: (b) => b.createdAt },
    "-createdAt",
    (b) => -idOrder(b.id),
  )
    .slice(0, 100)
    .map((b) => toBulkView(ctx.state, b));
}

/** Re-checks only the fixed rows, in place: no re-upload of the whole file. Only rows in ERROR are re-checked. */
export function resubmitBulkRows(ctx: Ctx, id: string, rawRows: unknown): BulkImportView {
  const batch = findBatch(ctx, id);
  const updates = Array.isArray(rawRows) ? rawRows.slice(0, BULK_IMPORT_MAX_ROWS) : [];
  const rows: { rowNumber: number; values: RegistrationRowInput }[] = [];
  for (const update of updates) {
    const u = (update ?? {}) as { rowNumber?: unknown; values?: unknown };
    const row = batch.rows.find((r) => r.rowNumber === u.rowNumber && r.status === "ERROR");
    if (!row || rows.some((r) => r.rowNumber === row.rowNumber)) continue;
    rows.push({ rowNumber: row.rowNumber, values: { ...row.values, ...rowInput(u.values) } });
  }
  processRows(ctx, batch.id, rows, "FIXED");
  return getBulkImport(ctx, id);
}

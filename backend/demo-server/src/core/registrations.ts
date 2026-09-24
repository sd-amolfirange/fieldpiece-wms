import {
  buildUnitParts,
  bulkCounts,
  hasErrors,
  isIsoDate,
  needsAdminReview,
  normalizeSerialValue,
  validateRegistrationRow,
  type BulkImport,
  type BulkImportView,
  type BulkRow,
  type BulkRowStatus,
  type Registration,
  type RegistrationChannel,
  type RegistrationCustomer,
  type RegistrationFlag,
  type RegistrationRowInput,
  type RegistrationView,
  type RowErrors,
  type Unit,
} from "@wms/domain";
import { visibleDealerIds } from "./scope";
import {
  assertOwnAttachments,
  dealerName,
  getRegistration,
  notFound,
  notify,
  requireRole,
  ServiceError,
  sortRows,
  type Ctx,
} from "./services";
import { nextId } from "./state";

// Registration actions for the Phase 2 screens (CU01, DL02, DL03, A02, A03). Mock API: minimal rules only.
// - Customer (Portal): always Pending, flagged when the serial is unknown, already registered or the model differs.
// - Dealer / distributor / admin (form or bulk): clean rows are approved at once; a duplicate serial goes to
//   admin review; other problems come back as field errors to fix.

const adminIds = (ctx: Ctx) =>
  ctx.state.users.filter((u) => u.role === "admin").map((u) => u.id);

const registeredSerials = (ctx: Ctx) =>
  new Set(
    ctx.state.units.filter((u) => u.parts.length > 0).map((u) => u.serial),
  );

const rowContext = (ctx: Ctx, seenInFile?: Set<string>) => ({
  modelCodes: new Set(ctx.state.models.map((m) => m.code)),
  existingSerials: registeredSerials(ctx),
  seenInFile,
  today: ctx.today,
});

const fieldErrors = (errors: RowErrors) =>
  Object.fromEntries(
    Object.entries(errors).map(([field, code]) => [field, `rowErrors.${code}`]),
  );

/** Dealer the registration belongs to: a dealer's own; a distributor or admin picks one. */
function dealerIdFor(ctx: Ctx, requested?: string): string {
  if (ctx.user.role === "dealer" && ctx.user.dealerId) return ctx.user.dealerId;
  const allowed = visibleDealerIds(ctx.user, ctx.state.dealers);
  const ok =
    !!requested &&
    ctx.state.dealers.some((d) => d.id === requested) &&
    (allowed === null || allowed.includes(requested));
  if (!ok)
    throw new ServiceError(422, "validation_error", "Pick the dealer.", {
      dealerId: "validation.pickDealer",
    });
  return requested;
}

/** Matches an existing customer by phone (last 10 digits) or email, otherwise creates one. */
function customerIdFor(ctx: Ctx, c: RegistrationCustomer): string {
  const digits = (v?: string) => (v ?? "").replace(/\D/g, "").slice(-10);
  const phone = digits(c.phone);
  const email = c.email?.trim().toLowerCase();
  const existing = ctx.state.customers.find(
    (x) =>
      (phone && digits(x.phone) === phone) ||
      (email && x.email?.toLowerCase() === email),
  );
  if (existing) return existing.id;
  const id = nextId(ctx.state, "CUS");
  ctx.state.customers.push({
    id,
    name: c.name,
    phone: c.phone ?? "",
    email: c.email,
    city: c.city ?? "",
  });
  return id;
}

function recipientsFor(
  ctx: Ctx,
  reg: Registration,
  { includeDealer = true } = {},
) {
  const dealer = ctx.state.dealers.find((d) => d.id === reg.dealerId);
  return ctx.state.users
    .filter(
      (u) =>
        (reg.customerId && u.customerId === reg.customerId) ||
        (includeDealer && reg.dealerId && u.dealerId === reg.dealerId) ||
        (includeDealer &&
          dealer?.distributorId &&
          u.distributorId === dealer.distributorId),
    )
    .map((u) => u.id);
}

/** Creates or completes the unit, attaches the model's parts with their warranties, and approves. */
function approve(
  ctx: Ctx,
  reg: Registration,
  reviewer: string,
  { notifyDealer = true } = {},
): Unit {
  const { state } = ctx;
  const model = state.models.find((m) => m.code === reg.modelCode);
  if (!model)
    throw new ServiceError(
      409,
      "unknown_model",
      "The model code isn't in the product master.",
    );
  let unit = state.units.find((u) => u.serial === reg.serial);
  if (unit?.parts.length) {
    throw new ServiceError(
      409,
      "duplicate_serial",
      "This serial is already registered. Merge or reject the registration.",
    );
  }
  if (!unit) {
    unit = {
      serial: reg.serial,
      modelId: model.id,
      brandId: model.brandId,
      parts: [],
      attachmentIds: [],
      history: [],
    };
    state.units.push(unit);
  }
  const unitModel = state.models.find((m) => m.id === unit.modelId) ?? model;
  const start = reg.installDate ?? reg.purchaseDate ?? ctx.today;
  const suffix = reg.serial.slice(-6);
  unit.dealerId ??= reg.dealerId;
  unit.customerId = reg.customerId;
  unit.installDate = reg.installDate ?? reg.purchaseDate;
  unit.purchaseDate = reg.purchaseDate ?? reg.installDate;
  unit.location = reg.location ?? unit.location;
  unit.parts = buildUnitParts(unitModel, start, {
    idPrefix: reg.serial,
    serials: { COMPRESSOR: `CP-${suffix}`, PCB: `PCB-${suffix}` },
  });
  unit.registrationId = reg.id;
  unit.attachmentIds.push(...reg.attachmentIds);
  unit.history.push({
    at: ctx.now,
    type: "registered",
    byName: reviewer,
    refId: reg.id,
  });

  reg.status = "APPROVED";
  reg.reviewedByName = reviewer;
  reg.reviewedAt = ctx.now;
  notify(
    state,
    recipientsFor(ctx, reg, { includeDealer: notifyDealer }),
    "registration_approved",
    ctx.now,
    {
      params: { serial: reg.serial },
      link: `/units/${reg.serial}`,
    },
  );
  return unit;
}

function newRegistration(
  ctx: Ctx,
  fields: Pick<Registration, "serial" | "modelCode" | "customer"> &
    Partial<Registration>,
  channel: RegistrationChannel,
): Registration {
  const reg: Registration = {
    id: nextId(ctx.state, "REG"),
    channel,
    status: "PENDING",
    flags: [],
    attachmentIds: [],
    submittedBy: ctx.user.id,
    submittedByName: ctx.user.name,
    submittedAt: ctx.now,
    ...fields,
  };
  ctx.state.registrations.push(reg);
  return reg;
}

function sendToReview(ctx: Ctx, reg: Registration, flags: RegistrationFlag[]) {
  reg.flags = flags;
  notify(ctx.state, adminIds(ctx), "registration_submitted", ctx.now, {
    params: { serial: reg.serial },
    link: `/registrations/${reg.id}`,
  });
}

const rowToFields = (values: RegistrationRowInput) => ({
  serial: normalizeSerialValue(values.serial),
  modelCode: (values.modelCode ?? "").trim().toUpperCase(),
  customer: {
    name: (values.customerName ?? "").trim(),
    phone: values.customerPhone?.trim() || undefined,
    email: values.customerEmail?.trim() || undefined,
    city: values.city?.trim() || undefined,
  },
  installDate: values.installDate?.trim() || undefined,
  invoiceNumber: values.invoiceNumber?.trim() || undefined,
});

export interface CreateRegistrationBody extends RegistrationRowInput {
  purchaseDate?: string;
  location?: string;
  dealerId?: string;
  attachmentIds?: string[];
}

export function createRegistration(
  ctx: Ctx,
  body: CreateRegistrationBody,
): RegistrationView {
  const { state, user } = ctx;
  assertOwnAttachments(ctx, body.attachmentIds);

  if (user.role === "customer") {
    const serial = normalizeSerialValue(body.serial);
    const modelCode = (body.modelCode ?? "").trim().toUpperCase();
    const errors: Record<string, string> = {};
    if (!serial) errors.serial = "validation.required";
    if (!modelCode) errors.modelCode = "validation.required";
    if (!isIsoDate(body.purchaseDate)) errors.purchaseDate = "validation.date";
    else if (body.purchaseDate > ctx.today)
      errors.purchaseDate = "rowErrors.future_date";
    if (!body.attachmentIds?.length)
      errors.attachmentIds = "validation.invoiceRequired";
    if (Object.keys(errors).length)
      throw new ServiceError(
        422,
        "validation_error",
        "Check the highlighted fields.",
        errors,
      );

    const unit = state.units.find((u) => u.serial === serial);
    const customer = state.customers.find((c) => c.id === user.customerId);
    const unitModel = state.models.find((m) => m.id === unit?.modelId);
    const flags: RegistrationFlag[] = [];
    if (!unit) flags.push("EXCEPTION");
    else if (unit.parts.length) flags.push("DUPLICATE", "EXCEPTION");
    if (unitModel && unitModel.code !== modelCode) flags.push("MODEL_MISMATCH");

    const reg = newRegistration(
      ctx,
      {
        serial,
        modelCode,
        customer: {
          name: customer?.name ?? user.name,
          phone: customer?.phone,
          email: customer?.email ?? user.email,
          city: customer?.city,
        },
        customerId: user.customerId,
        dealerId: unit?.dealerId,
        purchaseDate: body.purchaseDate,
        location: body.location?.trim() || undefined,
        attachmentIds: body.attachmentIds ?? [],
        duplicateOfSerial: unit?.parts.length ? serial : undefined,
      },
      "PORTAL",
    );
    sendToReview(ctx, reg, flags);
    return getRegistration(ctx, reg.id);
  }

  requireRole(ctx, "admin", "dealer", "distributor");
  const dealerId = dealerIdFor(ctx, body.dealerId);
  const errors = validateRegistrationRow(body, rowContext(ctx));
  const fields = rowToFields(body);
  const extra = {
    dealerId,
    purchaseDate: body.purchaseDate || fields.installDate,
    location: body.location?.trim() || undefined,
    attachmentIds: body.attachmentIds ?? [],
  };
  if (needsAdminReview(errors)) {
    const reg = newRegistration(
      ctx,
      { ...fields, ...extra, duplicateOfSerial: fields.serial },
      "DEALER",
    );
    sendToReview(ctx, reg, ["DUPLICATE", "EXCEPTION"]);
    return getRegistration(ctx, reg.id);
  }
  if (hasErrors(errors))
    throw new ServiceError(
      422,
      "validation_error",
      "Check the highlighted fields.",
      fieldErrors(errors),
    );

  const reg = newRegistration(
    ctx,
    { ...fields, ...extra, customerId: customerIdFor(ctx, fields.customer) },
    "DEALER",
  );
  approve(ctx, reg, "Auto-approved (dealer registration)");
  return getRegistration(ctx, reg.id);
}

function pendingRegistration(ctx: Ctx, id: string): Registration {
  requireRole(ctx, "admin");
  const reg = ctx.state.registrations.find((r) => r.id === id);
  if (!reg) throw notFound("Registration");
  if (reg.status !== "PENDING")
    throw new ServiceError(
      409,
      "not_pending",
      "This registration was already decided.",
    );
  return reg;
}

export function approveRegistration(ctx: Ctx, id: string): RegistrationView {
  const reg = pendingRegistration(ctx, id);
  if (reg.flags.includes("DUPLICATE")) {
    throw new ServiceError(
      409,
      "duplicate_serial",
      "This serial is already registered. Merge or reject the registration.",
    );
  }
  reg.customerId ??= customerIdFor(ctx, reg.customer);
  approve(ctx, reg, ctx.user.name);
  return getRegistration(ctx, id);
}

export function rejectRegistration(
  ctx: Ctx,
  id: string,
  reason: string | undefined,
): RegistrationView {
  const reg = pendingRegistration(ctx, id);
  const text = reason?.trim();
  if (!text)
    throw new ServiceError(422, "validation_error", "Give a reason.", {
      reason: "validation.reasonRequired",
    });
  reg.status = "REJECTED";
  reg.rejectReason = text;
  reg.reviewedByName = ctx.user.name;
  reg.reviewedAt = ctx.now;
  notify(
    ctx.state,
    [reg.submittedBy, ...recipientsFor(ctx, reg, { includeDealer: false })],
    "registration_rejected",
    ctx.now,
    {
      params: { serial: reg.serial, reason: text },
    },
  );
  return getRegistration(ctx, id);
}

/** Duplicate of an existing unit: keep the existing record, add this submission's invoice to it. */
export function mergeRegistration(ctx: Ctx, id: string): RegistrationView {
  const reg = pendingRegistration(ctx, id);
  const unit = ctx.state.units.find((u) => u.serial === reg.duplicateOfSerial);
  if (!unit)
    throw new ServiceError(
      409,
      "nothing_to_merge",
      "There's no existing record to merge into.",
    );
  unit.attachmentIds.push(...reg.attachmentIds);
  unit.history.push({
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

export function bulkApproveRegistrations(ctx: Ctx, ids: string[] = []) {
  requireRole(ctx, "admin");
  let approved = 0;
  let skipped = 0;
  for (const id of ids) {
    const reg = ctx.state.registrations.find((r) => r.id === id);
    if (
      !reg ||
      reg.status !== "PENDING" ||
      reg.flags.includes("DUPLICATE") ||
      !ctx.state.models.some((m) => m.code === reg.modelCode)
    ) {
      skipped += 1;
      continue;
    }
    reg.customerId ??= customerIdFor(ctx, reg.customer);
    approve(ctx, reg, ctx.user.name);
    approved += 1;
  }
  return { approved, skipped };
}

// ---- bulk import --------------------------------------------------------------------------------

function toBulkView(ctx: Ctx, batch: BulkImport): BulkImportView {
  return {
    ...batch,
    dealerName: dealerName(ctx.state, batch.dealerId),
    counts: bulkCounts(batch.rows),
  };
}

function processRows(
  ctx: Ctx,
  batch: BulkImport,
  rows: BulkRow[],
  success: BulkRowStatus,
) {
  const seen = new Set(
    batch.rows
      .filter((r) => !rows.includes(r) && r.status !== "ERROR")
      .map((r) => normalizeSerialValue(r.values.serial)),
  );
  for (const row of rows) {
    const errors = validateRegistrationRow(row.values, rowContext(ctx, seen));
    const fields = rowToFields(row.values);
    const extra = {
      dealerId: batch.dealerId,
      purchaseDate: fields.installDate,
      batchId: batch.id,
    };
    if (needsAdminReview(errors)) {
      const reg = newRegistration(
        ctx,
        { ...fields, ...extra, duplicateOfSerial: fields.serial },
        "BULK",
      );
      sendToReview(ctx, reg, ["DUPLICATE", "EXCEPTION"]);
      Object.assign(row, { status: "REVIEW", errors, registrationId: reg.id });
    } else if (hasErrors(errors)) {
      Object.assign(row, { status: "ERROR", errors });
    } else {
      const reg = newRegistration(
        ctx,
        {
          ...fields,
          ...extra,
          customerId: customerIdFor(ctx, fields.customer),
        },
        "BULK",
      );
      approve(ctx, reg, "Auto-approved (dealer bulk upload)", {
        notifyDealer: false,
      });
      Object.assign(row, {
        status: success,
        errors: {},
        registrationId: reg.id,
      });
    }
    seen.add(fields.serial);
  }
  batch.updatedAt = ctx.now;
}

function notifyBatch(ctx: Ctx, batch: BulkImport) {
  const c = bulkCounts(batch.rows);
  notify(ctx.state, [ctx.user.id], "bulk_processed", ctx.now, {
    params: {
      file: batch.fileName,
      registered: c.registered,
      errors: c.errors,
      review: c.review,
    },
    link: `/registrations/bulk?batch=${batch.id}`,
  });
}

export function createBulkImport(
  ctx: Ctx,
  input: { fileName: string; dealerId?: string; rows: RegistrationRowInput[] },
): BulkImportView {
  requireRole(ctx, "admin", "dealer", "distributor");
  const dealerId = dealerIdFor(ctx, input.dealerId);
  if (!input.rows.length) {
    throw new ServiceError(
      422,
      "empty_file",
      "The file has no rows. Use the template and try again.",
    );
  }
  const batch: BulkImport = {
    id: nextId(ctx.state, "BLK"),
    fileName: input.fileName,
    dealerId,
    uploadedBy: ctx.user.id,
    uploadedByName: ctx.user.name,
    createdAt: ctx.now,
    updatedAt: ctx.now,
    rows: input.rows.map((values, i) => ({
      rowNumber: i + 2,
      values,
      errors: {},
      status: "ERROR",
    })),
  };
  ctx.state.bulkImports.push(batch);
  processRows(ctx, batch, batch.rows, "REGISTERED");
  notifyBatch(ctx, batch);
  return toBulkView(ctx, batch);
}

function findBatch(ctx: Ctx, id: string): BulkImport {
  requireRole(ctx, "admin", "dealer", "distributor");
  const allowed = visibleDealerIds(ctx.user, ctx.state.dealers);
  const batch = ctx.state.bulkImports.find((b) => b.id === id);
  if (!batch || (allowed !== null && !allowed.includes(batch.dealerId)))
    throw notFound("Upload");
  return batch;
}

export const getBulkImport = (ctx: Ctx, id: string) =>
  toBulkView(ctx, findBatch(ctx, id));

export function listBulkImports(ctx: Ctx): BulkImportView[] {
  requireRole(ctx, "admin", "dealer", "distributor");
  const allowed = visibleDealerIds(ctx.user, ctx.state.dealers);
  return sortRows(
    ctx.state.bulkImports.filter(
      (b) => allowed === null || allowed.includes(b.dealerId),
    ),
    undefined,
    "-createdAt",
  ).map((b) => toBulkView(ctx, b));
}

/** Re-checks the fixed rows in place: no re-upload of the whole file. */
export function resubmitBulkRows(
  ctx: Ctx,
  id: string,
  updates: { rowNumber: number; values: RegistrationRowInput }[] = [],
): BulkImportView {
  const batch = findBatch(ctx, id);
  const rows: BulkRow[] = [];
  for (const update of updates) {
    const row = batch.rows.find(
      (r) => r.rowNumber === update.rowNumber && r.status === "ERROR",
    );
    if (!row) continue;
    row.values = { ...row.values, ...update.values };
    rows.push(row);
  }
  processRows(ctx, batch, rows, "FIXED");
  notifyBatch(ctx, batch);
  return toBulkView(ctx, batch);
}

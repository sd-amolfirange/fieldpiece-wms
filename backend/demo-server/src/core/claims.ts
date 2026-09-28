import {
  CLAIM_SOURCES,
  CLAIM_STATUSES,
  coverageFor,
  ISSUE_TYPES,
  isOpenClaim,
  modelFormat,
  nextClaimStatus,
  normalizeBatchValue,
  normalizeSerialValue,
  RESOLUTIONS,
  SERIAL_PATTERN,
  type ClaimActionName,
  type ClaimSource,
  type IssueType,
  type Paginated,
  type Resolution,
  type Unit,
  type WarrantyClaim,
  type WarrantyClaimView,
} from "@wms/domain";
import { conflict, notFound, throwIfErrors, validation } from "./errors";
import { canSee } from "./scope";
import {
  addUnitEvent,
  adminIds,
  assertOwnAttachments,
  customerName,
  findUnit,
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
  toClaimView,
  type Ctx,
  type RawQuery,
  type SortKeys,
} from "./services";
import { nextId } from "./state";

// Warranty claims (A07-A10, CU04/CU05, DL06/DL07), as backend/src/modules/claims. Customers and dealers file claims on
// registered products; the Fieldpiece warranty desk (admin) reviews them against the product's coverage and settles
// them by repair, replacement or credit. Status steps come only from @wms/domain (claim-transitions.ts).

export interface ClaimActionInput {
  action?: unknown;
  resolution?: unknown;
  creditAmount?: unknown;
  reason?: unknown;
  note?: unknown;
  replacementSerial?: unknown;
  replacementBatchNumber?: unknown;
}

const ACTIONS: readonly ClaimActionName[] = ["start_review", "approve", "reject", "close"];
const MIN_DESCRIPTION = 10;
const MAX_CREDIT = 100_000;

const text = (value: unknown, max: number) => (typeof value === "string" ? value.trim().slice(0, max) : "");

const invalidTransition = () =>
  conflict("invalid_transition", "This claim can't move to that status. Refresh and try again.");

// ---- reads ---------------------------------------------------------------------------------------

/** Warranty claims in the caller's scope. `q` matches claim id, serial, batch, model, customer and dealer. */
export function listClaims(ctx: Ctx, query: RawQuery = {}): Paginated<WarrantyClaimView> {
  const list = listQuery(query);
  const status = queryEnum(query, "status", CLAIM_STATUSES);
  const source = queryEnum(query, "source", CLAIM_SOURCES);
  const issueType = queryEnum(query, "issueType", ISSUE_TYPES);
  const rows = ctx.state.claims
    .filter(
      (c) =>
        canSee(ctx.user, c, ctx.state.dealers) &&
        (!status || c.status === status) &&
        (!source || c.source === source) &&
        (!issueType || c.issueType === issueType),
    )
    .map((c) => toClaimView(ctx.state, c, ctx.today))
    .filter((c) =>
      matches(list.q, c.id, c.unitSerial, c.batchNumber, c.modelCode, c.customerName, c.dealerName),
    );
  const keys: SortKeys<WarrantyClaimView> = {
    id: (c) => idOrder(c.id),
    unitSerial: (c) => c.unitSerial,
    source: (c) => c.source,
    status: (c) => c.status,
    issueType: (c) => c.issueType,
    resolution: (c) => c.resolution,
    creditAmount: (c) => c.creditAmount,
    raisedByName: (c) => c.raisedByName,
    createdAt: (c) => c.createdAt,
    updatedAt: (c) => c.updatedAt,
    dealerName: (c) => c.dealerName,
    customerName: (c) => c.customerName,
    modelCode: (c) => c.modelCode,
    modelName: (c) => c.modelName,
    categoryName: (c) => c.categoryName,
  };
  return paginate(
    sortRows(rows, list.sort, keys, "-createdAt", (c) => idOrder(c.id)),
    list,
  );
}

function findClaim(ctx: Ctx, id: string): WarrantyClaim {
  const claim = ctx.state.claims.find((c) => c.id === id);
  if (!claim || !canSee(ctx.user, claim, ctx.state.dealers)) throw notFound("Claim");
  return claim;
}

export const getClaim = (ctx: Ctx, id: string): WarrantyClaimView =>
  toClaimView(ctx.state, findClaim(ctx, id), ctx.today);

// ---- file a claim --------------------------------------------------------------------------------

/** A customer, dealer or the warranty desk files a claim on a registered product the caller can see. */
export function createClaim(
  ctx: Ctx,
  body: { unitSerial?: unknown; issueType?: unknown; description?: unknown; attachmentIds?: unknown },
): WarrantyClaimView {
  const { user, state } = ctx;
  const unit = findUnit(ctx, typeof body.unitSerial === "string" ? body.unitSerial : "");
  const attachmentIds = idList(body.attachmentIds) ?? [];
  const errors: Record<string, string> = {};
  const issueType = body.issueType as IssueType;
  if (!ISSUE_TYPES.includes(issueType)) errors.issueType = "validation.issueType";
  const description = text(body.description, 5000);
  if (description.length < MIN_DESCRIPTION) errors.description = "validation.describeFault";
  throwIfErrors(errors);
  if (!unit.warrantyEnd) {
    throw conflict("not_registered", "This product isn't registered yet.", {
      unitSerial: "claims.notRegistered",
    });
  }
  const open = state.claims.find((c) => c.unitSerial === unit.serial && isOpenClaim(c.status));
  if (open) {
    throw conflict("claim_open", `This product already has an open claim (${open.id}).`, {
      unitSerial: "claims.alreadyOpen",
    });
  }
  assertOwnAttachments(ctx, attachmentIds);

  const source: ClaimSource =
    user.role === "customer" ? "CUSTOMER" : user.role === "admin" ? "ADMIN" : "DEALER";
  const raisedByName = (user.role === "customer" && customerName(state, user.customerId)) || user.name;
  const claim: WarrantyClaim = {
    id: nextId(state, "CLM"),
    unitSerial: unit.serial,
    source,
    raisedBy: user.id,
    raisedByName,
    dealerId: unit.dealerId,
    customerId: unit.customerId,
    issueType,
    description,
    attachmentIds,
    status: "SUBMITTED",
    coverage: coverageFor(unit, ctx.today),
    createdAt: ctx.now,
    updatedAt: ctx.now,
    history: [{ at: ctx.now, status: "SUBMITTED", byName: raisedByName }],
  };
  state.claims.push(claim);
  addUnitEvent(unit, { at: ctx.now, type: "claim_filed", byName: raisedByName, refId: claim.id });
  notify(state, adminIds(state), "claim_submitted", ctx.now, {
    params: { id: claim.id, serial: unit.serial },
    link: `/claims/${claim.id}`,
  });
  return getClaim(ctx, claim.id);
}

// ---- warranty desk decisions ---------------------------------------------------------------------

/** Start review, approve (repair / replace / credit), reject with a reason, or close a settled claim. */
export function claimTransition(ctx: Ctx, id: string, body: ClaimActionInput): WarrantyClaimView {
  requireRole(ctx, "admin");
  const action = (typeof body.action === "string" ? body.action : "") as ClaimActionName;
  const claim = ctx.state.claims.find((c) => c.id === id);
  if (!claim) throw notFound("Claim");
  const to = ACTIONS.includes(action) ? nextClaimStatus(claim.status, action, "admin") : null;
  if (!to) throw invalidTransition();

  let eventText: string | undefined;
  let notifyKey: string | undefined;
  const params: Record<string, string> = { id: claim.id };

  if (action === "approve") {
    const resolution = body.resolution as Resolution;
    const errors: Record<string, string> = {};
    if (!RESOLUTIONS.includes(resolution)) errors.resolution = "validation.resolution";
    const amount = Number(body.creditAmount);
    const credit = resolution === "CREDIT";
    if (credit && (!Number.isFinite(amount) || amount <= 0 || amount > MAX_CREDIT))
      errors.creditAmount = "validation.amount";
    throwIfErrors(errors);
    claim.resolution = resolution;
    if (credit) claim.creditAmount = Number(amount.toFixed(2));
    else delete claim.creditAmount;
    const note = text(body.note, 2000);
    if (note) claim.decisionNote = note;
    else delete claim.decisionNote;
    eventText = note || undefined;
    notifyKey = "claim_approved";
    params.resolution = resolution;
  }
  if (action === "reject") {
    const reason = text(body.reason, 1000);
    if (!reason) throw validation("Give a reason.", { reason: "validation.reasonRequired" });
    claim.rejectReason = reason;
    eventText = reason;
    notifyKey = "claim_rejected";
    params.reason = reason;
  }
  if (action === "close") {
    eventText = settle(ctx, claim, body);
    notifyKey = "claim_closed";
    params.resolution = claim.resolution ?? "";
  }

  claim.status = to;
  claim.updatedAt = ctx.now;
  claim.reviewedByName = ctx.user.name;
  claim.history.push({ at: ctx.now, status: to, byName: ctx.user.name, text: eventText });
  if (notifyKey) {
    notify(ctx.state, followers(ctx.state, claim), notifyKey, ctx.now, { params, link: `/claims/${id}` });
  }
  return getClaim(ctx, id);
}

/**
 * Closing settles the claim: a replacement registers the new serial with the rest of the original warranty
 * [CONFIRM replacement warranty rule]; a credit is posted to Finance; a repair just closes.
 */
function settle(ctx: Ctx, claim: WarrantyClaim, body: ClaimActionInput): string | undefined {
  const { state } = ctx;
  const unit = state.units.find((u) => u.serial === claim.unitSerial);
  const model = state.models.find((m) => m.id === unit?.modelId);
  if (!unit || !model) throw notFound("Product");
  if (claim.resolution === "REPLACE") {
    const serial = normalizeSerialValue(
      typeof body.replacementSerial === "string" ? body.replacementSerial : "",
    );
    const batch = normalizeBatchValue(
      typeof body.replacementBatchNumber === "string" ? body.replacementBatchNumber : "",
    );
    const format = modelFormat(model);
    const errors: Record<string, string> = {};
    if (!serial) errors.replacementSerial = "validation.required";
    else if (!SERIAL_PATTERN.test(serial) || !format.serial.test(serial) || serial === unit.serial)
      errors.replacementSerial = "rowErrors.invalid_serial";
    if (batch && !format.batch.test(batch)) errors.replacementBatchNumber = "rowErrors.invalid_batch";
    throwIfErrors(errors);

    const existing = state.units.find((u) => u.serial === serial);
    if (existing?.warrantyEnd) {
      throw conflict("duplicate_serial", "That serial is already registered to another product.", {
        replacementSerial: "rowErrors.duplicate_serial",
      });
    }
    const originalEnd = unit.warrantyEnd && unit.warrantyEnd > ctx.today ? unit.warrantyEnd : ctx.today;
    const replacement: Unit = existing ?? { serial, modelId: unit.modelId, attachmentIds: [], history: [] };
    Object.assign(replacement, {
      batchNumber: batch || undefined,
      modelId: unit.modelId,
      dealerId: unit.dealerId,
      customerId: unit.customerId,
      purchaseDate: unit.purchaseDate,
      placeOfPurchase: unit.placeOfPurchase,
      warrantyStart: ctx.today,
      warrantyEnd: originalEnd,
      replacesSerial: unit.serial,
    });
    if (!existing) state.units.push(replacement);
    unit.replacedBySerial = serial;
    addUnitEvent(unit, {
      at: ctx.now,
      type: "replaced",
      byName: ctx.user.name,
      text: `Replaced by ${serial} under claim ${claim.id}`,
      refId: claim.id,
    });
    addUnitEvent(replacement, {
      at: ctx.now,
      type: "registered",
      byName: ctx.user.name,
      text: `Replacement for ${unit.serial}, covered until ${originalEnd}`,
      refId: claim.id,
    });
    claim.replacementSerial = serial;
    if (batch) claim.replacementBatchNumber = batch;
    else delete claim.replacementBatchNumber;
  }
  if (claim.resolution === "CREDIT") {
    logMessage(ctx, {
      system: "FINANCE",
      direction: "OUT",
      type: "credit_memo",
      refId: claim.id,
      payload: {
        claimId: claim.id,
        serial: unit.serial,
        model: model.code,
        amount: claim.creditAmount,
        currency: "USD",
        account: "Warranty credits",
        customerId: claim.customerId,
        dealerId: claim.dealerId,
      },
    });
  }
  addUnitEvent(unit, {
    at: ctx.now,
    type: "claim_closed",
    byName: ctx.user.name,
    text: claim.resolution,
    refId: claim.id,
  });
  return text(body.note, 2000) || undefined;
}

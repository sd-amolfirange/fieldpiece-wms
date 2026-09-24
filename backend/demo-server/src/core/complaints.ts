import {
  currentPart,
  entitlementFor,
  nextClaimStatus,
  replacePart,
  type Claim,
  type ClaimActionName,
  type ClaimActor,
  type ClaimView,
  type Complaint,
  type ComplaintSource,
  type ComplaintView,
  type Entitlement,
  type IntegrationMessage,
  type JobResult,
  type PartType,
  type UnitView,
  type VoidReason,
  VOID_REASONS,
} from "@wms/domain";
import {
  assertOwnAttachments,
  findUnit,
  getClaim,
  getComplaint,
  getUnit,
  notFound,
  notify,
  requireRole,
  ServiceError,
  type Ctx,
} from "./services";
import { nextId, type DemoState } from "./state";

// Complaint -> service -> job result -> manufacturer claim (W3), for the Phase 3 screens. Mock API: minimal rules.
// - The WMS decides entitlement when the complaint is raised (parts / labour covered or chargeable).
// - A job result replaces the part (its new warranty starts that day) and auto-creates a Draft claim when the
//   complaint is claimable. Void or fully chargeable complaints never create a claim.
// - Every exchange with the service system, OEM and Finance is written to the integration log.

const adminIds = (state: DemoState) => state.users.filter((u) => u.role === "admin").map((u) => u.id);

/** Users who follow a complaint: the unit's customer and the selling dealer (and its distributor). */
function followers(state: DemoState, c: Pick<Complaint, "customerId" | "dealerId">) {
  const dealer = state.dealers.find((d) => d.id === c.dealerId);
  return state.users
    .filter(
      (u) =>
        (c.customerId && u.customerId === c.customerId) ||
        (c.dealerId && u.dealerId === c.dealerId) ||
        (dealer?.distributorId && u.distributorId === dealer.distributorId),
    )
    .map((u) => u.id);
}

// ---- void warranty (W5) -----------------------------------------------------------------------------------

/** Admin voids a unit's warranty with a reason and note; recorded with user and date in the unit history. */
export function voidWarranty(ctx: Ctx, serial: string, body: { reason?: string; note?: string }): UnitView {
  requireRole(ctx, "admin");
  const unit = findUnit(ctx, serial);
  const reason = body.reason as VoidReason;
  if (!VOID_REASONS.includes(reason)) {
    throw new ServiceError(422, "validation_error", "Choose a reason.", { reason: "validation.voidReason" });
  }
  if (unit.void) throw new ServiceError(409, "already_void", "This warranty is already void.");
  if (!unit.parts.length) throw new ServiceError(409, "not_registered", "This unit isn't registered yet.");
  const note = body.note?.trim() || undefined;
  unit.void = { reason, note, by: ctx.user.id, byName: ctx.user.name, at: ctx.now };
  unit.history.push({ at: ctx.now, type: "voided", byName: ctx.user.name, reason, text: note });
  notify(ctx.state, followers(ctx.state, unit), "unit_voided", ctx.now, {
    params: { serial: unit.serial },
    link: `/units/${unit.serial}`,
  });
  return getUnit(ctx, unit.serial);
}

export function logMessage(
  ctx: Ctx,
  message: Pick<IntegrationMessage, "system" | "direction" | "type" | "payload" | "refId"> &
    Partial<Pick<IntegrationMessage, "status" | "lastError">>,
): IntegrationMessage {
  const entry: IntegrationMessage = {
    id: nextId(ctx.state, "MSG"),
    status: "SUCCESS",
    attempts: 1,
    createdAt: ctx.now,
    updatedAt: ctx.now,
    ...message,
  };
  ctx.state.integrations.push(entry);
  return entry;
}

const PART_NAMES: Record<PartType, string> = { UNIT: "unit", COMPRESSOR: "compressor", PCB: "PCB" };

// ---- raise and preview --------------------------------------------------------------------------------

export function previewEntitlement(ctx: Ctx, serial: string): Entitlement {
  return entitlementFor(findUnit(ctx, serial), ctx.today);
}

export function createComplaint(
  ctx: Ctx,
  body: { unitSerial?: string; description?: string; attachmentIds?: string[] },
): ComplaintView {
  const { state, user } = ctx;
  const unit = findUnit(ctx, body.unitSerial ?? "");
  const description = body.description?.trim() ?? "";
  if (description.length < 5) {
    throw new ServiceError(422, "validation_error", "Describe the fault.", { description: "validation.describeFault" });
  }
  if (!unit.parts.length) {
    throw new ServiceError(409, "not_registered", "This unit isn't registered yet.", {
      unitSerial: "complaints.notRegistered",
    });
  }
  assertOwnAttachments(ctx, body.attachmentIds);

  const source: ComplaintSource = user.role === "customer" ? "CUSTOMER" : user.role === "admin" ? "ADMIN" : "DEALER";
  const raisedByName =
    user.role === "customer" ? (state.customers.find((c) => c.id === user.customerId)?.name ?? user.name) : user.name;
  const complaint: Complaint = {
    id: nextId(state, "CMP"),
    unitSerial: unit.serial,
    source,
    raisedBy: user.id,
    raisedByName,
    dealerId: unit.dealerId,
    customerId: unit.customerId,
    description,
    attachmentIds: body.attachmentIds ?? [],
    status: "NEW",
    entitlement: entitlementFor(unit, ctx.today),
    createdAt: ctx.now,
    history: [{ at: ctx.now, status: "NEW", byName: raisedByName }],
  };
  state.complaints.push(complaint);
  unit.history.push({ at: ctx.now, type: "complaint_raised", byName: raisedByName, refId: complaint.id });
  notify(state, adminIds(state), "complaint_raised", ctx.now, {
    params: { id: complaint.id, serial: unit.serial },
    link: `/complaints/${complaint.id}`,
  });
  return getComplaint(ctx, complaint.id);
}

// ---- hand-off to the service system ---------------------------------------------------------------------

function findComplaint(ctx: Ctx, id: string): Complaint {
  const complaint = ctx.state.complaints.find((c) => c.id === id);
  if (!complaint) throw notFound("Complaint");
  return complaint;
}

export function sendToService(ctx: Ctx, id: string): ComplaintView {
  requireRole(ctx, "admin");
  const complaint = findComplaint(ctx, id);
  if (complaint.status !== "NEW") {
    throw new ServiceError(409, "already_sent", "This complaint is already with the service system.");
  }
  const { state } = ctx;
  const unit = state.units.find((u) => u.serial === complaint.unitSerial);
  const model = state.models.find((m) => m.id === unit?.modelId);
  const customer = state.customers.find((c) => c.id === complaint.customerId);
  // Voided after the complaint was raised: the visit is now chargeable.
  if (unit?.void) complaint.entitlement = entitlementFor(unit, ctx.today);
  complaint.serviceRequestId = nextId(state, "SR");
  complaint.status = "WITH_SERVICE";
  complaint.history.push({ at: ctx.now, status: "WITH_SERVICE", byName: ctx.user.name });
  logMessage(ctx, {
    system: "SERVICE",
    direction: "OUT",
    type: "service_request",
    refId: complaint.id,
    payload: {
      serviceRequestId: complaint.serviceRequestId,
      complaintId: complaint.id,
      unit: { serial: complaint.unitSerial, model: model?.code, location: unit?.location },
      parts: (unit?.parts ?? [])
        .filter((p) => !p.replacedAt)
        .map((p) => ({ partType: p.partType, serial: p.serial, warrantyEnd: p.warrantyEnd })),
      entitlement: complaint.entitlement,
      customer: customer ? { name: customer.name, phone: customer.phone, city: customer.city } : undefined,
      fault: complaint.description,
    },
  });
  notify(state, followers(state, complaint), "complaint_with_service", ctx.now, {
    params: { id: complaint.id },
    link: `/complaints/${complaint.id}`,
  });
  return getComplaint(ctx, id);
}

// ---- simulator: job result from the service system -------------------------------------------------------

/** Placeholder job photo (SVG) that the adapters store as an attachment. */
export function jobPhotoSvg(caption: string, serial: string): string {
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480" viewBox="0 0 640 480">
<rect width="640" height="480" fill="#e8e8e9"/><rect x="170" y="110" width="300" height="220" rx="24" fill="#8e8e8c"/>
<circle cx="320" cy="220" r="70" fill="#5e5e5c"/><text x="320" y="400" font-family="sans-serif" font-size="28" text-anchor="middle" fill="#12130d">${esc(caption)}</text>
<text x="320" y="440" font-family="monospace" font-size="22" text-anchor="middle" fill="#3e3e3e">${esc(serial)}</text></svg>`;
}

/** Which part the simulated technician replaces: the first covered key part, otherwise the compressor. */
export function partToReplace(complaint: Complaint, requested?: PartType): Exclude<PartType, "UNIT"> {
  if (requested && requested !== "UNIT") return requested;
  const covered = complaint.entitlement.coveredPartTypes.find((p): p is "COMPRESSOR" | "PCB" => p !== "UNIT");
  return covered ?? "COMPRESSOR";
}

/** Serials for the simulated job: the part coming out and the one going in. */
export function jobSerials(ctx: Ctx, complaintId: string, requested?: PartType) {
  const complaint = findComplaint(ctx, complaintId);
  const unit = ctx.state.units.find((u) => u.serial === complaint.unitSerial);
  const partType = partToReplace(complaint, requested);
  const old = unit ? currentPart(unit, partType) : undefined;
  const seq = (ctx.state.counters.NEWPART ?? 0) + 1;
  const newSerial = `${partType === "PCB" ? "PCB" : "CP"}-${ctx.today.replace(/-/g, "").slice(2)}-${String(seq).padStart(2, "0")}`;
  return { partType, oldSerial: old?.serial, newSerial };
}

export function simulateJobResult(
  ctx: Ctx,
  body: { complaintId?: string; partType?: PartType },
  photoIds: string[],
): ComplaintView {
  requireRole(ctx, "admin");
  const { state } = ctx;
  const complaint = findComplaint(ctx, body.complaintId ?? "");
  if (complaint.status !== "WITH_SERVICE") {
    throw new ServiceError(409, "not_with_service", "Send the complaint to the service system first.");
  }
  const unit = state.units.find((u) => u.serial === complaint.unitSerial);
  const model = state.models.find((m) => m.id === unit?.modelId);
  if (!unit || !model) throw notFound("Unit");

  const { partType, oldSerial, newSerial } = jobSerials(ctx, complaint.id, body.partType);
  state.counters.NEWPART = (state.counters.NEWPART ?? 0) + 1;
  const line = model.parts.find((p) => p.partType === partType);
  if (!line) throw new ServiceError(409, "no_such_part", "This model has no such part.");

  // The new part's warranty starts on the repair day.
  unit.parts = replacePart(unit.parts, line, { newSerial, date: ctx.today, newId: `${unit.serial}-${partType.toLowerCase()}-${newSerial}` });
  unit.history.push({
    at: ctx.now,
    type: "part_replaced",
    byName: "Service system",
    text: `${PART_NAMES[partType]}: ${oldSerial ?? "-"} -> ${newSerial}`,
    refId: complaint.id,
  });

  const customer = state.customers.find((c) => c.id === complaint.customerId);
  const job: JobResult = {
    id: nextId(state, "JOB"),
    complaintId: complaint.id,
    technician: "S. Pawar (CoolFix Services)",
    completedAt: ctx.now,
    partsReplaced: [{ partType, oldSerial, newSerial }],
    photoIds,
    signOffName: customer?.name ?? "Customer",
    notes: `Replaced the ${PART_NAMES[partType]}, recharged gas, tested: cooling normal.`,
  };
  state.jobResults.push(job);
  complaint.jobResultId = job.id;
  complaint.status = "RESOLVED";
  complaint.history.push({ at: ctx.now, status: "RESOLVED", byName: "Service system" });
  logMessage(ctx, {
    system: "SERVICE",
    direction: "IN",
    type: "job_result",
    refId: complaint.id,
    payload: { serviceRequestId: complaint.serviceRequestId, ...job },
  });

  const newPart = unit.parts.find((p) => p.serial === newSerial);
  notify(state, followers(state, complaint), "complaint_resolved", ctx.now, {
    params: { id: complaint.id, part: PART_NAMES[partType], date: newPart?.warrantyEnd ?? "" },
    link: `/complaints/${complaint.id}`,
  });

  // Draft claim with the evidence from the job result, only when something was covered. Never on a void unit.
  if (unit?.void) complaint.entitlement = entitlementFor(unit, ctx.today);
  if (complaint.entitlement.claimable) {
    const claim: Claim = {
      id: nextId(state, "CLM"),
      complaintId: complaint.id,
      unitSerial: unit.serial,
      brandId: unit.brandId,
      dealerId: unit.dealerId,
      status: "DRAFT",
      jobResultId: job.id,
      photoIds: job.photoIds,
      partsReplaced: job.partsReplaced,
      financePosting: "NOT_POSTED",
      createdAt: ctx.now,
      updatedAt: ctx.now,
      history: [{ at: ctx.now, status: "DRAFT", byName: "System (from job result)" }],
    };
    state.claims.push(claim);
    complaint.claimId = claim.id;
    unit.history.push({ at: ctx.now, type: "claim_created", byName: "System", refId: claim.id });
    notify(state, adminIds(state), "claim_draft_created", ctx.now, {
      params: { id: claim.id, serial: unit.serial },
      link: `/claims/${claim.id}`,
    });
  }
  return getComplaint(ctx, complaint.id);
}

// ---- claim actions and settlement ---------------------------------------------------------------------

function findClaim(ctx: Ctx, id: string): Claim {
  const claim = ctx.state.claims.find((c) => c.id === id);
  if (!claim) throw notFound("Claim");
  return claim;
}

function applyClaimAction(
  ctx: Ctx,
  claim: Claim,
  action: ClaimActionName,
  actor: ClaimActor,
  input: { rmaNumber?: string; amount?: number; reason?: string },
) {
  const to = nextClaimStatus(claim.status, action, actor);
  if (!to) throw new ServiceError(409, "invalid_transition", "This claim can't move to that status. Refresh and try again.");
  const brand = ctx.state.brands.find((b) => b.id === claim.brandId)?.name;
  const byName = actor === "system" ? "OEM (simulated)" : ctx.user.name;

  if (action === "submit") {
    const amount = Number(input.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new ServiceError(422, "validation_error", "Enter the claim amount.", { amount: "validation.amount" });
    }
    claim.amount = Math.round(amount);
    claim.rmaNumber = input.rmaNumber?.trim() || undefined;
    logMessage(ctx, {
      system: "OEM",
      direction: "OUT",
      type: "claim_submission",
      refId: claim.id,
      payload: {
        claimId: claim.id,
        brand,
        rmaNumber: claim.rmaNumber,
        amount: claim.amount,
        unitSerial: claim.unitSerial,
        partsReplaced: claim.partsReplaced,
        jobResultId: claim.jobResultId,
        photos: claim.photoIds.length,
      },
    });
  }
  if (action === "reject") {
    const reason = input.reason?.trim();
    if (!reason) throw new ServiceError(422, "validation_error", "Give a reason.", { reason: "validation.reasonRequired" });
    claim.rejectReason = reason;
  }
  if (action === "mark_paid") {
    claim.financePosting = "POSTED";
    logMessage(ctx, {
      system: "FINANCE",
      direction: "OUT",
      type: "finance_posting",
      refId: claim.id,
      payload: { claimId: claim.id, brand, amount: claim.amount, account: "Warranty recoveries receivable", postedAt: ctx.now },
    });
  }
  claim.status = to;
  claim.updatedAt = ctx.now;
  claim.history.push({ at: ctx.now, status: to, byName, text: action === "reject" ? claim.rejectReason : undefined });
}

export function claimTransition(
  ctx: Ctx,
  id: string,
  body: { action?: ClaimActionName; rmaNumber?: string; amount?: number; reason?: string },
): ClaimView {
  requireRole(ctx, "admin");
  const claim = findClaim(ctx, id);
  applyClaimAction(ctx, claim, body.action ?? "submit", "admin", body);
  return getClaim(ctx, id);
}

/** Simulator: the manufacturer approves or rejects a submitted claim. */
export function simulateOemDecision(
  ctx: Ctx,
  body: { claimId?: string; decision?: "APPROVED" | "REJECTED"; reason?: string },
): ClaimView {
  requireRole(ctx, "admin");
  const claim = findClaim(ctx, body.claimId ?? "");
  const approve = body.decision !== "REJECTED";
  const reason = approve ? undefined : body.reason?.trim() || "Rejected by the manufacturer.";
  applyClaimAction(ctx, claim, approve ? "approve" : "reject", "system", { reason });
  logMessage(ctx, {
    system: "OEM",
    direction: "IN",
    type: "oem_decision",
    refId: claim.id,
    payload: { claimId: claim.id, rmaNumber: claim.rmaNumber, decision: approve ? "APPROVED" : "REJECTED", reason },
  });
  notify(ctx.state, adminIds(ctx.state), approve ? "claim_approved_by_oem" : "claim_rejected_by_oem", ctx.now, {
    params: { id: claim.id },
    link: `/claims/${claim.id}`,
  });
  return getClaim(ctx, claim.id);
}

// ---- integration log ------------------------------------------------------------------------------------

export function retryIntegration(ctx: Ctx, id: string): IntegrationMessage {
  requireRole(ctx, "admin");
  const message = ctx.state.integrations.find((m) => m.id === id);
  if (!message) throw notFound("Message");
  if (message.status !== "FAILED") throw new ServiceError(409, "not_failed", "Only failed messages can be retried.");
  message.attempts += 1;
  message.status = "SUCCESS";
  message.lastError = undefined;
  message.updatedAt = ctx.now;
  return message;
}

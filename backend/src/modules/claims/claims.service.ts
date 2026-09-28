import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
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
  type ClaimStatus,
  type IssueType,
  type Paginated,
  type Resolution,
  type WarrantyClaimView,
} from "@wms/domain";
import type { Ctx } from "../../common/auth/context";
import { fromDbDate, toDbDate } from "../../common/db/dates";
import { nextId } from "../../common/db/ids";
import { AppError } from "../../common/errors/app-error";
import { listQuery, pageArgs, queryEnum, type RawQuery, resolveSort } from "../../common/http/list-query";
import { type Db, PrismaService, type Tx } from "../../infra/prisma/prisma.service";
import { canSee, requireRole, scopeWhere } from "../../domain/scope";
import { claimInclude, type ClaimRow, toClaimView, toUnit } from "../../domain/views";
import { FilesService } from "../files";
import { IntegrationLog, toJson } from "../integrations";
import { Notifier } from "../notifications";
import { UnitsRepository, UnitsService } from "../units";

// Warranty claims (A07-A10, CU04/CU05, DL06/DL07). Customers and dealers file claims on registered products; the
// Fieldpiece warranty desk (admin) reviews them against the product's coverage and settles them by repair,
// replacement or credit. Status steps come only from shared/wms-domain/src/claim-transitions.ts.

export interface ClaimActionInput {
  action?: unknown;
  resolution?: unknown;
  creditAmount?: unknown;
  reason?: unknown;
  note?: unknown;
  replacementSerial?: unknown;
  replacementBatchNumber?: unknown;
}

type OrderBy = Prisma.WarrantyClaimOrderByWithRelationInput;
const SORTS: Record<string, (dir: Prisma.SortOrder) => OrderBy> = {
  id: (dir) => ({ id: dir }),
  unitSerial: (dir) => ({ unitSerial: dir }),
  source: (dir) => ({ source: dir }),
  status: (dir) => ({ status: dir }),
  issueType: (dir) => ({ issueType: dir }),
  resolution: (dir) => ({ resolution: dir }),
  creditAmount: (dir) => ({ creditAmount: dir }),
  raisedByName: (dir) => ({ raisedByName: dir }),
  createdAt: (dir) => ({ createdAt: dir }),
  updatedAt: (dir) => ({ updatedAt: dir }),
  dealerName: (dir) => ({ dealer: { name: dir } }),
  customerName: (dir) => ({ customer: { name: dir } }),
  modelCode: (dir) => ({ unit: { model: { code: dir } } }),
  modelName: (dir) => ({ unit: { model: { name: dir } } }),
  categoryName: (dir) => ({ unit: { model: { category: { name: dir } } } }),
};

const ACTIONS: readonly ClaimActionName[] = ["start_review", "approve", "reject", "close"];
const MIN_DESCRIPTION = 10;
const MAX_CREDIT = 100_000;

const text = (value: unknown, max: number) => (typeof value === "string" ? value.trim().slice(0, max) : "");

@Injectable()
export class ClaimsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly units: UnitsService,
    private readonly unitRows: UnitsRepository,
    private readonly files: FilesService,
    private readonly integrations: IntegrationLog,
    private readonly notifier: Notifier,
  ) {}

  // ── Reads ──────────────────────────────────────────────────────────────────

  async list(ctx: Ctx, query: RawQuery): Promise<Paginated<WarrantyClaimView>> {
    const list = listQuery(query);
    const q = list.q;
    const where: Prisma.WarrantyClaimWhereInput = {
      ...scopeWhere(ctx.user),
      status: queryEnum(query, "status", CLAIM_STATUSES),
      source: queryEnum(query, "source", CLAIM_SOURCES),
      issueType: queryEnum(query, "issueType", ISSUE_TYPES),
      ...(q
        ? {
            OR: [
              { id: { contains: q, mode: "insensitive" } },
              { unitSerial: { contains: q, mode: "insensitive" } },
              { unit: { batchNumber: { contains: q, mode: "insensitive" } } },
              { unit: { model: { code: { contains: q, mode: "insensitive" } } } },
              { customer: { name: { contains: q, mode: "insensitive" } } },
              { dealer: { name: { contains: q, mode: "insensitive" } } },
            ],
          }
        : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.warrantyClaim.count({ where }),
      this.prisma.warrantyClaim.findMany({
        where,
        include: claimInclude,
        orderBy: [resolveSort(list.sort, SORTS, "-createdAt"), { id: "asc" }],
        ...pageArgs(list),
      }),
    ]);
    return {
      items: await this.views(this.prisma, ctx, rows),
      total,
      page: list.page,
      pageSize: list.pageSize,
    };
  }

  async counts(ctx: Ctx): Promise<Record<ClaimStatus, number>> {
    const groups = await this.prisma.warrantyClaim.groupBy({
      by: ["status"],
      where: scopeWhere(ctx.user),
      _count: true,
    });
    const counts = Object.fromEntries(CLAIM_STATUSES.map((s) => [s, 0])) as Record<ClaimStatus, number>;
    for (const g of groups) counts[g.status as ClaimStatus] = g._count;
    return counts;
  }

  async get(ctx: Ctx, id: string, db: Db = this.prisma): Promise<WarrantyClaimView> {
    const row = await db.warrantyClaim.findUnique({ where: { id }, include: claimInclude });
    if (!row || !canSee(ctx.user, row)) throw AppError.notFound("Claim");
    const [view] = await this.views(db, ctx, [row]);
    return view!;
  }

  // ── File a claim ───────────────────────────────────────────────────────────

  /** A customer, dealer or the warranty desk files a claim on a registered product the caller can see. */
  async create(
    ctx: Ctx,
    body: { unitSerial?: unknown; issueType?: unknown; description?: unknown; attachmentIds?: unknown },
  ): Promise<WarrantyClaimView> {
    const { user } = ctx;
    const serial = typeof body.unitSerial === "string" ? body.unitSerial : "";
    const attachmentIds = Array.isArray(body.attachmentIds)
      ? body.attachmentIds.filter((id): id is string => typeof id === "string").slice(0, 20)
      : [];
    const id = await this.prisma.tx(async (tx) => {
      const unit = await this.units.findVisible(tx, ctx, serial);
      const errors: Record<string, string> = {};
      const issueType = body.issueType as IssueType;
      if (!ISSUE_TYPES.includes(issueType)) errors.issueType = "validation.issueType";
      const description = text(body.description, 5000);
      if (description.length < MIN_DESCRIPTION) errors.description = "validation.describeFault";
      if (Object.keys(errors).length) throw AppError.validation("Check the highlighted fields.", errors);
      if (!unit.warrantyEnd) {
        throw AppError.conflict("not_registered", "This product isn't registered yet.", {
          unitSerial: "claims.notRegistered",
        });
      }
      await this.unitRows.lock(tx, unit.serial);
      const open = await tx.warrantyClaim.findFirst({
        where: { unitSerial: unit.serial, status: { in: ["SUBMITTED", "IN_REVIEW", "APPROVED"] } },
        select: { id: true },
      });
      if (open) {
        throw AppError.conflict("claim_open", `This product already has an open claim (${open.id}).`, {
          unitSerial: "claims.alreadyOpen",
        });
      }
      await this.files.assertOwn(tx, user, attachmentIds);

      const source: ClaimSource =
        user.role === "customer" ? "CUSTOMER" : user.role === "admin" ? "ADMIN" : "DEALER";
      const raisedByName =
        user.role === "customer" && user.customerId
          ? ((await tx.customer.findUnique({ where: { id: user.customerId } }))?.name ?? user.name)
          : user.name;
      const claimId = await nextId(tx, "CLM");
      await tx.warrantyClaim.create({
        data: {
          id: claimId,
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
          coverage: toJson(coverageFor(toUnit(unit), ctx.today)),
          createdAt: ctx.now,
          updatedAt: ctx.now,
          events: { create: { at: ctx.now, status: "SUBMITTED", byName: raisedByName } },
        },
      });
      await this.units.addEvent(tx, unit.serial, {
        at: ctx.now,
        type: "claim_filed",
        byName: raisedByName,
        refId: claimId,
      });
      await this.notifier.notify(tx, await this.notifier.adminIds(tx), "claim_submitted", ctx.now, {
        params: { id: claimId, serial: unit.serial },
        link: `/claims/${claimId}`,
      });
      return claimId;
    });
    return this.get(ctx, id);
  }

  // ── Warranty desk decisions ────────────────────────────────────────────────

  /** Start review, approve (repair / replace / credit), reject with a reason, or close a settled claim. */
  async transition(ctx: Ctx, id: string, body: ClaimActionInput): Promise<WarrantyClaimView> {
    requireRole(ctx.user, "admin");
    const action = (typeof body.action === "string" ? body.action : "") as ClaimActionName;
    await this.prisma.tx(async (tx) => {
      await tx.$queryRaw`SELECT id FROM warranty_claims WHERE id = ${id} FOR UPDATE`;
      const claim = await tx.warrantyClaim.findUnique({
        where: { id },
        include: { unit: { include: { model: true } } },
      });
      if (!claim) throw AppError.notFound("Claim");
      const from = claim.status as ClaimStatus;
      const to = ACTIONS.includes(action) ? nextClaimStatus(from, action, "admin") : null;
      if (!to) {
        throw AppError.conflict(
          "invalid_transition",
          "This claim can't move to that status. Refresh and try again.",
        );
      }
      const data: Prisma.WarrantyClaimUpdateInput = {
        status: to,
        updatedAt: ctx.now,
        reviewedByName: ctx.user.name,
      };
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
        if (Object.keys(errors).length) throw AppError.validation("Check the highlighted fields.", errors);
        data.resolution = resolution;
        data.creditAmount = credit ? new Prisma.Decimal(amount.toFixed(2)) : null;
        data.decisionNote = text(body.note, 2000) || null;
        eventText = data.decisionNote ?? undefined;
        notifyKey = "claim_approved";
        params.resolution = resolution;
      }
      if (action === "reject") {
        const reason = text(body.reason, 1000);
        if (!reason) throw AppError.validation("Give a reason.", { reason: "validation.reasonRequired" });
        data.rejectReason = reason;
        eventText = reason;
        notifyKey = "claim_rejected";
        params.reason = reason;
      }
      if (action === "close") {
        eventText = await this.settle(tx, ctx, claim, body, data);
        notifyKey = "claim_closed";
        params.resolution = claim.resolution ?? "";
      }

      // Compare-and-set: if someone else moved the claim meanwhile, nothing is updated and this request fails.
      const updated = await tx.warrantyClaim.updateMany({
        where: { id, status: from },
        data: data,
      });
      if (!updated.count) {
        throw AppError.conflict(
          "invalid_transition",
          "This claim can't move to that status. Refresh and try again.",
        );
      }
      await tx.warrantyClaimEvent.create({
        data: { claimId: id, at: ctx.now, status: to, byName: ctx.user.name, text: eventText },
      });
      if (notifyKey) {
        await this.notifier.notify(tx, await this.notifier.followers(tx, claim), notifyKey, ctx.now, {
          params,
          link: `/claims/${id}`,
        });
      }
    });
    return this.get(ctx, id);
  }

  /**
   * Closing settles the claim: a replacement registers the new serial with the rest of the original warranty
   * [CONFIRM replacement warranty rule]; a credit is posted to Finance; a repair just closes.
   */
  private async settle(
    tx: Tx,
    ctx: Ctx,
    claim: Prisma.WarrantyClaimGetPayload<{ include: { unit: { include: { model: true } } } }>,
    body: ClaimActionInput,
    data: Prisma.WarrantyClaimUpdateInput,
  ): Promise<string | undefined> {
    const unit = claim.unit;
    if (claim.resolution === "REPLACE") {
      const serial = normalizeSerialValue(
        typeof body.replacementSerial === "string" ? body.replacementSerial : "",
      );
      const batch = normalizeBatchValue(
        typeof body.replacementBatchNumber === "string" ? body.replacementBatchNumber : "",
      );
      const format = modelFormat(unit.model);
      const errors: Record<string, string> = {};
      if (!serial) errors.replacementSerial = "validation.required";
      else if (!SERIAL_PATTERN.test(serial) || !format.serial.test(serial) || serial === unit.serial)
        errors.replacementSerial = "rowErrors.invalid_serial";
      if (batch && !format.batch.test(batch)) errors.replacementBatchNumber = "rowErrors.invalid_batch";
      if (Object.keys(errors).length) throw AppError.validation("Check the highlighted fields.", errors);

      await this.unitRows.lock(tx, serial);
      const existing = await tx.unit.findUnique({ where: { serial } });
      if (existing?.warrantyEnd) {
        throw AppError.conflict("duplicate_serial", "That serial is already registered to another product.", {
          replacementSerial: "rowErrors.duplicate_serial",
        });
      }
      const today = toDbDate(ctx.today);
      const originalEnd = unit.warrantyEnd && unit.warrantyEnd > today ? unit.warrantyEnd : today;
      const replacement = {
        batchNumber: batch || null,
        modelId: unit.modelId,
        dealerId: unit.dealerId,
        customerId: unit.customerId,
        purchaseDate: unit.purchaseDate,
        placeOfPurchase: unit.placeOfPurchase,
        warrantyStart: today,
        warrantyEnd: originalEnd,
        replacesSerial: unit.serial,
      };
      if (existing) await tx.unit.update({ where: { serial }, data: replacement });
      else await tx.unit.create({ data: { serial, attachmentIds: [], ...replacement } });
      await tx.unit.update({ where: { serial: unit.serial }, data: { replacedBySerial: serial } });
      await this.units.addEvent(tx, unit.serial, {
        at: ctx.now,
        type: "replaced",
        byName: ctx.user.name,
        text: `Replaced by ${serial} under claim ${claim.id}`,
        refId: claim.id,
      });
      await this.units.addEvent(tx, serial, {
        at: ctx.now,
        type: "registered",
        byName: ctx.user.name,
        text: `Replacement for ${unit.serial}, covered until ${fromDbDate(originalEnd)}`,
        refId: claim.id,
      });
      data.replacementSerial = serial;
      data.replacementBatchNumber = batch || null;
    }
    if (claim.resolution === "CREDIT") {
      await this.integrations.log(
        tx,
        {
          system: "FINANCE",
          direction: "OUT",
          type: "credit_memo",
          refId: claim.id,
          payload: {
            claimId: claim.id,
            serial: unit.serial,
            model: unit.model.code,
            amount: Number(claim.creditAmount),
            currency: "USD",
            account: "Warranty credits",
            customerId: claim.customerId,
            dealerId: claim.dealerId,
          },
        },
        ctx.now,
      );
    }
    await this.units.addEvent(tx, unit.serial, {
      at: ctx.now,
      type: "claim_closed",
      byName: ctx.user.name,
      text: claim.resolution ?? undefined,
      refId: claim.id,
    });
    return text(body.note, 2000) || undefined;
  }

  // ── Dashboards ─────────────────────────────────────────────────────────────

  /** Open claims (filed, not yet decided or closed) in the caller's scope. */
  openClaimsWhere(extra: Prisma.WarrantyClaimWhereInput = {}): Prisma.WarrantyClaimWhereInput {
    return { ...extra, status: { in: CLAIM_STATUSES.filter(isOpenClaim) } };
  }

  private async views(db: Db, ctx: Pick<Ctx, "today">, rows: ClaimRow[]): Promise<WarrantyClaimView[]> {
    const attachments = await this.files.byIds(
      db,
      rows.flatMap((r) => r.attachmentIds),
    );
    return rows.map((r) => toClaimView(r, attachments, { fileUrl: this.files.fileUrl, today: ctx.today }));
  }
}

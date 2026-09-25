import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import {
  CLAIM_STATUSES,
  nextClaimStatus,
  type ClaimActionName,
  type ClaimActor,
  type ClaimStatus,
  type ClaimView,
  type Paginated,
  type ReplacedPart,
} from "@wms/domain";
import type { Ctx } from "../../common/auth/context";
import { nextId } from "../../common/db/ids";
import { AppError } from "../../common/errors/app-error";
import { listQuery, pageArgs, queryEnum, queryString, type RawQuery, resolveSort } from "../../common/http/list-query";
import { type Db, PrismaService, type Tx } from "../../infra/prisma/prisma.service";
import { canSeeClaim, requireRole, scopeWhere } from "../../domain/scope";
import { claimInclude, type ClaimRow, toClaimView, type ViewCtx } from "../../domain/views";
import { FilesService } from "../files";
import { IntegrationLog, toJson } from "../integrations";
import { Notifier } from "../notifications";

// Manufacturer claims (A09, A10). Status steps come only from shared/wms-domain/src/claim-transitions.ts:
//   DRAFT -submit-> SUBMITTED -approve-> APPROVED -mark_paid-> PAID;  SUBMITTED -reject-> REJECTED
// Only admins act; dealers and distributors read their own; customers never see claims. The OEM's decision comes
// in as actor "system" (the simulator today).

export interface ClaimInput {
  rmaNumber?: unknown;
  amount?: unknown;
  reason?: unknown;
}

type OrderBy = Prisma.ClaimOrderByWithRelationInput;
const SORTS: Record<string, (dir: Prisma.SortOrder) => OrderBy> = {
  id: (dir) => ({ id: dir }),
  unitSerial: (dir) => ({ unitSerial: dir }),
  status: (dir) => ({ status: dir }),
  rmaNumber: (dir) => ({ rmaNumber: dir }),
  amount: (dir) => ({ amount: dir }),
  financePosting: (dir) => ({ financePosting: dir }),
  createdAt: (dir) => ({ createdAt: dir }),
  updatedAt: (dir) => ({ updatedAt: dir }),
  brandName: (dir) => ({ brand: { name: dir } }),
  dealerName: (dir) => ({ dealer: { name: dir } }),
  modelCode: (dir) => ({ unit: { model: { code: dir } } }),
  customerName: (dir) => ({ unit: { customer: { name: dir } } }),
};

const ACTIONS: readonly ClaimActionName[] = ["submit", "approve", "reject", "mark_paid"];

@Injectable()
export class ClaimsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FilesService,
    private readonly integrations: IntegrationLog,
    private readonly notifier: Notifier,
  ) {}

  private vc(ctx: Ctx): ViewCtx {
    return { user: ctx.user, today: ctx.today, fileUrl: this.files.fileUrl };
  }

  async list(ctx: Ctx, query: RawQuery): Promise<Paginated<ClaimView>> {
    requireRole(ctx.user, "admin", "dealer", "distributor");
    const list = listQuery(query);
    const q = list.q;
    const where: Prisma.ClaimWhereInput = {
      ...scopeWhere(ctx.user),
      status: queryEnum(query, "status", CLAIM_STATUSES),
      brandId: queryString(query, "brandId"),
      ...(q
        ? {
            OR: [
              { id: { contains: q, mode: "insensitive" } },
              { unitSerial: { contains: q, mode: "insensitive" } },
              { rmaNumber: { contains: q, mode: "insensitive" } },
              { brand: { name: { contains: q, mode: "insensitive" } } },
            ],
          }
        : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.claim.count({ where }),
      this.prisma.claim.findMany({
        where,
        include: claimInclude,
        orderBy: [resolveSort(list.sort, SORTS, "-createdAt"), { id: "asc" }],
        ...pageArgs(list),
      }),
    ]);
    return { items: await this.views(this.prisma, ctx, rows), total, page: list.page, pageSize: list.pageSize };
  }

  async counts(ctx: Ctx): Promise<Record<ClaimStatus, number>> {
    requireRole(ctx.user, "admin", "dealer", "distributor");
    const groups = await this.prisma.claim.groupBy({ by: ["status"], where: scopeWhere(ctx.user), _count: true });
    const counts = Object.fromEntries(CLAIM_STATUSES.map((s) => [s, 0])) as Record<ClaimStatus, number>;
    for (const g of groups) counts[g.status as ClaimStatus] = g._count;
    return counts;
  }

  async get(ctx: Ctx, id: string, db: Db = this.prisma): Promise<ClaimView> {
    const row = await db.claim.findUnique({ where: { id }, include: claimInclude });
    if (!row || !canSeeClaim(ctx.user, row)) throw AppError.notFound("Claim");
    const [view] = await this.views(db, ctx, [row]);
    return view!;
  }

  /** A10: submit (with amount and RMA number), approve, reject (with reason), mark paid. */
  async transition(ctx: Ctx, id: string, body: ClaimInput & { action?: unknown }): Promise<ClaimView> {
    requireRole(ctx.user, "admin");
    const action = (typeof body.action === "string" ? body.action : "submit") as ClaimActionName;
    await this.prisma.tx(async (tx) => {
      const claim = await tx.claim.findUnique({ where: { id } });
      if (!claim) throw AppError.notFound("Claim");
      await this.apply(tx, claim, action, "admin", ctx.user.name, body, ctx.now);
    });
    return this.get(ctx, id);
  }

  /** The manufacturer approves or rejects a submitted claim (A13 simulator stands in for the OEM). */
  async oemDecision(ctx: Ctx, body: { claimId?: unknown; decision?: unknown; reason?: unknown }): Promise<ClaimView> {
    requireRole(ctx.user, "admin");
    const id = typeof body.claimId === "string" ? body.claimId : "";
    const approve = body.decision !== "REJECTED";
    const reason = approve
      ? undefined
      : (typeof body.reason === "string" && body.reason.trim()) || "Rejected by the manufacturer.";
    await this.prisma.tx(async (tx) => {
      const claim = await tx.claim.findUnique({ where: { id } });
      if (!claim) throw AppError.notFound("Claim");
      await this.apply(tx, claim, approve ? "approve" : "reject", "system", "OEM (simulated)", { reason }, ctx.now);
      await this.integrations.log(
        tx,
        {
          system: "OEM",
          direction: "IN",
          type: "oem_decision",
          refId: claim.id,
          payload: { claimId: claim.id, rmaNumber: claim.rmaNumber ?? undefined, decision: approve ? "APPROVED" : "REJECTED", reason },
        },
        ctx.now,
      );
      await this.notifier.notify(
        tx,
        await this.notifier.adminIds(tx),
        approve ? "claim_approved_by_oem" : "claim_rejected_by_oem",
        ctx.now,
        { params: { id: claim.id }, link: `/claims/${claim.id}` },
      );
    });
    return this.get(ctx, id);
  }

  /** Draft claim with the job result as evidence (W3). Called by complaints when a claimable job comes back. */
  async createDraft(
    tx: Tx,
    input: {
      complaintId: string;
      unitSerial: string;
      brandId: string;
      dealerId: string | null;
      jobResultId: string;
      photoIds: string[];
      partsReplaced: ReplacedPart[];
    },
    now: Date,
  ): Promise<string> {
    const id = await nextId(tx, "CLM");
    await tx.claim.create({
      data: {
        id,
        complaintId: input.complaintId,
        unitSerial: input.unitSerial,
        brandId: input.brandId,
        dealerId: input.dealerId,
        status: "DRAFT",
        jobResultId: input.jobResultId,
        photoIds: input.photoIds,
        partsReplaced: toJson(input.partsReplaced),
        financePosting: "NOT_POSTED",
        createdAt: now,
        updatedAt: now,
        events: { create: { at: now, status: "DRAFT", byName: "System (from job result)" } },
      },
    });
    return id;
  }

  private async apply(
    tx: Tx,
    claim: Prisma.ClaimGetPayload<object>,
    action: ClaimActionName,
    actor: ClaimActor,
    byName: string,
    input: ClaimInput,
    now: Date,
  ): Promise<void> {
    const from = claim.status as ClaimStatus;
    const to = ACTIONS.includes(action) ? nextClaimStatus(from, action, actor) : null;
    if (!to) {
      throw AppError.conflict("invalid_transition", "This claim can't move to that status. Refresh and try again.");
    }
    const brand = (await tx.brand.findUnique({ where: { id: claim.brandId } }))?.name;
    const data: Prisma.ClaimUpdateManyMutationInput = { status: to, updatedAt: now };

    if (action === "submit") {
      const amount = Number(input.amount);
      if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000_000) {
        throw AppError.validation("Enter the claim amount.", { amount: "validation.amount" });
      }
      data.amount = Math.round(amount);
      data.rmaNumber = typeof input.rmaNumber === "string" && input.rmaNumber.trim() ? input.rmaNumber.trim().slice(0, 100) : null;
      await this.integrations.log(
        tx,
        {
          system: "OEM",
          direction: "OUT",
          type: "claim_submission",
          refId: claim.id,
          payload: {
            claimId: claim.id,
            brand,
            rmaNumber: data.rmaNumber ?? undefined,
            amount: data.amount,
            unitSerial: claim.unitSerial,
            partsReplaced: claim.partsReplaced,
            jobResultId: claim.jobResultId ?? undefined,
            photos: claim.photoIds.length,
          },
        },
        now,
      );
    }
    if (action === "reject") {
      const reason = typeof input.reason === "string" ? input.reason.trim().slice(0, 1000) : "";
      if (!reason) throw AppError.validation("Give a reason.", { reason: "validation.reasonRequired" });
      data.rejectReason = reason;
    }
    if (action === "mark_paid") {
      data.financePosting = "POSTED";
      await this.integrations.log(
        tx,
        {
          system: "FINANCE",
          direction: "OUT",
          type: "finance_posting",
          refId: claim.id,
          payload: {
            claimId: claim.id,
            brand,
            amount: claim.amount ?? undefined,
            account: "Warranty recoveries receivable",
            postedAt: now.toISOString(),
          },
        },
        now,
      );
    }

    // Compare-and-set: if someone else moved the claim meanwhile, nothing is updated and this request fails.
    const updated = await tx.claim.updateMany({ where: { id: claim.id, status: from }, data });
    if (!updated.count) {
      throw AppError.conflict("invalid_transition", "This claim can't move to that status. Refresh and try again.");
    }
    await tx.claimEvent.create({
      data: {
        claimId: claim.id,
        at: now,
        status: to,
        byName,
        text: action === "reject" ? (data.rejectReason as string) : undefined,
      },
    });
  }

  private async views(db: Db, ctx: Ctx, rows: ClaimRow[]): Promise<ClaimView[]> {
    const complaintIds = rows.flatMap((r) => r.complaintId ?? []);
    const jobIds = rows.flatMap((r) => r.jobResultId ?? []);
    const [complaints, jobs] = await Promise.all([
      complaintIds.length
        ? db.complaint.findMany({ where: { id: { in: complaintIds } }, select: { id: true, description: true } })
        : [],
      jobIds.length ? db.jobResult.findMany({ where: { id: { in: jobIds } } }) : [],
    ]);
    const attachments = await this.files.byIds(db, jobs.flatMap((j) => j.photoIds));
    const lookups = {
      attachments,
      complaints: new Map(complaints.map((c) => [c.id, c.description])),
      jobResults: new Map(jobs.map((j) => [j.id, j])),
    };
    const vc = this.vc(ctx);
    return rows.map((r) => toClaimView(r, lookups, vc));
  }
}

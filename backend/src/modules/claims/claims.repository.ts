import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { Db } from "../../infra/prisma/prisma.service";

export const claimSummaryInclude = {
  registration: { select: { serialNumber: true, product: { select: { sku: true, name: true } } } },
  assignee: { select: { id: true, displayName: true } },
} as const;
export type ClaimSummaryRow = Prisma.ClaimGetPayload<{ include: typeof claimSummaryInclude }>;

export const claimDetailInclude = {
  registration: {
    select: {
      serialNumber: true,
      status: true,
      warrantyEnd: true,
      purchaseDate: true,
      product: { select: { sku: true, name: true } },
      customer: { select: { contactName: true, companyName: true } },
    },
  },
  assignee: { select: { id: true, displayName: true } },
  creator: { select: { id: true, displayName: true } },
  rma: { select: { id: true, displayNo: true, status: true, type: true } },
} as const;
export type ClaimDetailRow = Prisma.ClaimGetPayload<{ include: typeof claimDetailInclude }>;

/** All DB access for claims. Every read takes the caller's scope (Section 7.2). */
@Injectable()
export class ClaimsRepository {
  async list(
    db: Db,
    where: Prisma.ClaimWhereInput,
    skip: number,
    take: number,
    orderBy: Prisma.ClaimOrderByWithRelationInput,
  ) {
    const [items, total] = await Promise.all([
      db.claim.findMany({
        where,
        skip,
        take,
        orderBy: [orderBy, { id: "asc" }],
        include: claimSummaryInclude,
      }),
      db.claim.count({ where }),
    ]);
    return { items, total };
  }

  findScoped(db: Db, id: string, scope: Prisma.ClaimWhereInput): Promise<ClaimDetailRow | null> {
    return db.claim.findFirst({ where: { AND: [{ id }, scope] }, include: claimDetailInclude });
  }

  create(db: Db, data: Prisma.ClaimUncheckedCreateInput): Promise<ClaimDetailRow> {
    return db.claim.create({ data, include: claimDetailInclude });
  }

  /** Optimistic update: `count === 0` means a stale version (Section 6.5). */
  updateVersioned(db: Db, id: string, version: number, data: Prisma.ClaimUncheckedUpdateManyInput) {
    return db.claim.updateMany({ where: { id, version }, data: { ...data, version: { increment: 1 } } });
  }

  /** Unversioned update for system-driven changes already serialised by a versioned parent (e.g. the RMA). */
  update(db: Db, id: string, data: Prisma.ClaimUncheckedUpdateInput) {
    return db.claim.update({ where: { id }, data: { ...data, version: { increment: 1 } } });
  }

  addEvent(db: Db, data: Prisma.ClaimEventUncheckedCreateInput) {
    return db.claimEvent.create({
      data,
      include: { actor: { select: { id: true, displayName: true, roles: true } } },
    });
  }

  /** Internal notes are filtered HERE for customer roles, never in the controller (Section 11.3). */
  events(db: Db, claimId: string, opts: { includeInternal: boolean; after?: bigint; limit: number }) {
    return db.claimEvent.findMany({
      where: {
        claimId,
        internal: opts.includeInternal ? undefined : false,
        id: opts.after === undefined ? undefined : { gt: opts.after },
      },
      orderBy: { id: "asc" },
      take: opts.limit + 1,
      include: { actor: { select: { id: true, displayName: true, roles: true } } },
    });
  }

  failureCategory(db: Db, code: string) {
    return db.failureCategory.findFirst({ where: { code, isActive: true } });
  }

  /** Claims whose SLA has passed and haven't been flagged yet. Uses claims_queue_idx. */
  breached(db: Db, now: Date, limit: number) {
    return db.claim.findMany({
      where: { status: { in: ["SUBMITTED", "IN_REVIEW"] }, slaDueAt: { lt: now }, slaBreachNotifiedAt: null },
      select: { id: true, displayNo: true, assignedTo: true, slaDueAt: true },
      take: limit,
      orderBy: { slaDueAt: "asc" },
    });
  }

  forNotification(db: Db, id: string) {
    return db.claim.findUnique({
      where: { id },
      select: {
        id: true,
        displayNo: true,
        status: true,
        rejectionReason: true,
        creator: { select: { email: true, displayName: true } },
        assignee: { select: { email: true, displayName: true } },
        rma: { select: { displayNo: true } },
      },
    });
  }
}

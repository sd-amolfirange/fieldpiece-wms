import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { Db } from "../../infra/prisma/prisma.service";

export const rmaInclude = {
  claim: {
    select: {
      displayNo: true,
      returnAddress: true,
      registrationId: true,
      registration: { select: { serialNumber: true, product: { select: { sku: true, name: true } } } },
    },
  },
  serviceCenter: { select: { id: true, name: true } },
} as const;
export type RmaRow = Prisma.RmaGetPayload<{ include: typeof rmaInclude }>;

@Injectable()
export class RmaRepository {
  async list(
    db: Db,
    where: Prisma.RmaWhereInput,
    skip: number,
    take: number,
    orderBy: Prisma.RmaOrderByWithRelationInput,
  ) {
    const [items, total] = await Promise.all([
      db.rma.findMany({ where, skip, take, orderBy: [orderBy, { id: "asc" }], include: rmaInclude }),
      db.rma.count({ where }),
    ]);
    return { items, total };
  }

  findScoped(db: Db, id: string, scope: Prisma.RmaWhereInput): Promise<RmaRow | null> {
    return db.rma.findFirst({ where: { AND: [{ id }, scope] }, include: rmaInclude });
  }

  create(db: Db, data: Prisma.RmaUncheckedCreateInput) {
    return db.rma.create({ data, select: { id: true, displayNo: true } });
  }

  updateVersioned(db: Db, id: string, version: number, data: Prisma.RmaUncheckedUpdateManyInput) {
    return db.rma.updateMany({ where: { id, version }, data: { ...data, version: { increment: 1 } } });
  }

  /** Field updates after the versioned status change in the same transaction. */
  update(db: Db, id: string, data: Prisma.RmaUncheckedUpdateInput) {
    return db.rma.update({ where: { id }, data });
  }

  /** Default routing: the first service center with an address. [CONFIRM] routing rules (region, product family). */
  defaultServiceCenter(db: Db) {
    return db.organization.findFirst({
      where: { type: "service_center", address: { not: { equals: null } } },
      orderBy: { createdAt: "asc" },
    });
  }
}

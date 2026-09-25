import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { Db } from "../../infra/prisma/prisma.service";

const withSku = {
  product: { select: { sku: true } },
  _count: { select: { registrations: true } },
} as const;
export type PolicyRow = Prisma.WarrantyPolicyGetPayload<{ include: typeof withSku }>;

@Injectable()
export class PoliciesRepository {
  list(db: Db, where: Prisma.WarrantyPolicyWhereInput): Promise<PolicyRow[]> {
    return db.warrantyPolicy.findMany({
      where,
      include: withSku,
      orderBy: [{ productId: { sort: "asc", nulls: "first" } }, { effectiveFrom: "desc" }],
    });
  }

  findById(db: Db, id: string): Promise<PolicyRow | null> {
    return db.warrantyPolicy.findUnique({ where: { id }, include: withSku });
  }

  create(db: Db, data: Prisma.WarrantyPolicyUncheckedCreateInput): Promise<PolicyRow> {
    return db.warrantyPolicy.create({ data, include: withSku });
  }

  update(db: Db, id: string, data: Prisma.WarrantyPolicyUncheckedUpdateInput): Promise<PolicyRow> {
    return db.warrantyPolicy.update({ where: { id }, data, include: withSku });
  }

  /** Policies that could apply to these products on a given date: theirs plus the default. */
  candidates(db: Db, productIds: string[], on: Date) {
    return db.warrantyPolicy.findMany({
      where: {
        OR: [{ productId: { in: productIds } }, { productId: null }],
        effectiveFrom: { lte: on },
        AND: [{ OR: [{ effectiveTo: null }, { effectiveTo: { gt: on } }] }],
      },
    });
  }
}

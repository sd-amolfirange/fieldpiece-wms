import { Injectable } from "@nestjs/common";
import type { Prisma, Product } from "@prisma/client";
import type { Db } from "../../infra/prisma/prisma.service";

@Injectable()
export class ProductsRepository {
  async list(
    db: Db,
    where: Prisma.ProductWhereInput,
    skip: number,
    take: number,
    orderBy: Prisma.ProductOrderByWithRelationInput,
  ) {
    const [items, total] = await Promise.all([
      db.product.findMany({ where, skip, take, orderBy: [orderBy, { id: "asc" }] }),
      db.product.count({ where }),
    ]);
    return { items, total };
  }

  findBySku(db: Db, sku: string): Promise<Product | null> {
    return db.product.findFirst({ where: { sku, deletedAt: null } });
  }

  findActive(db: Db): Promise<Product[]> {
    return db.product.findMany({ where: { deletedAt: null, isActive: true } });
  }

  create(db: Db, data: Prisma.ProductUncheckedCreateInput): Promise<Product> {
    return db.product.create({ data });
  }

  update(db: Db, id: string, data: Prisma.ProductUncheckedUpdateInput): Promise<Product> {
    return db.product.update({ where: { id }, data });
  }
}

import { Injectable } from "@nestjs/common";
import type { Customer, Prisma } from "@prisma/client";
import type { Db } from "../../infra/prisma/prisma.service";

@Injectable()
export class CustomersRepository {
  async list(
    db: Db,
    where: Prisma.CustomerWhereInput,
    skip: number,
    take: number,
    orderBy: Prisma.CustomerOrderByWithRelationInput,
  ) {
    const [items, total] = await Promise.all([
      db.customer.findMany({ where, skip, take, orderBy: [orderBy, { id: "asc" }] }),
      db.customer.count({ where }),
    ]);
    return { items, total };
  }

  findScoped(db: Db, id: string, scope: Prisma.CustomerWhereInput): Promise<Customer | null> {
    return db.customer.findFirst({ where: { AND: [{ id }, scope] } });
  }

  findByUser(db: Db, userId: string): Promise<Customer | null> {
    return db.customer.findUnique({ where: { userId } });
  }

  create(db: Db, data: Prisma.CustomerUncheckedCreateInput): Promise<Customer> {
    return db.customer.create({ data });
  }

  update(db: Db, id: string, data: Prisma.CustomerUncheckedUpdateInput): Promise<Customer> {
    return db.customer.update({ where: { id }, data });
  }
}

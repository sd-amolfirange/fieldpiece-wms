import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { Db } from "../../infra/prisma/prisma.service";

export const userWithOrg = {
  organization: { select: { id: true, name: true, type: true, currency: true } },
} as const;
export type UserWithOrg = Prisma.UserGetPayload<{ include: typeof userWithOrg }>;

/** All DB access for users. */
@Injectable()
export class UsersRepository {
  findBySubject(db: Db, idpSubject: string): Promise<UserWithOrg | null> {
    return db.user.findUnique({ where: { idpSubject }, include: userWithOrg });
  }

  findById(db: Db, id: string): Promise<UserWithOrg | null> {
    return db.user.findUnique({ where: { id }, include: userWithOrg });
  }

  findByEmail(db: Db, email: string): Promise<UserWithOrg | null> {
    return db.user.findUnique({ where: { email }, include: userWithOrg });
  }

  create(db: Db, data: Prisma.UserUncheckedCreateInput): Promise<UserWithOrg> {
    return db.user.create({ data, include: userWithOrg });
  }

  update(db: Db, id: string, data: Prisma.UserUncheckedUpdateInput): Promise<UserWithOrg> {
    return db.user.update({ where: { id }, data, include: userWithOrg });
  }

  async list(
    db: Db,
    where: Prisma.UserWhereInput,
    skip: number,
    take: number,
    orderBy: Prisma.UserOrderByWithRelationInput,
  ) {
    const [items, total] = await Promise.all([
      db.user.findMany({ where, skip, take, orderBy: [orderBy, { id: "asc" }], include: userWithOrg }),
      db.user.count({ where }),
    ]);
    return { items, total };
  }
}

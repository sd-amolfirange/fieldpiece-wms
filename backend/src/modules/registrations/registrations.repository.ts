import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { Db } from "../../infra/prisma/prisma.service";

export const registrationInclude = {
  product: { select: { sku: true, name: true } },
  customer: { select: { contactName: true, companyName: true } },
} as const;
export type RegistrationRow = Prisma.RegistrationGetPayload<{ include: typeof registrationInclude }>;

@Injectable()
export class RegistrationsRepository {
  async list(
    db: Db,
    where: Prisma.RegistrationWhereInput,
    skip: number,
    take: number,
    orderBy: Prisma.RegistrationOrderByWithRelationInput,
  ) {
    const [items, total] = await Promise.all([
      db.registration.findMany({
        where,
        skip,
        take,
        orderBy: [orderBy, { id: "asc" }],
        include: registrationInclude,
      }),
      db.registration.count({ where }),
    ]);
    return { items, total };
  }

  findScoped(db: Db, id: string, scope: Prisma.RegistrationWhereInput) {
    return db.registration.findFirst({
      where: { AND: [{ id }, scope] },
      include: { ...registrationInclude, _count: { select: { claims: true } } },
    });
  }

  /** Any ACTIVE registration for this unit, regardless of scope (duplicate check). */
  findActiveDuplicate(db: Db, productId: string, serial: string) {
    return db.registration.findFirst({
      where: { productId, status: "ACTIVE", serialNumber: { equals: serial, mode: "insensitive" } },
      select: { id: true, createdBy: true, customer: { select: { userId: true } }, distributorId: true },
    });
  }

  create(db: Db, data: Prisma.RegistrationUncheckedCreateInput): Promise<RegistrationRow> {
    return db.registration.create({ data, include: registrationInclude });
  }

  /** Optimistic update: 0 rows means someone else changed it (Section 6.5). */
  updateVersioned(db: Db, id: string, version: number, data: Prisma.RegistrationUncheckedUpdateManyInput) {
    return db.registration.updateMany({
      where: { id, version },
      data: { ...data, version: { increment: 1 } },
    });
  }

  findForDocument(db: Db, id: string) {
    return db.registration.findUnique({
      where: { id },
      include: {
        product: { select: { sku: true, name: true } },
        customer: { select: { contactName: true, companyName: true, email: true } },
      },
    });
  }
}

import { Injectable } from "@nestjs/common";
import type { Attachment, Prisma } from "@prisma/client";
import type { Db } from "../../infra/prisma/prisma.service";

@Injectable()
export class AttachmentsRepository {
  create(db: Db, data: Prisma.AttachmentUncheckedCreateInput): Promise<Attachment> {
    return db.attachment.create({ data });
  }

  findById(db: Db, id: string): Promise<Attachment | null> {
    return db.attachment.findUnique({ where: { id } });
  }

  findMany(db: Db, ids: string[]): Promise<Attachment[]> {
    return db.attachment.findMany({ where: { id: { in: ids } } });
  }

  forOwner(db: Db, ownerType: string, ownerId: string): Promise<Attachment[]> {
    return db.attachment.findMany({
      where: { ownerType, ownerId, scanStatus: { not: "INFECTED" } },
      orderBy: { createdAt: "asc" },
    });
  }

  update(db: Db, id: string, data: Prisma.AttachmentUncheckedUpdateInput): Promise<Attachment> {
    return db.attachment.update({ where: { id }, data });
  }

  link(db: Db, ids: string[], ownerId: string) {
    return db.attachment.updateMany({ where: { id: { in: ids }, ownerId: null }, data: { ownerId } });
  }

  /** Does the owner row exist inside the caller's scope? Uses the shared scope helpers. */
  async ownerVisible(
    db: Db,
    ownerType: string,
    ownerId: string,
    scope: {
      claim: Prisma.ClaimWhereInput;
      registration: Prisma.RegistrationWhereInput;
      rma: Prisma.RmaWhereInput;
    },
  ): Promise<boolean> {
    switch (ownerType) {
      case "claim":
        return (await db.claim.count({ where: { AND: [{ id: ownerId }, scope.claim] } })) > 0;
      case "registration":
        return (await db.registration.count({ where: { AND: [{ id: ownerId }, scope.registration] } })) > 0;
      case "rma":
        return (await db.rma.count({ where: { AND: [{ id: ownerId }, scope.rma] } })) > 0;
      default:
        return false;
    }
  }
}

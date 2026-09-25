import { Injectable } from "@nestjs/common";
import type { Db } from "../../infra/prisma/prisma.service";

/**
 * Read model for the public lookup. Selects only what the public response may contain (Section 11.4):
 * never customer, distributor or purchase details.
 */
@Injectable()
export class WarrantyRepository {
  findActiveBySerial(db: Db, serial: string, sku?: string) {
    return db.registration.findFirst({
      where: {
        serialNumber: { equals: serial, mode: "insensitive" },
        status: "ACTIVE",
        product: sku ? { sku } : undefined,
      },
      orderBy: { createdAt: "desc" },
      select: {
        serialNumber: true,
        status: true,
        warrantyEnd: true,
        product: { select: { sku: true, name: true, family: true, imageKey: true } },
      },
    });
  }

  activeProducts(db: Db, sku?: string) {
    return db.product.findMany({
      where: { deletedAt: null, isActive: true, sku },
      select: { sku: true, name: true, family: true, imageKey: true, serialPattern: true },
    });
  }
}

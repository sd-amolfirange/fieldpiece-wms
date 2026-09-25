import { Inject, Injectable } from "@nestjs/common";
import { AppError } from "../../common/errors/app-error";
import { productImageUrl } from "../../common/files/product-image";
import { ErrorCode } from "../../common/errors/error-codes";
import { Clock } from "../../common/time/clock";
import { formatIsoDate } from "../../common/time/utc-date";
import { serialMatchesProduct } from "../../common/validation/serial";
import { ENV } from "../../config/config.module";
import type { Env } from "../../config/env";
import { CacheService } from "../../infra/redis/cache.service";
import { ReplicaPrismaService } from "../../infra/prisma/prisma.service";
import type { WarrantyCheckResponse } from "./dto";
import { computeWarrantyStatus } from "./warranty.engine";
import { WarrantyRepository } from "./warranty.repository";

export const WARRANTY_CHECK_PREFIX = "warranty:check:";
const CHECK_TTL = 300; // 5 min, invalidated on registration create / void (Section 9.3)

@Injectable()
export class WarrantyService {
  constructor(
    // Public lookups read from the replica (Section 10 scaling path, step 3).
    private readonly db: ReplicaPrismaService,
    private readonly repo: WarrantyRepository,
    private readonly cache: CacheService,
    private readonly clock: Clock,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async check(serial: string, sku?: string): Promise<WarrantyCheckResponse> {
    const key = `${WARRANTY_CHECK_PREFIX}${serial}:${sku ?? ""}`;
    const result = await this.cache.getOrSet(key, CHECK_TTL, () => this.lookup(serial, sku));
    if (!result) {
      throw new AppError(
        ErrorCode.NOT_FOUND,
        404,
        "Serial number not found. Check the label on the back of the unit, or register it first.",
      );
    }
    return result;
  }

  /** Called by registrations after create / void. */
  async invalidate(serial: string): Promise<void> {
    await this.cache.delByPrefix(`${WARRANTY_CHECK_PREFIX}${serial.toUpperCase()}:`);
  }

  private async lookup(serial: string, sku?: string): Promise<WarrantyCheckResponse | null> {
    const registration = await this.repo.findActiveBySerial(this.db, serial, sku);
    if (registration) {
      return {
        serialNumber: registration.serialNumber,
        product: this.publicProduct(registration.product),
        registered: true,
        warrantyStatus: computeWarrantyStatus({
          status: registration.status,
          warrantyEnd: registration.warrantyEnd,
          today: this.clock.now(),
          expiringSoonDays: this.env.EXPIRING_SOON_DAYS,
        }),
        warrantyEnd: formatIsoDate(registration.warrantyEnd),
      };
    }
    const product = (await this.repo.activeProducts(this.db, sku)).find((p) =>
      serialMatchesProduct(serial, p),
    );
    if (!product) return null;
    return {
      serialNumber: serial,
      product: this.publicProduct(product),
      registered: false,
      warrantyStatus: "NOT_REGISTERED",
      warrantyEnd: null,
    };
  }

  /** Only the fields the public response may carry (Section 11.4), with the photo as a URL. */
  private publicProduct(p: {
    sku: string;
    name: string;
    family: WarrantyCheckResponse["product"]["family"];
    imageKey: string | null;
  }) {
    return {
      sku: p.sku,
      name: p.name,
      family: p.family,
      imageUrl: productImageUrl(this.env, p.sku, p.imageKey),
    };
  }
}

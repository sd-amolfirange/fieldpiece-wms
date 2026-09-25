import { Injectable, Logger } from "@nestjs/common";
import { Clock } from "../common/time/clock";
import { PrismaService } from "../infra/prisma/prisma.service";

const DAY_MS = 86_400_000;

/**
 * Housekeeping (Section 9.2): idempotency keys > 24 h, published outbox rows > 7 days.
 * Monthly audit partitions are DDL, which the app role can't run: create them from the migrations job
 * (owner role) or pg_partman. Until then rows land in audit_log_default.
 */
@Injectable()
export class MaintenanceService {
  private readonly logger = new Logger(MaintenanceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
  ) {}

  async purge(): Promise<void> {
    const now = this.clock.now().getTime();
    const keys = await this.prisma.idempotencyKey.deleteMany({
      where: { createdAt: { lt: new Date(now - DAY_MS) } },
    });
    const outbox = await this.prisma.outboxEvent.deleteMany({
      where: { publishedAt: { lt: new Date(now - 7 * DAY_MS) } },
    });
    this.logger.log({ idempotencyKeys: keys.count, outboxEvents: outbox.count }, "Housekeeping done");
  }
}

import { Inject, Injectable, Logger } from "@nestjs/common";
import { addBusinessHours } from "../../common/time/business-hours";
import { Clock } from "../../common/time/clock";
import { formatIsoDate } from "../../common/time/utc-date";
import { ENV } from "../../config/config.module";
import type { Env } from "../../config/env";
import { OutboxService } from "../../infra/outbox/outbox.service";
import { CacheService } from "../../infra/redis/cache.service";
import { PrismaService } from "../../infra/prisma/prisma.service";
import { ClaimsRepository } from "./claims.repository";

const BREACH_BATCH = 100;

/** SLA due dates and breach detection (Section 8.4). [CONFIRM] SLA hours and business calendar. */
@Injectable()
export class SlaService {
  private readonly logger = new Logger(SlaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: ClaimsRepository,
    private readonly outbox: OutboxService,
    private readonly cache: CacheService,
    private readonly clock: Clock,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async dueAt(submittedAt: Date): Promise<Date> {
    const holidays = await this.cache.getOrSet("sla:holidays", 3600, async () =>
      (await this.prisma.holiday.findMany({ select: { date: true } })).map((h) => formatIsoDate(h.date)),
    );
    return addBusinessHours(submittedAt, this.env.SLA_REVIEW_BUSINESS_HOURS, {
      startHour: this.env.BUSINESS_DAY_START_HOUR,
      endHour: this.env.BUSINESS_DAY_END_HOUR,
      holidays: new Set(holidays),
    });
  }

  /**
   * Worker job (every 15 min): emits `claim.sla_breached` once per claim. Marking and emitting happen in
   * one transaction, so a crash can't produce a breach without an event or vice versa.
   */
  async flagBreaches(): Promise<number> {
    let flagged = 0;
    for (;;) {
      const batch = await this.repo.breached(this.prisma, this.clock.now(), BREACH_BATCH);
      if (!batch.length) break;
      await this.prisma.$transaction(async (tx) => {
        const now = this.clock.now();
        for (const claim of batch) {
          const { count } = await tx.claim.updateMany({
            where: { id: claim.id, slaBreachNotifiedAt: null },
            data: { slaBreachNotifiedAt: now },
          });
          if (count === 0) continue;
          await this.outbox.add(tx, {
            aggregate: "claim",
            aggregateId: claim.id,
            type: "claim.sla_breached",
            payload: {
              claimId: claim.id,
              displayNo: claim.displayNo,
              slaDueAt: claim.slaDueAt?.toISOString() ?? null,
            },
          });
          flagged += 1;
        }
      });
      if (batch.length < BREACH_BATCH) break;
    }
    if (flagged) this.logger.warn({ flagged }, "SLA breaches flagged");
    return flagged;
  }
}

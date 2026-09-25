import { HttpStatus, Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import type { AuthUser } from "../../common/auth/auth-user";
import { AppError } from "../../common/errors/app-error";
import { ErrorCode } from "../../common/errors/error-codes";
import { Clock } from "../../common/time/clock";
import {
  addUtcDays,
  differenceInUtcCalendarDays,
  formatIsoDate,
  parseIsoDate,
  startOfUtcDay,
} from "../../common/time/utc-date";
import { CacheService } from "../../infra/redis/cache.service";
import { ReplicaPrismaService } from "../../infra/prisma/prisma.service";
import type { ClaimsSummary, ReportFilters } from "./dto";
import { type ResolvedFilters, ReportsRepository } from "./reports.repository";

const TTL = 300; // 5 min, time-based only (Section 9.3)
const DEFAULT_WINDOW_DAYS = 90;
const NO_ORG = "00000000-0000-0000-0000-000000000000";

/** Analytics on the read replica (Section 9.2). Distributors are limited to their own organisation. */
@Injectable()
export class ReportsService {
  constructor(
    private readonly db: ReplicaPrismaService,
    private readonly repo: ReportsRepository,
    private readonly cache: CacheService,
    private readonly clock: Clock,
  ) {}

  async claimsSummary(user: AuthUser, filters: ReportFilters): Promise<ClaimsSummary> {
    const f = this.resolve(user, filters);
    return this.cached("claims-summary", f, async () => {
      const days = differenceInUtcCalendarDays(f.toExclusive, f.from);
      const previous = { ...f, from: addUtcDays(f.from, -days), toExclusive: f.from };
      const [byStatus, submitted, submittedPrev, regs, regsPrev, queue, avg, overTime] = await Promise.all([
        this.repo.byStatus(this.db, f),
        this.repo.submittedCount(this.db, f),
        this.repo.submittedCount(this.db, previous),
        this.repo.registrationCount(this.db, f),
        this.repo.registrationCount(this.db, previous),
        this.repo.queue(this.db, f.distributorId, this.clock.now()),
        this.repo.avgResolutionDays(this.db, f),
        this.repo.claimsOverTime(this.db, f),
      ]);
      return {
        from: formatIsoDate(f.from),
        to: formatIsoDate(addUtcDays(f.toExclusive, -1)),
        byStatus: byStatus.map((r) => ({ status: r.status, count: Number(r.count) })),
        claimsSubmitted: { current: submitted, previous: submittedPrev },
        registrations: { current: regs, previous: regsPrev },
        openClaims: queue.open,
        unassigned: queue.unassigned,
        slaBreached: queue.breached,
        avgResolutionDays: avg,
        claimsOverTime: overTime.map((r) => ({ date: formatIsoDate(r.date), count: Number(r.count) })),
      };
    });
  }

  async claimRateBySku(user: AuthUser, filters: ReportFilters) {
    const f = this.resolve(user, filters);
    return this.cached("claim-rate", f, async () => ({
      items: (await this.repo.claimRateBySku(this.db, f))
        .map((r) => {
          const registrations = Number(r.registrations);
          const claims = Number(r.claims);
          return {
            sku: r.sku,
            name: r.name,
            registrations,
            claims,
            rate: registrations ? Math.round((claims / registrations) * 10000) / 10000 : 0,
          };
        })
        .sort((a, b) => b.rate - a.rate),
    }));
  }

  async failureCategories(user: AuthUser, filters: ReportFilters) {
    const f = this.resolve(user, filters);
    return this.cached("failure-categories", f, async () => ({
      items: (await this.repo.failureCategories(this.db, f)).map((r) => ({
        category: r.category,
        label: r.label,
        count: Number(r.count),
      })),
    }));
  }

  async resolutionTime(user: AuthUser, filters: ReportFilters) {
    const f = this.resolve(user, filters);
    return this.cached("resolution-time", f, async () => ({
      items: (await this.repo.resolutionTime(this.db, f)).map((r) => ({
        week: formatIsoDate(r.week),
        avgDays: Math.round(r.avg_days * 10) / 10,
        count: Number(r.count),
      })),
    }));
  }

  async cost(user: AuthUser, filters: ReportFilters) {
    const f = this.resolve(user, filters);
    return this.cached("cost", f, async () => ({
      items: (await this.repo.cost(this.db, f)).map((r) => ({
        type: r.type,
        count: Number(r.count),
        creditTotal: (r.credit_total ?? 0).toString(),
        currency: r.currency,
      })),
    }));
  }

  private resolve(user: AuthUser, filters: ReportFilters): ResolvedFilters {
    const today = startOfUtcDay(this.clock.now());
    const to = filters.to ? parseIsoDate(filters.to) : today;
    const from = filters.from ? parseIsoDate(filters.from) : addUtcDays(to, -DEFAULT_WINDOW_DAYS);
    if (differenceInUtcCalendarDays(to, from) > 3 * 366) {
      throw new AppError(
        ErrorCode.VALIDATION_FAILED,
        HttpStatus.BAD_REQUEST,
        "Pick a range of three years or less.",
        {
          from: ["Range too long."],
        },
      );
    }
    const isStaff = user.hasAny("claims_agent", "admin");
    return {
      from,
      toExclusive: addUtcDays(to, 1),
      sku: filters.sku ?? null,
      family: filters.family ?? null,
      region: filters.region ?? null,
      // Distributors always see only their organisation, whatever they ask for.
      distributorId: isStaff ? (filters.distributorId ?? null) : (user.organizationId ?? NO_ORG),
    };
  }

  /** Cache key includes the resolved org scope, so scoped data never leaks across orgs. */
  private cached<T>(report: string, f: ResolvedFilters, load: () => Promise<T>): Promise<T> {
    const hash = createHash("sha1").update(JSON.stringify(f)).digest("hex");
    return this.cache.getOrSet(`reports:${report}:${hash}`, TTL, load);
  }
}

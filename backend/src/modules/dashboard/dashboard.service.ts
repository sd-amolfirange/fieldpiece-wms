import { Inject, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  addDaysIso,
  addMonthsIso,
  CLAIM_STATUSES,
  claimCost,
  FIELDPIECE_APP_CHANNELS,
  isOpenClaim,
  percent,
  RESOLUTIONS,
  roundMoney,
  WARRANTY_STATUSES,
  type AppChannelStats,
  type ChannelCount,
  type ClaimStatus,
  type DashboardSummary,
  type DealerStats,
  type FinanceSummary,
  type IsoDate,
  type ModelQuota,
  type MonthlyTrend,
  type Resolution,
  type WarrantyStatus,
  type WarrantyStatusCount,
} from "@wms/domain";
import type { Ctx } from "../../common/auth/context";
import { fromDbDate } from "../../common/db/dates";
import { isoDateIn } from "../../common/time/business-date";
import { ENV } from "../../config/config.module";
import type { Env } from "../../config/env";
import { PrismaService } from "../../infra/prisma/prisma.service";
import { scopeWhere } from "../../domain/scope";
import { moneyOf, toUnitEvent } from "../../domain/views";
import { CatalogService } from "../catalog";
import { UnitsRepository } from "../units";

// Dashboards (A01 warranty desk, DL01 dealer / distributor, customer home) and the finance insights. Every number is
// computed in the caller's scope; a distributor may narrow everything to one of its dealers.

const OPEN_CLAIM = CLAIM_STATUSES.filter(isOpenClaim);
const CHANNELS: ChannelCount["channel"][] = [
  "DEALER",
  "PORTAL",
  "WEB",
  "EMAIL",
  "ERP",
  "API",
  "RETAIL",
  "OVERWATCH",
  "JOBLINK",
];
/** Claims that cost money: decided in the claimant's favour (approved) or settled (closed). */
const SETTLED: ClaimStatus[] = ["APPROVED", "CLOSED"];
const TREND_MONTHS = 12;

/** The last `count` calendar months ("YYYY-MM") up to today's, oldest first. */
function lastMonths(today: IsoDate, count: number): string[] {
  const first = `${today.slice(0, 7)}-01`;
  return Array.from({ length: count }, (_, i) => addMonthsIso(first, i - count + 1).slice(0, 7));
}

const byStatus = (counts: Record<WarrantyStatus, number>): WarrantyStatusCount[] =>
  WARRANTY_STATUSES.map((status) => ({ status, count: counts[status] }));

/** SQL condition on a table's dealer_id: null = every row (admin). */
const dealerSql = (dealerIds: readonly string[] | null) =>
  dealerIds === null
    ? Prisma.sql`TRUE`
    : dealerIds.length
      ? Prisma.sql`dealer_id IN (${Prisma.join(dealerIds)})`
      : Prisma.sql`FALSE`;

@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly units: UnitsRepository,
    private readonly catalog: CatalogService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Dealers in scope: null = all (admin); a distributor may narrow to one of its dealers. */
  private scopeDealers(ctx: Ctx, requestedDealerId?: string): string[] | null {
    const { user } = ctx;
    if (user.role === "admin") return null;
    const ids = user.visibleDealerIds ?? [];
    const dealerId = user.role === "distributor" && requestedDealerId ? requestedDealerId : undefined;
    return dealerId ? ids.filter((id) => id === dealerId) : ids;
  }

  async summary(ctx: Ctx, requestedDealerId?: string): Promise<DashboardSummary> {
    const { user } = ctx;
    if (user.role === "admin") return this.admin(ctx);
    if (user.role === "customer") return this.customer(ctx);

    // DL01 for a distributor: optionally one of its dealers (scoping still applies first).
    const dealerId = user.role === "distributor" && requestedDealerId ? requestedDealerId : undefined;
    const scoped = { AND: [scopeWhere(user), dealerId ? { dealerId } : {}] };
    const visible = this.scopeDealers(ctx, requestedDealerId) ?? [];
    const month = ctx.today.slice(0, 7);

    const registrations = visible.length
      ? await this.prisma.$queryRaw<
          { dealer_id: string; this_month: bigint; pending: bigint; rejected: bigint }[]
        >`
          SELECT dealer_id,
                 COUNT(*) FILTER (WHERE to_char(submitted_at AT TIME ZONE ${this.env.APP_TIMEZONE}, 'YYYY-MM') = ${month}) AS this_month,
                 COUNT(*) FILTER (WHERE status = 'PENDING') AS pending,
                 COUNT(*) FILTER (WHERE status = 'REJECTED') AS rejected
          FROM registrations
          WHERE dealer_id IN (${Prisma.join(visible)})
          GROUP BY dealer_id`
      : [];
    const [claimGroups, dealers, units, trend] = await Promise.all([
      this.prisma.warrantyClaim.groupBy({ by: ["dealerId", "status"], where: scoped, _count: true }),
      this.catalog.dealers(user),
      this.units.countByStatus(user, ctx.today, dealerId),
      this.trend(ctx, visible),
    ]);
    const openClaims = claimGroups.filter((c) => isOpenClaim(c.status as ClaimStatus));

    const regBy = new Map(registrations.map((r) => [r.dealer_id, r]));
    const claimsBy = new Map<string | null, number>();
    for (const c of openClaims) claimsBy.set(c.dealerId, (claimsBy.get(c.dealerId) ?? 0) + c._count);
    const perDealer: DealerStats[] = dealers.map((d) => ({
      dealerId: d.id,
      dealerName: d.name,
      registrationsThisMonth: Number(regBy.get(d.id)?.this_month ?? 0),
      pending: Number(regBy.get(d.id)?.pending ?? 0),
      openClaims: claimsBy.get(d.id) ?? 0,
    }));
    const sum = (key: "this_month" | "pending" | "rejected") =>
      registrations.reduce((n, r) => n + Number(r[key]), 0);
    const statusCount = (status: ClaimStatus) =>
      claimGroups.filter((c) => c.status === status).reduce((n, c) => n + c._count, 0);
    return {
      role: user.role,
      registrationsThisMonth: sum("this_month"),
      pending: sum("pending"),
      rejected: sum("rejected"),
      openClaims: openClaims.reduce((n, c) => n + c._count, 0),
      dealers: perDealer,
      unitsByStatus: byStatus(units),
      claimsByStatus: CLAIM_STATUSES.map((status) => ({ status, count: statusCount(status) })),
      trend,
    };
  }

  private async admin(ctx: Ctx): Promise<DashboardSummary> {
    const [
      counts,
      pendingRegistrations,
      byChannel,
      byStatus,
      categories,
      byCategory,
      expiring,
      activity,
      trend,
      apps,
    ] = await Promise.all([
      this.units.countByStatus(ctx.user, ctx.today),
      this.prisma.registration.count({ where: { status: "PENDING" } }),
      this.prisma.registration.groupBy({ by: ["channel"], where: { status: "APPROVED" }, _count: true }),
      this.prisma.warrantyClaim.groupBy({ by: ["status"], _count: true }),
      this.catalog.categories(),
      this.prisma.$queryRaw<{ category_id: string; n: bigint }[]>`
        SELECT m.category_id, COUNT(*) AS n
        FROM warranty_claims wc JOIN units u ON u.serial = wc.unit_serial JOIN models m ON m.id = u.model_id
        GROUP BY m.category_id`,
      this.units.expiringSoon(ctx.today, 5),
      // Same instant: keep the order the events were written in.
      this.prisma.unitEvent.findMany({ orderBy: [{ at: "desc" }, { id: "asc" }], take: 8 }),
      this.trend(ctx, null),
      this.apps(ctx),
    ]);
    const channel = new Map<ChannelCount["channel"], number>(CHANNELS.map((c) => [c, 0]));
    for (const row of byChannel) {
      // Bulk uploads are dealer registrations.
      const bucket = (row.channel === "BULK" ? "DEALER" : row.channel) as ChannelCount["channel"];
      channel.set(bucket, (channel.get(bucket) ?? 0) + row._count);
    }
    const statusCounts = new Map(byStatus.map((s) => [s.status as ClaimStatus, s._count]));
    const categoryCounts = new Map(byCategory.map((c) => [c.category_id, Number(c.n)]));
    return {
      role: "admin",
      units: Object.values(counts).reduce((a, b) => a + b, 0),
      active: counts.ACTIVE,
      expiring30: counts.EXPIRING_SOON,
      expired: counts.EXPIRED,
      pending: counts.PENDING,
      voided: counts.VOID,
      openClaims: OPEN_CLAIM.reduce((n, s) => n + (statusCounts.get(s) ?? 0), 0),
      pendingRegistrations,
      registrationsByChannel: CHANNELS.map((c) => ({ channel: c, count: channel.get(c) ?? 0 })),
      claimsByStatus: CLAIM_STATUSES.map((status) => ({ status, count: statusCounts.get(status) ?? 0 })),
      claimsByCategory: categories.map((c) => ({
        categoryId: c.id,
        categoryName: c.name,
        count: categoryCounts.get(c.id) ?? 0,
      })),
      expiringSoon: expiring.map((u) => ({
        serial: u.serial,
        modelName: u.model_name,
        customerName: u.customer_name ?? undefined,
        dealerName: u.dealer_name ?? undefined,
        warrantyEnd: fromDbDate(u.warranty_end),
        daysRemaining: Number(u.days_remaining),
      })),
      recentActivity: activity.map((e) => ({ ...toUnitEvent(e), serial: e.unitSerial })),
      trend,
      apps,
    };
  }

  /** A01 "Fieldpiece apps": products registered from Overwatch and Job Link, one entry per app (zeros allowed). */
  private async apps(ctx: Ctx): Promise<AppChannelStats[]> {
    const [stats, pending] = await Promise.all([
      this.units.channelStats(ctx.today, this.env.APP_TIMEZONE, FIELDPIECE_APP_CHANNELS),
      this.prisma.registration.groupBy({
        by: ["channel"],
        where: { status: "PENDING", channel: { in: [...FIELDPIECE_APP_CHANNELS] } },
        _count: true,
      }),
    ]);
    const none = { units: 0, active: 0, expiringSoon: 0, expired: 0, last30Days: 0, claims: 0 };
    return FIELDPIECE_APP_CHANNELS.map((channel) => {
      const { channel: _, ...counts } = stats.find((s) => s.channel === channel) ?? { channel, ...none };
      return {
        channel,
        ...counts,
        pendingRegistrations: pending.find((p) => p.channel === channel)?._count ?? 0,
      };
    });
  }

  private async customer(ctx: Ctx): Promise<DashboardSummary> {
    const [counts, openClaims] = await Promise.all([
      this.units.countByStatus(ctx.user, ctx.today),
      this.prisma.warrantyClaim.count({ where: { ...scopeWhere(ctx.user), status: { in: OPEN_CLAIM } } }),
    ]);
    return {
      role: "customer",
      units: Object.values(counts).reduce((a, b) => a + b, 0),
      active: counts.ACTIVE,
      expiringSoon: counts.EXPIRING_SOON,
      openClaims,
      unitsByStatus: byStatus(counts),
    };
  }

  /**
   * Registrations approved and claims filed per month, the last 12 months (oldest first), for the dealers in scope
   * (null = all). Months follow APP_TIMEZONE.
   */
  private async trend(ctx: Ctx, dealerIds: readonly string[] | null): Promise<MonthlyTrend[]> {
    const months = lastMonths(ctx.today, TREND_MONTHS);
    const tz = this.env.APP_TIMEZONE;
    const scope = dealerSql(dealerIds);
    const [registrations, claims] = await Promise.all([
      this.prisma.$queryRaw<{ month: string; n: bigint }[]>`
        SELECT to_char(COALESCE(reviewed_at, submitted_at) AT TIME ZONE ${tz}, 'YYYY-MM') AS month, COUNT(*) AS n
        FROM registrations
        WHERE status = 'APPROVED' AND ${scope}
        GROUP BY 1`,
      this.prisma.$queryRaw<{ month: string; n: bigint }[]>`
        SELECT to_char(created_at AT TIME ZONE ${tz}, 'YYYY-MM') AS month, COUNT(*) AS n
        FROM warranty_claims
        WHERE ${scope}
        GROUP BY 1`,
    ]);
    const regBy = new Map(registrations.map((r) => [r.month, Number(r.n)]));
    const claimsBy = new Map(claims.map((r) => [r.month, Number(r.n)]));
    return months.map((month) => ({
      month,
      registrations: regBy.get(month) ?? 0,
      claims: claimsBy.get(month) ?? 0,
    }));
  }

  /**
   * Warranty cost against budget over the rolling 12 months up to today (A01 / DL01 finance insights). Cost counts
   * approved and closed claims filed in the period (repair cost, replacement cost or the credit issued); extension
   * revenue counts extended warranties sold in the period. Dealers and distributors see their dealers' figures.
   */
  async finance(ctx: Ctx, requestedDealerId?: string): Promise<FinanceSummary> {
    const dealerIds = this.scopeDealers(ctx, requestedDealerId);
    const dealerWhere = dealerIds === null ? {} : { dealerId: { in: dealerIds } };
    const periodEnd = ctx.today;
    const periodStart = addDaysIso(addMonthsIso(periodEnd, -12), 1);
    const months = lastMonths(periodEnd, TREND_MONTHS);
    // Rows from a day earlier (UTC), then exactly by business date.
    const since = new Date(`${addDaysIso(periodStart, -1)}T00:00:00.000Z`);
    const businessDate = (d: Date) => isoDateIn(this.env.APP_TIMEZONE, d);
    const inPeriod = (d: Date) => {
      const day = businessDate(d);
      return day >= periodStart && day <= periodEnd;
    };

    const [models, categories, claimRows, extensionRows, unitGroups] = await Promise.all([
      this.prisma.model.findMany({
        include: { category: true },
        orderBy: [{ category: { position: "asc" } }, { position: "asc" }, { code: "asc" }],
      }),
      this.catalog.categories(),
      this.prisma.warrantyClaim.findMany({
        where: { ...dealerWhere, createdAt: { gte: since } },
        select: {
          status: true,
          resolution: true,
          creditAmount: true,
          createdAt: true,
          unit: { select: { modelId: true } },
        },
      }),
      this.prisma.warrantyExtension.findMany({
        where: { ...dealerWhere, createdAt: { gte: since } },
        select: { price: true, createdAt: true },
      }),
      this.prisma.unit.groupBy({
        by: ["modelId"],
        where: { ...dealerWhere, warrantyEnd: { not: null } },
        _count: true,
      }),
    ]);
    const modelById = new Map(models.map((m) => [m.id, m]));
    const financeOf = (modelId: string) => {
      const m = modelById.get(modelId);
      return { listPrice: m ? moneyOf(m.listPrice) : 0, repairCost: m ? moneyOf(m.repairCost) : 0 };
    };

    const claims = claimRows.filter((c) => inPeriod(c.createdAt));
    const settled = claims
      .filter((c) => SETTLED.includes(c.status as ClaimStatus) && c.resolution)
      .map((c) => {
        const resolution = c.resolution as Resolution;
        const credit = c.creditAmount === null ? undefined : moneyOf(c.creditAmount);
        return {
          modelId: c.unit.modelId,
          resolution,
          month: businessDate(c.createdAt).slice(0, 7),
          cost: claimCost(resolution, financeOf(c.unit.modelId), credit),
        };
      });
    const extensions = extensionRows
      .filter((e) => inPeriod(e.createdAt))
      .map((e) => ({ price: moneyOf(e.price), month: businessDate(e.createdAt).slice(0, 7) }));
    const unitsByModel = new Map(unitGroups.map((g) => [g.modelId, g._count]));

    return financeSummary({
      currency: this.env.APP_CURRENCY,
      periodStart,
      periodEnd,
      months,
      models: models.map((m) => ({
        id: m.id,
        code: m.code,
        name: m.name,
        categoryId: m.categoryId,
        categoryName: m.category.name,
        imageUrl: m.imageUrl ?? undefined,
        warrantyBudget: moneyOf(m.warrantyBudget),
        claimQuota: m.claimQuota,
      })),
      categories,
      settled,
      claimsByModel: claims.reduce(
        (map, c) => map.set(c.unit.modelId, (map.get(c.unit.modelId) ?? 0) + 1),
        new Map<string, number>(),
      ),
      extensions,
      unitsByModel,
    });
  }
}

interface FinanceInput {
  currency: string;
  periodStart: IsoDate;
  periodEnd: IsoDate;
  months: string[];
  models: {
    id: string;
    code: string;
    name: string;
    categoryId: string;
    categoryName: string;
    imageUrl?: string;
    warrantyBudget: number;
    claimQuota: number;
  }[];
  categories: { id: string; name: string }[];
  /** Approved and closed claims filed in the period, with their cost. */
  settled: { modelId: string; resolution: Resolution; month: string; cost: number }[];
  /** Every claim filed in the period, per model. */
  claimsByModel: ReadonlyMap<string, number>;
  extensions: { price: number; month: string }[];
  /** Registered products in scope, per model. */
  unitsByModel: ReadonlyMap<string, number>;
}

/** The finance summary from rows already scoped and limited to the period. */
function financeSummary(input: FinanceInput): FinanceSummary {
  const total = (rows: { cost: number }[]) => roundMoney(rows.reduce((n, r) => n + r.cost, 0));
  const warrantyCost = total(input.settled);
  const extensionRevenue = roundMoney(input.extensions.reduce((n, e) => n + e.price, 0));
  const modelIdsInScope = new Set(input.models.filter((m) => input.unitsByModel.get(m.id)).map((m) => m.id));
  const budget = roundMoney(
    input.models.filter((m) => modelIdsInScope.has(m.id)).reduce((n, m) => n + m.warrantyBudget, 0),
  );
  const categoryOf = new Map(input.models.map((m) => [m.id, m.categoryId]));

  const quotas: ModelQuota[] = input.models.flatMap((m) => {
    const units = input.unitsByModel.get(m.id) ?? 0;
    const spent = total(input.settled.filter((c) => c.modelId === m.id));
    const claims = input.claimsByModel.get(m.id) ?? 0;
    if (!units && !spent && !claims) return [];
    return [
      {
        modelId: m.id,
        modelCode: m.code,
        modelName: m.name,
        categoryName: m.categoryName,
        imageUrl: m.imageUrl,
        units,
        budget: m.warrantyBudget,
        spent,
        budgetUsedPct: percent(spent, m.warrantyBudget),
        claimQuota: m.claimQuota,
        claims,
        claimQuotaUsedPct: percent(claims, m.claimQuota),
      },
    ];
  });
  quotas.sort(
    (a, b) =>
      b.budgetUsedPct - a.budgetUsedPct || b.claims - a.claims || a.modelCode.localeCompare(b.modelCode),
  );

  return {
    currency: input.currency,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    warrantyCost,
    creditsIssued: total(input.settled.filter((c) => c.resolution === "CREDIT")),
    extensionRevenue,
    extensionsSold: input.extensions.length,
    netWarrantyCost: roundMoney(warrantyCost - extensionRevenue),
    budget,
    budgetUsedPct: percent(warrantyCost, budget),
    averageClaimCost: input.settled.length ? roundMoney(warrantyCost / input.settled.length) : 0,
    costByResolution: RESOLUTIONS.map((resolution) => {
      const rows = input.settled.filter((c) => c.resolution === resolution);
      return { resolution, amount: total(rows), count: rows.length };
    }),
    costByCategory: input.categories.map((c) => ({
      categoryId: c.id,
      categoryName: c.name,
      amount: total(input.settled.filter((s) => categoryOf.get(s.modelId) === c.id)),
    })),
    monthly: input.months.map((month) => ({
      month,
      cost: total(input.settled.filter((c) => c.month === month)),
      extensionRevenue: roundMoney(
        input.extensions.filter((e) => e.month === month).reduce((n, e) => n + e.price, 0),
      ),
    })),
    quotas,
  };
}

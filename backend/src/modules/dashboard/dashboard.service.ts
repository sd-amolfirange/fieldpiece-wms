import { Inject, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  CLAIM_STATUSES,
  isOpenClaim,
  type ChannelCount,
  type ClaimStatus,
  type DashboardSummary,
  type DealerStats,
} from "@wms/domain";
import type { Ctx } from "../../common/auth/context";
import { fromDbDate } from "../../common/db/dates";
import { ENV } from "../../config/config.module";
import type { Env } from "../../config/env";
import { PrismaService } from "../../infra/prisma/prisma.service";
import { scopeWhere } from "../../domain/scope";
import { toUnitEvent } from "../../domain/views";
import { CatalogService } from "../catalog";
import { UnitsRepository } from "../units";

// Dashboards (A01 warranty desk, DL01 dealer / distributor, customer home). Every number is computed in the caller's
// scope; a distributor may narrow everything to one of its dealers.

const OPEN_CLAIM = CLAIM_STATUSES.filter(isOpenClaim);
const CHANNELS: ChannelCount["channel"][] = ["DEALER", "PORTAL", "WEB", "EMAIL", "ERP", "API", "RETAIL"];

@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly units: UnitsRepository,
    private readonly catalog: CatalogService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async summary(ctx: Ctx, requestedDealerId?: string): Promise<DashboardSummary> {
    const { user } = ctx;
    if (user.role === "admin") return this.admin(ctx);
    if (user.role === "customer") return this.customer(ctx);

    // DL01 for a distributor: optionally one of its dealers (scoping still applies first).
    const dealerId = user.role === "distributor" && requestedDealerId ? requestedDealerId : undefined;
    const scoped = { AND: [scopeWhere(user), dealerId ? { dealerId } : {}] };
    const ids = user.visibleDealerIds ?? [];
    const visible = dealerId ? ids.filter((id) => id === dealerId) : ids;
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
    const [openClaims, dealers] = await Promise.all([
      this.prisma.warrantyClaim.groupBy({
        by: ["dealerId"],
        where: { ...scoped, status: { in: OPEN_CLAIM } },
        _count: true,
      }),
      this.catalog.dealers(user),
    ]);

    const regBy = new Map(registrations.map((r) => [r.dealer_id, r]));
    const claimsBy = new Map(openClaims.map((c) => [c.dealerId, c._count]));
    const perDealer: DealerStats[] = dealers.map((d) => ({
      dealerId: d.id,
      dealerName: d.name,
      registrationsThisMonth: Number(regBy.get(d.id)?.this_month ?? 0),
      pending: Number(regBy.get(d.id)?.pending ?? 0),
      openClaims: claimsBy.get(d.id) ?? 0,
    }));
    const sum = (key: "this_month" | "pending" | "rejected") =>
      registrations.reduce((n, r) => n + Number(r[key]), 0);
    return {
      role: user.role,
      registrationsThisMonth: sum("this_month"),
      pending: sum("pending"),
      rejected: sum("rejected"),
      openClaims: openClaims.reduce((n, c) => n + c._count, 0),
      dealers: perDealer,
    };
  }

  private async admin(ctx: Ctx): Promise<DashboardSummary> {
    const [counts, pendingRegistrations, byChannel, byStatus, categories, byCategory, expiring, activity] =
      await Promise.all([
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
    };
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
    };
  }
}

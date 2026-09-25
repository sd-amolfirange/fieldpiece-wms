import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { EXPIRING_SOON_DAYS, type IsoDate, type WarrantyStatus } from "@wms/domain";
import type { Actor } from "../../common/auth/context";
import { type ListQuery, resolveSort, type SortDirection } from "../../common/http/list-query";
import { type Db, PrismaService } from "../../infra/prisma/prisma.service";
import { unitInclude, type UnitRow } from "../../domain/views";

// Unit status in SQL, for filtering, sorting and counting. It mirrors unitWarranty() in shared/wms-domain:
// VOID when voided; PENDING without a fitted UNIT part; otherwise the UNIT part's end date against today (the end
// day itself is still covered; 30 days or fewer left = EXPIRING_SOON). Views always use the shared function; an
// e2e test checks the two agree. `today` is passed as text (yyyy-MM-dd), so no session time zone can shift it.

const statusSql = (today: IsoDate) => Prisma.sql`
  CASE
    WHEN u.voided_at IS NOT NULL THEN 'VOID'
    WHEN up.id IS NULL THEN 'PENDING'
    WHEN up.warranty_end < ${today}::date THEN 'EXPIRED'
    WHEN up.warranty_end - ${today}::date <= ${EXPIRING_SOON_DAYS} THEN 'EXPIRING_SOON'
    ELSE 'ACTIVE'
  END`;

const daysRemainingSql = (today: IsoDate) => Prisma.sql`
  CASE
    WHEN u.voided_at IS NOT NULL OR up.id IS NULL OR up.warranty_end < ${today}::date THEN 0
    ELSE up.warranty_end - ${today}::date
  END`;

/** Every unit with the columns the Units list can filter and sort on. */
const unitListSql = (today: IsoDate) => Prisma.sql`
  SELECT u.serial, u.dealer_id, u.customer_id, u.install_date, u.purchase_date, u.location,
         m.code AS model_code, m.name AS model_name, m.capacity, m.type AS unit_type, b.name AS brand_name,
         d.name AS dealer_name, c.name AS customer_name, up.warranty_end AS unit_warranty_end,
         ${statusSql(today)} AS status,
         ${daysRemainingSql(today)} AS days_remaining
  FROM units u
  JOIN models m ON m.id = u.model_id
  JOIN brands b ON b.id = u.brand_id
  LEFT JOIN dealers d ON d.id = u.dealer_id
  LEFT JOIN customers c ON c.id = u.customer_id
  LEFT JOIN unit_parts up ON up.unit_serial = u.serial AND up.part_type = 'UNIT' AND up.replaced_at IS NULL`;

/** SQL form of scopeWhere() for the aliased unit list. */
export function unitScopeSql(user: Actor): Prisma.Sql {
  if (user.role === "admin") return Prisma.sql`TRUE`;
  if (user.role === "customer") return Prisma.sql`v.customer_id = ${user.customerId ?? "\u0000"}`;
  const ids = user.visibleDealerIds ?? [];
  return ids.length ? Prisma.sql`v.dealer_id IN (${Prisma.join(ids)})` : Prisma.sql`FALSE`;
}

/** Literal text for ILIKE: % and _ in the search box match themselves. */
export const likePattern = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

// Column names come from this fixed allow-list only, never from input.
const col = (name: string) => (dir: SortDirection) => Prisma.raw(`v.${name} ${dir === "asc" ? "ASC" : "DESC"} NULLS LAST`);
const UNIT_SORTS: Record<string, (dir: SortDirection) => Prisma.Sql> = {
  serial: col("serial"),
  status: col("status"),
  daysRemaining: col("days_remaining"),
  modelCode: col("model_code"),
  modelName: col("model_name"),
  capacity: col("capacity"),
  unitType: col("unit_type"),
  brandName: col("brand_name"),
  dealerName: col("dealer_name"),
  customerName: col("customer_name"),
  installDate: col("install_date"),
  purchaseDate: col("purchase_date"),
  location: col("location"),
};

export interface UnitFilters {
  status?: WarrantyStatus;
  dealerId?: string;
}

@Injectable()
export class UnitsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** A page of unit serials in the caller's scope, plus the total. */
  async search(user: Actor, today: IsoDate, list: ListQuery, filters: UnitFilters): Promise<{ serials: string[]; total: number }> {
    const conditions: Prisma.Sql[] = [unitScopeSql(user)];
    if (filters.status) conditions.push(Prisma.sql`v.status = ${filters.status}`);
    if (filters.dealerId) conditions.push(Prisma.sql`v.dealer_id = ${filters.dealerId}`);
    if (list.q) {
      const like = likePattern(list.q);
      conditions.push(
        Prisma.sql`(v.serial ILIKE ${like} OR v.customer_name ILIKE ${like} OR v.dealer_name ILIKE ${like} OR v.model_code ILIKE ${like})`,
      );
    }
    const order = resolveSort(list.sort, UNIT_SORTS, "serial");
    const rows = await this.prisma.$queryRaw<{ serial: string; total: bigint }[]>`
      SELECT v.serial, COUNT(*) OVER () AS total
      FROM (${unitListSql(today)}) v
      WHERE ${Prisma.join(conditions, " AND ")}
      ORDER BY ${order}, v.serial ASC
      LIMIT ${list.pageSize} OFFSET ${(list.page - 1) * list.pageSize}`;
    if (rows.length) return { serials: rows.map((r) => r.serial), total: Number(rows[0]!.total) };
    // Past the last page: still report the total.
    const [count] = await this.prisma.$queryRaw<{ total: bigint }[]>`
      SELECT COUNT(*) AS total FROM (${unitListSql(today)}) v WHERE ${Prisma.join(conditions, " AND ")}`;
    return { serials: [], total: Number(count?.total ?? 0) };
  }

  /** Unit counts by status in the caller's scope (dashboards). */
  async countByStatus(user: Actor, today: IsoDate, dealerId?: string): Promise<Record<WarrantyStatus, number>> {
    const conditions = [unitScopeSql(user)];
    if (dealerId) conditions.push(Prisma.sql`v.dealer_id = ${dealerId}`);
    const rows = await this.prisma.$queryRaw<{ status: WarrantyStatus; n: bigint }[]>`
      SELECT v.status, COUNT(*) AS n FROM (${unitListSql(today)}) v
      WHERE ${Prisma.join(conditions, " AND ")} GROUP BY v.status`;
    const counts: Record<WarrantyStatus, number> = { ACTIVE: 0, EXPIRING_SOON: 0, EXPIRED: 0, VOID: 0, PENDING: 0 };
    for (const row of rows) counts[row.status] = Number(row.n);
    return counts;
  }

  /** Units whose warranty ends within 30 days, soonest first (A01). */
  async expiringSoon(today: IsoDate, limit: number) {
    return this.prisma.$queryRaw<
      {
        serial: string;
        model_name: string;
        customer_name: string | null;
        dealer_name: string | null;
        unit_warranty_end: Date;
        days_remaining: number;
      }[]
    >`
      SELECT v.serial, v.model_name, v.customer_name, v.dealer_name, v.unit_warranty_end, v.days_remaining
      FROM (${unitListSql(today)}) v
      WHERE v.status = 'EXPIRING_SOON'
      ORDER BY v.days_remaining ASC, v.serial ASC
      LIMIT ${limit}`;
  }

  /** Full rows for these serials, in the given order. */
  async load(db: Db, serials: readonly string[]): Promise<UnitRow[]> {
    if (!serials.length) return [];
    const rows = await db.unit.findMany({ where: { serial: { in: [...serials] } }, include: unitInclude });
    const bySerial = new Map(rows.map((r) => [r.serial, r]));
    return serials.flatMap((s) => bySerial.get(s) ?? []);
  }

  findOne(db: Db, serial: string): Promise<UnitRow | null> {
    return db.unit.findUnique({ where: { serial }, include: unitInclude });
  }

  /** Locks the unit row until the transaction ends, so concurrent changes to one unit run one at a time. */
  async lock(tx: Db, serial: string): Promise<void> {
    await tx.$queryRaw`SELECT serial FROM units WHERE serial = ${serial} FOR UPDATE`;
  }
}

import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { Db } from "../../infra/prisma/prisma.service";

// Reporting SQL (ADR-004): hand-written, parameterised `$queryRaw` tagged templates only.
// `$queryRawUnsafe` is banned by lint. Every optional filter is a bound parameter, never interpolated.

export interface ResolvedFilters {
  from: Date; // inclusive, 00:00 UTC
  toExclusive: Date; // exclusive, 00:00 UTC the day after `to`
  sku: string | null;
  family: string | null;
  region: string | null;
  distributorId: string | null;
}

/** The shared WHERE for claim-based reports. Assumes aliases c (claims), r, p, cu. */
function claimFilters(f: ResolvedFilters, dateColumn: Prisma.Sql = Prisma.sql`c.submitted_at`): Prisma.Sql {
  return Prisma.sql`
    ${dateColumn} >= ${f.from} AND ${dateColumn} < ${f.toExclusive}
    AND (${f.sku}::text IS NULL OR p.sku = ${f.sku})
    AND (${f.family}::text IS NULL OR p.family::text = ${f.family})
    AND (${f.region}::text IS NULL OR cu.address->>'region' = ${f.region})
    AND (${f.distributorId}::uuid IS NULL OR r.distributor_id = ${f.distributorId}::uuid)`;
}

const CLAIM_JOINS = Prisma.sql`
  FROM claims c
  JOIN registrations r ON r.id = c.registration_id
  JOIN products p ON p.id = r.product_id
  JOIN customers cu ON cu.id = r.customer_id`;

@Injectable()
export class ReportsRepository {
  byStatus(db: Db, f: ResolvedFilters) {
    return db.$queryRaw<{ status: string; count: bigint }[]>`
      SELECT c.status::text AS status, count(*) AS count
      ${CLAIM_JOINS}
      WHERE ${claimFilters(f)}
      GROUP BY c.status ORDER BY c.status`;
  }

  async submittedCount(db: Db, f: ResolvedFilters): Promise<number> {
    const [row] = await db.$queryRaw<{ count: bigint }[]>`
      SELECT count(*) AS count ${CLAIM_JOINS} WHERE ${claimFilters(f)}`;
    return Number(row?.count ?? 0);
  }

  async registrationCount(db: Db, f: ResolvedFilters): Promise<number> {
    const [row] = await db.$queryRaw<{ count: bigint }[]>`
      SELECT count(*) AS count
      FROM registrations r
      JOIN products p ON p.id = r.product_id
      JOIN customers cu ON cu.id = r.customer_id
      WHERE r.created_at >= ${f.from} AND r.created_at < ${f.toExclusive}
        AND (${f.sku}::text IS NULL OR p.sku = ${f.sku})
        AND (${f.family}::text IS NULL OR p.family::text = ${f.family})
        AND (${f.region}::text IS NULL OR cu.address->>'region' = ${f.region})
        AND (${f.distributorId}::uuid IS NULL OR r.distributor_id = ${f.distributorId}::uuid)`;
    return Number(row?.count ?? 0);
  }

  /** Point-in-time queue numbers (not date-filtered). Uses claims_queue_idx. */
  async queue(db: Db, distributorId: string | null, now: Date) {
    const [row] = await db.$queryRaw<{ open: bigint; unassigned: bigint; breached: bigint }[]>`
      SELECT
        count(*) FILTER (WHERE c.status IN ('SUBMITTED','IN_REVIEW','NEEDS_INFO','APPROVED','RMA_ISSUED','IN_TRANSIT','RECEIVED')) AS open,
        count(*) FILTER (WHERE c.status IN ('SUBMITTED','IN_REVIEW','NEEDS_INFO') AND c.assigned_to IS NULL) AS unassigned,
        count(*) FILTER (WHERE c.status IN ('SUBMITTED','IN_REVIEW') AND c.sla_due_at < ${now}) AS breached
      FROM claims c
      JOIN registrations r ON r.id = c.registration_id
      WHERE (${distributorId}::uuid IS NULL OR r.distributor_id = ${distributorId}::uuid)`;
    return {
      open: Number(row?.open ?? 0),
      unassigned: Number(row?.unassigned ?? 0),
      breached: Number(row?.breached ?? 0),
    };
  }

  async avgResolutionDays(db: Db, f: ResolvedFilters): Promise<number | null> {
    const [row] = await db.$queryRaw<{ avg: number | null }[]>`
      SELECT avg(EXTRACT(EPOCH FROM (coalesce(c.closed_at, c.updated_at) - c.submitted_at)) / 86400)::float8 AS avg
      ${CLAIM_JOINS}
      WHERE ${claimFilters(f)} AND c.status IN ('REPAIRED','REPLACED','CREDITED','REJECTED','CLOSED')`;
    return row?.avg == null ? null : Math.round(row.avg * 10) / 10;
  }

  claimsOverTime(db: Db, f: ResolvedFilters) {
    return db.$queryRaw<{ date: Date; count: bigint }[]>`
      SELECT date_trunc('day', c.submitted_at)::date AS date, count(*) AS count
      ${CLAIM_JOINS}
      WHERE ${claimFilters(f)}
      GROUP BY 1 ORDER BY 1`;
  }

  claimRateBySku(db: Db, f: ResolvedFilters) {
    return db.$queryRaw<{ sku: string; name: string; registrations: bigint; claims: bigint }[]>`
      SELECT p.sku, p.name,
        count(DISTINCT r.id) AS registrations,
        count(DISTINCT c.id) FILTER (WHERE c.submitted_at >= ${f.from} AND c.submitted_at < ${f.toExclusive}) AS claims
      FROM products p
      JOIN registrations r ON r.product_id = p.id
      JOIN customers cu ON cu.id = r.customer_id
      LEFT JOIN claims c ON c.registration_id = r.id
      WHERE (${f.sku}::text IS NULL OR p.sku = ${f.sku})
        AND (${f.family}::text IS NULL OR p.family::text = ${f.family})
        AND (${f.region}::text IS NULL OR cu.address->>'region' = ${f.region})
        AND (${f.distributorId}::uuid IS NULL OR r.distributor_id = ${f.distributorId}::uuid)
      GROUP BY p.sku, p.name
      HAVING count(DISTINCT r.id) > 0`;
  }

  failureCategories(db: Db, f: ResolvedFilters) {
    return db.$queryRaw<{ category: string; label: string; count: bigint }[]>`
      SELECT c.failure_category AS category, fc.label, count(*) AS count
      ${CLAIM_JOINS}
      JOIN failure_categories fc ON fc.code = c.failure_category
      WHERE ${claimFilters(f)}
      GROUP BY c.failure_category, fc.label ORDER BY count DESC`;
  }

  resolutionTime(db: Db, f: ResolvedFilters) {
    return db.$queryRaw<{ week: Date; avg_days: number; count: bigint }[]>`
      SELECT date_trunc('week', c.submitted_at)::date AS week,
        avg(EXTRACT(EPOCH FROM (coalesce(c.closed_at, c.updated_at) - c.submitted_at)) / 86400)::float8 AS avg_days,
        count(*) AS count
      ${CLAIM_JOINS}
      WHERE ${claimFilters(f)} AND c.status IN ('REPAIRED','REPLACED','CREDITED','REJECTED','CLOSED')
      GROUP BY 1 ORDER BY 1`;
  }

  cost(db: Db, f: ResolvedFilters) {
    return db.$queryRaw<
      { type: string; count: bigint; credit_total: Prisma.Decimal | null; currency: string | null }[]
    >`
      SELECT m.type, count(*) AS count, sum(m.credit_amount) AS credit_total, max(m.credit_currency) AS currency
      FROM rmas m
      JOIN claims c ON c.id = m.claim_id
      JOIN registrations r ON r.id = c.registration_id
      JOIN products p ON p.id = r.product_id
      JOIN customers cu ON cu.id = r.customer_id
      WHERE ${claimFilters(f, Prisma.sql`m.created_at`)}
      GROUP BY m.type ORDER BY m.type`;
  }
}

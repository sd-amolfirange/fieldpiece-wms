import { HttpStatus, Injectable } from "@nestjs/common";
import { Prisma, type WarrantyPolicy } from "@prisma/client";
import type { RequestContext } from "../../common/auth/auth-user";
import { AppError } from "../../common/errors/app-error";
import { ErrorCode } from "../../common/errors/error-codes";
import { Clock } from "../../common/time/clock";
import { formatIsoDate, parseIsoDate, startOfUtcDay } from "../../common/time/utc-date";
import { CacheService } from "../../infra/redis/cache.service";
import { type Db, PrismaService } from "../../infra/prisma/prisma.service";
import { AuditService } from "../audit";
import { selectPolicy } from "../warranty";
import type { CreatePolicyInput, PolicyResponse, UpdatePolicyInput } from "./dto";
import { type PolicyRow, PoliciesRepository } from "./policies.repository";

export const POLICY_CACHE_PREFIX = "policies:";

/** Fields that define coverage; frozen once a registration references the policy (Section 8.1). */
const TERM_FIELDS = [
  "baseMonths",
  "registrationBonusMonths",
  "registrationWindowDays",
  "effectiveFrom",
] as const;

function toResponse(p: PolicyRow): PolicyResponse {
  return {
    id: p.id,
    productId: p.productId,
    sku: p.product?.sku ?? null,
    baseMonths: p.baseMonths,
    registrationBonusMonths: p.registrationBonusMonths,
    registrationWindowDays: p.registrationWindowDays,
    coverage: p.coverage,
    exclusions: p.exclusions,
    effectiveFrom: formatIsoDate(p.effectiveFrom),
    effectiveTo: p.effectiveTo ? formatIsoDate(p.effectiveTo) : null,
    inUse: p._count.registrations > 0,
  };
}

function mapConstraintError(err: unknown): never {
  const message = err instanceof Error ? err.message : "";
  if (message.includes("no_overlapping_policies") || message.includes("23P01")) {
    throw AppError.conflict(
      ErrorCode.POLICY_OVERLAP,
      "Another policy already covers part of this date range.",
    );
  }
  throw err;
}

@Injectable()
export class PoliciesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: PoliciesRepository,
    private readonly audit: AuditService,
    private readonly cache: CacheService,
    private readonly clock: Clock,
  ) {}

  async list(filter: { sku?: string; activeOn?: string }): Promise<PolicyResponse[]> {
    const where: Prisma.WarrantyPolicyWhereInput = {};
    if (filter.sku) where.product = { sku: filter.sku };
    if (filter.activeOn) {
      const day = parseIsoDate(filter.activeOn);
      where.effectiveFrom = { lte: day };
      where.AND = [{ OR: [{ effectiveTo: null }, { effectiveTo: { gt: day } }] }];
    }
    return (await this.repo.list(this.prisma, where)).map(toResponse);
  }

  /** The policy in effect for a product on a date, falling back to the default policy. */
  async policyFor(db: Db, productId: string, on: Date): Promise<WarrantyPolicy | null> {
    return selectPolicy(await this.repo.candidates(db, [productId], startOfUtcDay(on)), productId, on);
  }

  /** Current terms per product, for catalogue display. Cached 10 minutes (Section 9.3). */
  async currentTerms(
    productIds: string[],
  ): Promise<Map<string, { baseMonths: number; registrationBonusMonths: number }>> {
    const today = startOfUtcDay(this.clock.now());
    const key = `${POLICY_CACHE_PREFIX}current:${formatIsoDate(today)}`;
    const all = await this.cache.getOrSet(key, 600, async () =>
      (
        await this.prisma.warrantyPolicy.findMany({
          where: {
            effectiveFrom: { lte: today },
            OR: [{ effectiveTo: null }, { effectiveTo: { gt: today } }],
          },
        })
      ).map((p) => ({
        ...p,
        effectiveFrom: p.effectiveFrom.toISOString(),
        effectiveTo: p.effectiveTo?.toISOString() ?? null,
      })),
    );
    const candidates = all.map((p) => ({
      ...p,
      effectiveFrom: new Date(p.effectiveFrom),
      effectiveTo: p.effectiveTo ? new Date(p.effectiveTo) : null,
    }));
    const result = new Map<string, { baseMonths: number; registrationBonusMonths: number }>();
    for (const id of productIds) {
      const policy = selectPolicy(candidates, id, today);
      if (policy)
        result.set(id, {
          baseMonths: policy.baseMonths,
          registrationBonusMonths: policy.registrationBonusMonths,
        });
    }
    return result;
  }

  async create(ctx: RequestContext, input: CreatePolicyInput): Promise<PolicyResponse> {
    const product = input.sku ? await this.prisma.product.findUnique({ where: { sku: input.sku } }) : null;
    if (input.sku && !product) {
      throw AppError.unprocessable(ErrorCode.PRODUCT_NOT_FOUND, "No product with that SKU.", {
        sku: ["Unknown SKU."],
      });
    }
    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const row = await this.repo.create(tx, {
          productId: product?.id ?? null,
          baseMonths: input.baseMonths,
          registrationBonusMonths: input.registrationBonusMonths,
          registrationWindowDays: input.registrationWindowDays,
          coverage: input.coverage,
          exclusions: input.exclusions,
          effectiveFrom: parseIsoDate(input.effectiveFrom),
          effectiveTo: input.effectiveTo ? parseIsoDate(input.effectiveTo) : null,
        });
        await this.audit.record(tx, ctx, {
          action: "policy.created",
          entity: "warranty_policy",
          entityId: row.id,
          after: input,
        });
        return row;
      });
      await this.cache.delByPrefix(POLICY_CACHE_PREFIX);
      return toResponse(created);
    } catch (err) {
      mapConstraintError(err);
    }
  }

  async update(ctx: RequestContext, id: string, patch: UpdatePolicyInput): Promise<PolicyResponse> {
    try {
      const updated = await this.prisma.$transaction(async (tx) => {
        const before = await this.repo.findById(tx, id);
        if (!before) throw AppError.notFound("Policy");
        if (before._count.registrations > 0 && TERM_FIELDS.some((f) => patch[f] !== undefined)) {
          throw new AppError(
            ErrorCode.VALIDATION_FAILED,
            HttpStatus.UNPROCESSABLE_ENTITY,
            "Registrations already use this policy, so its terms are frozen. End it and create a new one.",
          );
        }
        const row = await this.repo.update(tx, id, {
          ...patch,
          effectiveFrom: patch.effectiveFrom ? parseIsoDate(patch.effectiveFrom) : undefined,
          effectiveTo:
            patch.effectiveTo === undefined
              ? undefined
              : patch.effectiveTo
                ? parseIsoDate(patch.effectiveTo)
                : null,
        });
        await this.audit.record(tx, ctx, {
          action: "policy.updated",
          entity: "warranty_policy",
          entityId: id,
          before: toResponse(before),
          after: patch,
        });
        return row;
      });
      await this.cache.delByPrefix(POLICY_CACHE_PREFIX);
      return toResponse(updated);
    } catch (err) {
      if (err instanceof AppError) throw err;
      mapConstraintError(err);
    }
  }
}

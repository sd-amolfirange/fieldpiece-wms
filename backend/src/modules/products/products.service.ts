import { Inject, Injectable } from "@nestjs/common";
import { Prisma, type Product } from "@prisma/client";
import { createHash } from "node:crypto";
import type { RequestContext } from "../../common/auth/auth-user";
import { AppError } from "../../common/errors/app-error";
import { ErrorCode } from "../../common/errors/error-codes";
import { productImageUrl } from "../../common/files/product-image";
import { orderByFrom, pageArgs, type Paginated } from "../../common/pagination/pagination";
import { formatIsoDate, parseIsoDate } from "../../common/time/utc-date";
import { ENV } from "../../config/config.module";
import type { Env } from "../../config/env";
import { CacheService } from "../../infra/redis/cache.service";
import { type Db, PrismaService } from "../../infra/prisma/prisma.service";
import { AuditService } from "../audit";
import { PoliciesService } from "../policies";
import type { CreateProductDto, ProductListQueryDto, ProductResponse, UpdateProductDto } from "./dto";
import { ProductsRepository } from "./products.repository";

const CACHE_PREFIX = "products:";
const CACHE_TTL = 600; // 10 min (Section 9.3)

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: ProductsRepository,
    private readonly policies: PoliciesService,
    private readonly audit: AuditService,
    private readonly cache: CacheService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async list(query: ProductListQueryDto): Promise<Paginated<ProductResponse>> {
    const key = `${CACHE_PREFIX}list:${createHash("sha1").update(JSON.stringify(query)).digest("hex")}`;
    return this.cache.getOrSet(key, CACHE_TTL, async () => {
      const where: Prisma.ProductWhereInput = {
        deletedAt: null,
        isActive: query.includeInactive === "true" ? undefined : true,
        family: query.family,
        OR: query.q
          ? [
              { sku: { contains: query.q, mode: "insensitive" } },
              { name: { contains: query.q, mode: "insensitive" } },
            ]
          : undefined,
      };
      const orderBy = orderByFrom<Prisma.ProductOrderByWithRelationInput>(
        query.sort,
        {
          sku: (d) => ({ sku: d }),
          name: (d) => ({ name: d }),
          family: (d) => ({ family: d }),
          launchDate: (d) => ({ launchDate: d }),
        },
        "sku",
      );
      const { skip, take } = pageArgs(query);
      const { items, total } = await this.repo.list(this.prisma, where, skip, take, orderBy);
      return { items: await this.withTerms(items), page: query.page, pageSize: query.pageSize, total };
    });
  }

  async getBySku(sku: string): Promise<ProductResponse> {
    const product = await this.cache.getOrSet(`${CACHE_PREFIX}sku:${sku}`, CACHE_TTL, async () => {
      const row = await this.repo.findBySku(this.prisma, sku.toUpperCase());
      return row ? ((await this.withTerms([row]))[0] ?? null) : null;
    });
    if (!product) throw AppError.notFound("Product");
    return product;
  }

  /** The raw row, for other modules' business rules (serial pattern, launch date). */
  findBySku(db: Db, sku: string): Promise<Product | null> {
    return this.repo.findBySku(db, sku.toUpperCase());
  }

  async create(ctx: RequestContext, input: CreateProductDto): Promise<ProductResponse> {
    try {
      const row = await this.prisma.$transaction(async (tx) => {
        const created = await this.repo.create(tx, {
          ...input,
          launchDate: input.launchDate ? parseIsoDate(input.launchDate) : null,
        });
        await this.audit.record(tx, ctx, {
          action: "product.created",
          entity: "product",
          entityId: created.id,
          after: input,
        });
        return created;
      });
      await this.invalidate();
      return (await this.withTerms([row]))[0]!;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw AppError.conflict(ErrorCode.CONFLICT, "A product with this SKU already exists.");
      }
      throw err;
    }
  }

  async update(ctx: RequestContext, sku: string, patch: UpdateProductDto): Promise<ProductResponse> {
    const row = await this.prisma.$transaction(async (tx) => {
      const before = await this.repo.findBySku(tx, sku.toUpperCase());
      if (!before) throw AppError.notFound("Product");
      const updated = await this.repo.update(tx, before.id, {
        ...patch,
        launchDate:
          patch.launchDate === undefined
            ? undefined
            : patch.launchDate
              ? parseIsoDate(patch.launchDate)
              : null,
      });
      await this.audit.record(tx, ctx, {
        action: "product.updated",
        entity: "product",
        entityId: before.id,
        after: patch,
      });
      return updated;
    });
    await this.invalidate();
    return (await this.withTerms([row]))[0]!;
  }

  /** Drops cached lists and details after any product change. */
  invalidate(): Promise<void> {
    return this.cache.delByPrefix(CACHE_PREFIX);
  }

  private async withTerms(products: Product[]): Promise<ProductResponse[]> {
    const terms = await this.policies.currentTerms(products.map((p) => p.id));
    return products.map((p) => ({
      id: p.id,
      sku: p.sku,
      name: p.name,
      family: p.family,
      serialPattern: p.serialPattern,
      launchDate: p.launchDate ? formatIsoDate(p.launchDate) : null,
      imageUrl: productImageUrl(this.env, p.sku, p.imageKey),
      isActive: p.isActive,
      warrantyMonths: terms.get(p.id)?.baseMonths ?? null,
      registrationBonusMonths: terms.get(p.id)?.registrationBonusMonths ?? null,
    }));
  }
}

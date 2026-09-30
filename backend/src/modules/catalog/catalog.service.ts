import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  modelFormat,
  publicModelView,
  type DealerView,
  type ModelFormat,
  type ModelView,
  type OrgStructure,
  type ProductCategory,
  type Role,
} from "@wms/domain";
import type { Actor } from "../../common/auth/context";
import { opt } from "../../common/db/dates";
import { AppError } from "../../common/errors/app-error";
import { type Db, PrismaService } from "../../infra/prisma/prisma.service";
import { modelInclude, toDealer, toDealerView, toModelView } from "../../domain/views";

export interface ModelFinanceInput {
  listPrice?: unknown;
  repairCost?: unknown;
  warrantyBudget?: unknown;
  claimQuota?: unknown;
}

const MONEY_FIELDS = ["listPrice", "repairCost", "warrantyBudget"] as const;
const MAX_MONEY = 1_000_000;
const MAX_CLAIM_QUOTA = 10_000;

/** A non-negative amount with at most 2 decimals, up to MAX_MONEY. */
const isMoney = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  value >= 0 &&
  value <= MAX_MONEY &&
  Math.abs(Math.round(value * 100) - value * 100) < 1e-6;

/** Fieldpiece product catalogue (A06) and the distributor -> dealer hierarchy (A11). */
@Injectable()
export class CatalogService {
  constructor(private readonly prisma: PrismaService) {}

  /** `withFinance`: include the internal finance figures (warranty desk only). */
  async models(withFinance = false): Promise<ModelView[]> {
    const rows = await this.prisma.model.findMany({
      include: modelInclude,
      orderBy: [{ category: { position: "asc" } }, { position: "asc" }, { code: "asc" }],
    });
    const views = rows.map(toModelView);
    return withFinance ? views : views.map(publicModelView);
  }

  /** A06: the warranty desk sets a model's list price, repair cost and warranty quota. Omitted fields keep their value. */
  async updateModel(id: string, body: ModelFinanceInput): Promise<ModelView> {
    const errors: Record<string, string> = {};
    const data: Prisma.ModelUpdateInput = {};
    for (const field of MONEY_FIELDS) {
      const value = body[field];
      if (value === undefined) continue;
      if (!isMoney(value)) errors[field] = "validation.amount";
      else data[field] = new Prisma.Decimal(value.toFixed(2));
    }
    if (body.claimQuota !== undefined) {
      const quota = body.claimQuota;
      if (typeof quota !== "number" || !Number.isInteger(quota) || quota < 0 || quota > MAX_CLAIM_QUOTA)
        errors.claimQuota = "validation.quota";
      else data.claimQuota = quota;
    }
    if (Object.keys(errors).length) throw AppError.validation("Check the highlighted fields.", errors);
    const existing = await this.prisma.model.findUnique({ where: { id }, select: { id: true } });
    if (!existing) throw AppError.notFound("Model");
    return toModelView(await this.prisma.model.update({ where: { id }, data, include: modelInclude }));
  }

  categories(): Promise<ProductCategory[]> {
    return this.prisma.productCategory.findMany({
      select: { id: true, name: true },
      orderBy: [{ position: "asc" }, { name: "asc" }],
    });
  }

  /** Dealers the caller may see: admin all, distributor its dealers, dealer itself. */
  async dealers(user: Actor): Promise<DealerView[]> {
    const rows = await this.prisma.dealer.findMany({
      where: user.visibleDealerIds === null ? {} : { id: { in: user.visibleDealerIds } },
      include: { distributor: true },
      orderBy: [{ position: "asc" }, { name: "asc" }],
    });
    return rows.map(toDealerView);
  }

  async org(): Promise<OrgStructure> {
    const [distributors, dealers, users] = await Promise.all([
      this.prisma.distributor.findMany({ orderBy: [{ position: "asc" }, { name: "asc" }] }),
      this.prisma.dealer.findMany({ orderBy: [{ position: "asc" }, { name: "asc" }] }),
      this.prisma.user.findMany({
        include: { dealer: true, distributor: true, customer: true },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      }),
    ]);
    return {
      distributors: distributors.map((d) => ({
        id: d.id,
        name: d.name,
        city: d.city,
        state: d.state,
        dealers: dealers.filter((x) => x.distributorId === d.id).map(toDealer),
      })),
      directDealers: dealers.filter((d) => !d.distributorId).map(toDealer),
      users: users.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        role: u.role as Role,
        dealerId: opt(u.dealerId),
        distributorId: opt(u.distributorId),
        customerId: opt(u.customerId),
        orgName: u.dealer?.name ?? u.distributor?.name ?? u.customer?.name,
      })),
    };
  }

  /** Model code -> its serial and batch formats, for registration row checks. */
  async modelFormats(db: Db = this.prisma): Promise<Map<string, ModelFormat>> {
    const rows = await db.model.findMany({ select: { code: true, serialPattern: true, batchPattern: true } });
    return new Map(rows.map((m) => [m.code, modelFormat(m)]));
  }

  /** Model code -> its product photo, for any screen that shows a registration or claim by model code alone. */
  async modelImages(db: Db = this.prisma): Promise<Map<string, string | undefined>> {
    const rows = await db.model.findMany({ select: { code: true, imageUrl: true } });
    return new Map(rows.map((m) => [m.code, m.imageUrl ?? undefined]));
  }

  async dealerIds(db: Db = this.prisma): Promise<string[]> {
    return (await db.dealer.findMany({ select: { id: true } })).map((d) => d.id);
  }
}

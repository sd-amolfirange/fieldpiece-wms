import { Injectable } from "@nestjs/common";
import type { Brand, DealerView, ModelView, OrgStructure, Role } from "@wms/domain";
import type { Actor } from "../../common/auth/context";
import { opt } from "../../common/db/dates";
import { type Db, PrismaService } from "../../infra/prisma/prisma.service";
import { modelInclude, toDealer, toDealerView, toModelView } from "../../domain/views";

/** Product master (A06) and the distributor -> dealer hierarchy (A11). */
@Injectable()
export class CatalogService {
  constructor(private readonly prisma: PrismaService) {}

  async models(): Promise<ModelView[]> {
    const rows = await this.prisma.model.findMany({ include: modelInclude, orderBy: [{ position: "asc" }, { code: "asc" }] });
    return rows.map(toModelView);
  }

  brands(): Promise<Brand[]> {
    return this.prisma.brand.findMany({ select: { id: true, name: true }, orderBy: [{ position: "asc" }, { name: "asc" }] });
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

  /** Model codes in the product master, for registration row checks. */
  async modelCodes(db: Db = this.prisma): Promise<Set<string>> {
    return new Set((await db.model.findMany({ select: { code: true } })).map((m) => m.code));
  }

  async dealerIds(db: Db = this.prisma): Promise<string[]> {
    return (await db.dealer.findMany({ select: { id: true } })).map((d) => d.id);
  }
}

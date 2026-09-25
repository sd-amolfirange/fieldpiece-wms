import { Injectable } from "@nestjs/common";
import type { Customer, Prisma } from "@prisma/client";
import type { AuthUser, RequestContext } from "../../common/auth/auth-user";
import { customerScope } from "../../common/auth/scope";
import { AppError } from "../../common/errors/app-error";
import { ErrorCode } from "../../common/errors/error-codes";
import { orderByFrom, pageArgs, type Paginated } from "../../common/pagination/pagination";
import type { Address } from "../../common/validation/schemas";
import { type Db, PrismaService, type Tx } from "../../infra/prisma/prisma.service";
import { AuditService } from "../audit";
import type {
  CreateCustomerDto,
  CustomerInput,
  CustomerListQueryDto,
  CustomerResponse,
  UpdateCustomerDto,
} from "./dto";
import { CustomersRepository } from "./customers.repository";

export function toCustomerResponse(c: Customer): CustomerResponse {
  return {
    id: c.id,
    companyName: c.companyName,
    contactName: c.contactName,
    email: c.email,
    phone: c.phone,
    address: (c.address ?? {}) as Partial<Address>,
    distributorId: c.distributorId,
    hasLogin: c.userId !== null,
    createdAt: c.createdAt.toISOString(),
  };
}

/** Field names only: audit rows never carry contact details (Section 11.5). */
const changedFields = (input: object) => ({ fields: Object.keys(input) });

@Injectable()
export class CustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: CustomersRepository,
    private readonly audit: AuditService,
  ) {}

  async list(user: AuthUser, query: CustomerListQueryDto): Promise<Paginated<CustomerResponse>> {
    const where: Prisma.CustomerWhereInput = {
      AND: [
        customerScope(user),
        query.q
          ? {
              OR: [
                { companyName: { contains: query.q, mode: "insensitive" } },
                { contactName: { contains: query.q, mode: "insensitive" } },
                { email: { contains: query.q, mode: "insensitive" } },
              ],
            }
          : {},
      ],
    };
    const orderBy = orderByFrom<Prisma.CustomerOrderByWithRelationInput>(
      query.sort,
      {
        contactName: (d) => ({ contactName: d }),
        companyName: (d) => ({ companyName: { sort: d, nulls: "last" } }),
        createdAt: (d) => ({ createdAt: d }),
      },
      "contactName",
    );
    const { skip, take } = pageArgs(query);
    const { items, total } = await this.repo.list(this.prisma, where, skip, take, orderBy);
    return { items: items.map(toCustomerResponse), page: query.page, pageSize: query.pageSize, total };
  }

  async get(user: AuthUser, id: string): Promise<CustomerResponse> {
    return toCustomerResponse(await this.getScoped(this.prisma, user, id));
  }

  /** Scoped load; out-of-scope rows are a 404 (Section 7.2). */
  async getScoped(db: Db, user: AuthUser, id: string): Promise<Customer> {
    const customer = await this.repo.findScoped(db, id, customerScope(user));
    if (!customer) throw AppError.notFound("Customer");
    return customer;
  }

  async create(ctx: RequestContext, input: CreateCustomerDto): Promise<CustomerResponse> {
    const { user } = ctx;
    const distributorId = user.hasAny("claims_agent", "admin")
      ? (input.distributorId ?? null)
      : user.organizationId;
    if (user.has("distributor") && !user.hasAny("claims_agent", "admin") && !distributorId) {
      throw AppError.forbidden("Your account isn't linked to a distributor.");
    }
    return this.prisma.$transaction(async (tx) => {
      const created = await this.createForOrg(tx, ctx, input, distributorId);
      return toCustomerResponse(created);
    });
  }

  async update(ctx: RequestContext, id: string, input: UpdateCustomerDto): Promise<CustomerResponse> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await this.getScoped(tx, ctx.user, id);
      const updated = await this.repo.update(tx, existing.id, input);
      await this.audit.record(tx, ctx, {
        action: "customer.updated",
        entity: "customer",
        entityId: id,
        after: changedFields(input),
      });
      return toCustomerResponse(updated);
    });
  }

  /** Creates a customer owned by a distributor (or none). Used by registrations inside their transaction. */
  async createForOrg(
    tx: Tx,
    ctx: RequestContext,
    input: CustomerInput,
    distributorId: string | null,
  ): Promise<Customer> {
    const created = await this.repo.create(tx, {
      companyName: input.companyName ?? null,
      contactName: input.contactName,
      email: input.email ?? null,
      phone: input.phone ?? null,
      address: input.address,
      distributorId,
    });
    await this.audit.record(tx, ctx, {
      action: "customer.created",
      entity: "customer",
      entityId: created.id,
      after: { distributorId },
    });
    return created;
  }

  /**
   * A technician registers their own units: reuse (and refresh) the customer row linked to their login,
   * or create it on first registration.
   */
  async ensureSelfCustomer(tx: Tx, ctx: RequestContext, input: CustomerInput | undefined): Promise<Customer> {
    const existing = await this.repo.findByUser(tx, ctx.user.id);
    if (existing) return input ? this.repo.update(tx, existing.id, input) : existing;
    if (!input) {
      throw AppError.unprocessable(ErrorCode.CUSTOMER_REQUIRED, "Add your contact details and address.", {
        customer: ["Required for your first registration."],
      });
    }
    const created = await this.repo.create(tx, {
      userId: ctx.user.id,
      companyName: input.companyName ?? null,
      contactName: input.contactName,
      email: input.email ?? ctx.user.email,
      phone: input.phone ?? null,
      address: input.address,
    });
    await this.audit.record(tx, ctx, {
      action: "customer.created",
      entity: "customer",
      entityId: created.id,
      after: { self: true },
    });
    return created;
  }
}

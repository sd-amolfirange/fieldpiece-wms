import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import { Prisma, type Customer } from "@prisma/client";
import type { AuthUser, RequestContext } from "../../common/auth/auth-user";
import { registrationScope } from "../../common/auth/scope";
import { AppError } from "../../common/errors/app-error";
import { ErrorCode } from "../../common/errors/error-codes";
import { orderByFrom, pageArgs, type Paginated } from "../../common/pagination/pagination";
import { Clock } from "../../common/time/clock";
import { addUtcDays, formatIsoDate, parseIsoDate, startOfUtcDay } from "../../common/time/utc-date";
import { ENV } from "../../config/config.module";
import type { Env } from "../../config/env";
import { OutboxService } from "../../infra/outbox/outbox.service";
import { PrismaService, type Tx } from "../../infra/prisma/prisma.service";
import { BlobStorage } from "../../infra/storage/blob-storage";
import { AttachmentsService } from "../attachments";
import { AuditService } from "../audit";
import { CustomersService } from "../customers";
import { PoliciesService } from "../policies";
import { ProductsService } from "../products";
import { computeWarranty, computeWarrantyStatus, WarrantyService } from "../warranty";
import type {
  CreateRegistrationInput,
  RegistrationDetailResponse,
  RegistrationListQueryDto,
  RegistrationResponse,
} from "./dto";
import { checkRegistrationRules } from "./registration-rules";
import { type RegistrationRow, RegistrationsRepository } from "./registrations.repository";

const CERT_URL_TTL = 300;

@Injectable()
export class RegistrationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: RegistrationsRepository,
    private readonly products: ProductsService,
    private readonly policies: PoliciesService,
    private readonly customers: CustomersService,
    private readonly attachments: AttachmentsService,
    private readonly warranty: WarrantyService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly storage: BlobStorage,
    private readonly clock: Clock,
    @Inject(ENV) private readonly env: Env,
  ) {}

  toResponse(r: RegistrationRow): RegistrationResponse {
    return {
      id: r.id,
      serialNumber: r.serialNumber,
      sku: r.product.sku,
      productName: r.product.name,
      customerId: r.customerId,
      customerName: r.customer.companyName ?? r.customer.contactName,
      distributorId: r.distributorId,
      policyId: r.policyId,
      purchaseDate: formatIsoDate(r.purchaseDate),
      warrantyStart: formatIsoDate(r.warrantyStart),
      warrantyEnd: formatIsoDate(r.warrantyEnd),
      status: computeWarrantyStatus({
        status: r.status,
        warrantyEnd: r.warrantyEnd,
        today: this.clock.now(),
        expiringSoonDays: this.env.EXPIRING_SOON_DAYS,
      }),
      replacesRegistrationId: r.replacesRegistrationId,
      certificateReady: r.certificateKey !== null,
      version: r.version,
      createdAt: r.createdAt.toISOString(),
    };
  }

  async list(user: AuthUser, query: RegistrationListQueryDto): Promise<Paginated<RegistrationResponse>> {
    const where: Prisma.RegistrationWhereInput = {
      AND: [
        registrationScope(user),
        this.statusFilter(query.status),
        query.customerId ? { customerId: query.customerId } : {},
        query.sku ? { product: { sku: query.sku } } : {},
        query.serial ? { serialNumber: { equals: query.serial, mode: "insensitive" } } : {},
        query.q ? { serialNumber: { contains: query.q, mode: "insensitive" } } : {},
      ],
    };
    const orderBy = orderByFrom<Prisma.RegistrationOrderByWithRelationInput>(
      query.sort,
      {
        createdAt: (d) => ({ createdAt: d }),
        purchaseDate: (d) => ({ purchaseDate: d }),
        warrantyEnd: (d) => ({ warrantyEnd: d }),
        serialNumber: (d) => ({ serialNumber: d }),
      },
      "-createdAt",
    );
    const { skip, take } = pageArgs(query);
    const { items, total } = await this.repo.list(this.prisma, where, skip, take, orderBy);
    return { items: items.map((r) => this.toResponse(r)), page: query.page, pageSize: query.pageSize, total };
  }

  async get(user: AuthUser, id: string): Promise<RegistrationDetailResponse> {
    const row = await this.repo.findScoped(this.prisma, id, registrationScope(user));
    if (!row) throw AppError.notFound("Registration");
    return {
      ...this.toResponse(row),
      proofOfPurchase: await this.attachments.forOwner(this.prisma, "registration", id),
      claimCount: row._count.claims,
    };
  }

  /** Scoped lookup by serial, for claims ("pick a registered unit or enter its serial"). */
  async findActiveBySerialScoped(tx: Tx, user: AuthUser, serial: string) {
    return tx.registration.findFirst({
      where: {
        AND: [
          registrationScope(user),
          { status: "ACTIVE", serialNumber: { equals: serial, mode: "insensitive" } },
        ],
      },
      orderBy: { createdAt: "desc" },
    });
  }

  async findScopedRaw(tx: Tx, user: AuthUser, id: string) {
    return tx.registration.findFirst({ where: { AND: [{ id }, registrationScope(user)] } });
  }

  async create(ctx: RequestContext, input: CreateRegistrationInput): Promise<RegistrationResponse> {
    const today = this.clock.now();
    const purchaseDate = parseIsoDate(input.purchaseDate);
    const product = await this.products.findBySku(this.prisma, input.sku);

    const violation = checkRegistrationRules({ serial: input.serialNumber, purchaseDate, today, product });
    if (violation)
      throw AppError.unprocessable(violation.code, violation.message, {
        [violation.field]: [violation.message],
      });
    if (!product) throw AppError.notFound("Product"); // unreachable: the rules report a missing product

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        // Duplicate first: "already registered" is more useful than "missing receipt" (frontend 8.3).
        await this.assertNotDuplicate(tx, ctx.user, product.id, input.serialNumber);
        if (this.env.REQUIRE_PROOF_OF_PURCHASE && input.proofOfPurchaseIds.length === 0) {
          throw AppError.unprocessable(
            ErrorCode.PROOF_OF_PURCHASE_REQUIRED,
            "Upload the receipt or invoice.",
            {
              proofOfPurchaseIds: ["Upload the receipt or invoice."],
            },
          );
        }

        const policy = await this.policies.policyFor(tx, product.id, purchaseDate);
        if (!policy) {
          throw AppError.unprocessable(
            ErrorCode.POLICY_NOT_FOUND,
            "No warranty policy covers this purchase date. Contact support.",
          );
        }
        const { customer, distributorId } = await this.resolveCustomer(tx, ctx, input);
        const warranty = computeWarranty({ purchaseDate, registeredAt: today, policy });

        const row = await this.repo.create(tx, {
          serialNumber: input.serialNumber,
          productId: product.id,
          customerId: customer.id,
          distributorId,
          policyId: policy.id,
          purchaseDate,
          warrantyStart: warranty.start,
          warrantyEnd: warranty.end,
          createdBy: ctx.user.id,
        });
        await this.attachments.link(tx, ctx.user, input.proofOfPurchaseIds, "registration", row.id);
        await this.audit.record(tx, ctx, {
          action: "registration.created",
          entity: "registration",
          entityId: row.id,
          after: {
            serialNumber: row.serialNumber,
            sku: product.sku,
            policyId: policy.id,
            warrantyEnd: formatIsoDate(warranty.end),
            bonusApplied: warranty.bonusApplied,
          },
        });
        await this.outbox.add(tx, {
          aggregate: "registration",
          aggregateId: row.id,
          type: "registration.created",
          payload: { registrationId: row.id },
        });
        return row;
      });
      await this.warranty.invalidate(input.serialNumber);
      return this.toResponse(created);
    } catch (err) {
      // Lost a race with a parallel request: the partial unique index did its job (Section 13.3).
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw AppError.conflict(ErrorCode.REGISTRATION_DUPLICATE_SERIAL, "This unit is already registered.", {
          ownedByYou: false,
        });
      }
      throw err;
    }
  }

  async void(
    ctx: RequestContext,
    id: string,
    version: number,
    reason: string,
  ): Promise<RegistrationResponse> {
    const updated = await this.prisma.$transaction(async (tx) => {
      const before = await this.repo.findScoped(tx, id, registrationScope(ctx.user));
      if (!before) throw AppError.notFound("Registration");
      if (before.status === "VOID") {
        throw AppError.conflict(ErrorCode.CONFLICT, "This registration is already void.");
      }
      const { count } = await this.repo.updateVersioned(tx, id, version, { status: "VOID" });
      if (count === 0) throw AppError.staleVersion();
      await this.audit.record(tx, ctx, {
        action: "registration.voided",
        entity: "registration",
        entityId: id,
        before: { status: before.status },
        after: { status: "VOID", reason },
      });
      await this.outbox.add(tx, {
        aggregate: "registration",
        aggregateId: id,
        type: "registration.voided",
        payload: { registrationId: id },
      });
      return (await this.repo.findScoped(tx, id, {}))!;
    });
    await this.warranty.invalidate(updated.serialNumber);
    return this.toResponse(updated);
  }

  async certificateUrl(user: AuthUser, id: string) {
    const row = await this.repo.findScoped(this.prisma, id, registrationScope(user));
    if (!row) throw AppError.notFound("Registration");
    if (!row.certificateKey) {
      throw AppError.conflict(
        ErrorCode.CERTIFICATE_NOT_READY,
        "The certificate is still being generated. Try again in a moment.",
      );
    }
    const url = await this.storage.presignGet({
      key: row.certificateKey,
      expiresInSeconds: CERT_URL_TTL,
      downloadName: `warranty-certificate-${row.serialNumber}.pdf`,
    });
    return { url, expiresAt: new Date(this.clock.now().getTime() + CERT_URL_TTL * 1000).toISOString() };
  }

  /**
   * Replacement units (RMA "replace" outcome): voids the original and registers the new serial with the
   * remaining term carried over. [CONFIRM] the replacement warranty rule (carry over vs new term).
   */
  async registerReplacement(tx: Tx, ctx: RequestContext, originalId: string, replacementSerial: string) {
    const original = await tx.registration.findUnique({ where: { id: originalId } });
    if (!original) throw AppError.notFound("Registration");
    await this.assertNotDuplicate(tx, ctx.user, original.productId, replacementSerial);
    await tx.registration.update({
      where: { id: originalId },
      data: { status: "VOID", version: { increment: 1 } },
    });
    const today = startOfUtcDay(this.clock.now());
    const replacement = await tx.registration.create({
      data: {
        serialNumber: replacementSerial,
        productId: original.productId,
        customerId: original.customerId,
        distributorId: original.distributorId,
        policyId: original.policyId,
        purchaseDate: original.purchaseDate,
        warrantyStart: today,
        // Remaining term carries over; an already-expired unit (paid repair) ends today.
        warrantyEnd: original.warrantyEnd < today ? today : original.warrantyEnd,
        replacesRegistrationId: originalId,
        createdBy: ctx.user.id,
      },
    });
    await this.audit.record(tx, ctx, {
      action: "registration.replaced",
      entity: "registration",
      entityId: replacement.id,
      after: { replaces: originalId, serialNumber: replacementSerial },
    });
    await this.outbox.add(tx, {
      aggregate: "registration",
      aggregateId: replacement.id,
      type: "registration.created",
      payload: { registrationId: replacement.id },
    });
    return replacement;
  }

  /** Data for emails and the certificate PDF (worker). */
  findForDocument(id: string) {
    return this.repo.findForDocument(this.prisma, id);
  }

  async setCertificateKey(id: string, key: string): Promise<void> {
    await this.prisma.registration.update({ where: { id }, data: { certificateKey: key } });
  }

  invalidateLookup(serial: string): Promise<void> {
    return this.warranty.invalidate(serial);
  }

  private async assertNotDuplicate(tx: Tx, user: AuthUser, productId: string, serial: string): Promise<void> {
    const existing = await this.repo.findActiveDuplicate(tx, productId, serial);
    if (!existing) return;
    // Tell the caller whether THEY own it; never expose someone else's customer data (Section 8.2).
    const ownedByYou =
      existing.createdBy === user.id ||
      existing.customer.userId === user.id ||
      (user.has("distributor") &&
        existing.distributorId !== null &&
        existing.distributorId === user.organizationId);
    throw AppError.conflict(ErrorCode.REGISTRATION_DUPLICATE_SERIAL, "This unit is already registered.", {
      ownedByYou,
      ...(ownedByYou ? { registrationId: existing.id } : {}),
    });
  }

  private async resolveCustomer(
    tx: Tx,
    ctx: RequestContext,
    input: CreateRegistrationInput,
  ): Promise<{ customer: Customer; distributorId: string | null }> {
    const { user } = ctx;
    if (user.hasAny("claims_agent", "admin")) {
      if (input.customerId) {
        const customer = await this.customers.getScoped(tx, user, input.customerId);
        return { customer, distributorId: input.distributorId ?? customer.distributorId };
      }
      if (!input.customer) throw this.customerRequired();
      const distributorId = input.distributorId ?? null;
      return {
        customer: await this.customers.createForOrg(tx, ctx, input.customer, distributorId),
        distributorId,
      };
    }
    if (user.has("distributor")) {
      if (!user.organizationId) throw AppError.forbidden("Your account isn't linked to a distributor.");
      if (input.customerId) {
        return {
          customer: await this.customers.getScoped(tx, user, input.customerId),
          distributorId: user.organizationId,
        };
      }
      if (!input.customer) throw this.customerRequired();
      return {
        customer: await this.customers.createForOrg(tx, ctx, input.customer, user.organizationId),
        distributorId: user.organizationId,
      };
    }
    // Technician: registers units they own.
    return {
      customer: await this.customers.ensureSelfCustomer(tx, ctx, input.customer),
      distributorId: null,
    };
  }

  private customerRequired(): AppError {
    return new AppError(
      ErrorCode.CUSTOMER_REQUIRED,
      HttpStatus.UNPROCESSABLE_ENTITY,
      "Pick a customer or add the owner's details.",
      {
        customer: ["Required."],
      },
    );
  }

  /** Section 5.3 CASE expressed as a WHERE on warranty_end. */
  private statusFilter(status: RegistrationListQueryDto["status"]): Prisma.RegistrationWhereInput {
    if (!status) return {};
    if (status === "VOID") return { status: "VOID" };
    const today = startOfUtcDay(this.clock.now());
    const soon = addUtcDays(today, this.env.EXPIRING_SOON_DAYS);
    switch (status) {
      case "EXPIRED":
        return { status: "ACTIVE", warrantyEnd: { lt: today } };
      case "EXPIRING_SOON":
        return { status: "ACTIVE", warrantyEnd: { gte: today, lte: soon } };
      case "ACTIVE":
        return { status: "ACTIVE", warrantyEnd: { gt: soon } };
    }
  }
}

import { HttpStatus, Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { AuthUser, RequestContext } from "../../common/auth/auth-user";
import { rmaScope } from "../../common/auth/scope";
import { AppError } from "../../common/errors/app-error";
import { ErrorCode } from "../../common/errors/error-codes";
import { orderByFrom, pageArgs, type Paginated } from "../../common/pagination/pagination";
import { Clock } from "../../common/time/clock";
import type { Address } from "../../common/validation/schemas";
import { OutboxService } from "../../infra/outbox/outbox.service";
import { PrismaService, type Tx } from "../../infra/prisma/prisma.service";
import { AuditService } from "../audit";
import { ClaimsService, type Resolution, RmaIssuer } from "../claims";
import { RegistrationsService } from "../registrations";
import { detectCarrier } from "./carrier";
import type { RmaResponse } from "./dto";
import { type RmaRow, RmaRepository } from "./rma.repository";
import {
  allowedRmaActions,
  checkRmaTransition,
  isRmaStatus,
  type RmaAction,
  type RmaStatus,
} from "./rma-state-machine";

type RmaSummary = Omit<RmaResponse, "allowedActions">;

@Injectable()
export class RmaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: RmaRepository,
    private readonly claims: ClaimsService,
    private readonly registrations: RegistrationsService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly clock: Clock,
  ) {}

  async list(
    user: AuthUser,
    query: { page: number; pageSize: number; sort?: string; q?: string; status?: RmaStatus[] },
  ): Promise<Paginated<RmaSummary>> {
    const where: Prisma.RmaWhereInput = {
      AND: [
        rmaScope(user),
        query.status ? { status: { in: query.status } } : {},
        query.q
          ? {
              OR: [
                { displayNo: { contains: query.q, mode: "insensitive" } },
                { claim: { displayNo: { contains: query.q, mode: "insensitive" } } },
                { claim: { registration: { serialNumber: { contains: query.q, mode: "insensitive" } } } },
              ],
            }
          : {},
      ],
    };
    const orderBy = orderByFrom<Prisma.RmaOrderByWithRelationInput>(
      query.sort,
      {
        createdAt: (d) => ({ createdAt: d }),
        updatedAt: (d) => ({ updatedAt: d }),
        displayNo: (d) => ({ displayNo: d }),
        status: (d) => ({ status: d }),
      },
      "-updatedAt",
    );
    const { skip, take } = pageArgs(query);
    const { items, total } = await this.repo.list(this.prisma, where, skip, take, orderBy);
    return { items: items.map((r) => this.toSummary(r)), page: query.page, pageSize: query.pageSize, total };
  }

  async get(user: AuthUser, id: string): Promise<RmaResponse> {
    return this.toResponse(user, await this.load(this.prisma, user, id));
  }

  shipInbound(
    ctx: RequestContext,
    id: string,
    version: number,
    input: { trackingNumber: string; carrier?: string },
  ) {
    return this.run(ctx, id, version, "shipInbound", async (tx, rma) => {
      await this.claims.applyRmaTransition(
        tx,
        ctx,
        rma.claimId,
        "shipInbound",
        rma.type as Resolution,
        `Shipped: ${input.trackingNumber}`,
      );
      return {
        inboundTracking: input.trackingNumber,
        inboundCarrier: input.carrier ?? detectCarrier(input.trackingNumber),
      };
    });
  }

  receive(ctx: RequestContext, id: string, version: number, note?: string) {
    return this.run(ctx, id, version, "receive", async (tx, rma) => {
      await this.claims.applyRmaTransition(
        tx,
        ctx,
        rma.claimId,
        "receive",
        rma.type as Resolution,
        note ?? "Unit received",
      );
      return {};
    });
  }

  inspect(
    ctx: RequestContext,
    id: string,
    version: number,
    input: { findings: string; rootCause: string; partsUsed: string[] },
  ) {
    return this.run(ctx, id, version, "inspect", () => ({
      inspectionNotes: input.findings,
      rootCause: input.rootCause,
      partsUsed: input.partsUsed,
    }));
  }

  complete(
    ctx: RequestContext,
    id: string,
    version: number,
    input: {
      outboundTracking?: string;
      outboundCarrier?: string;
      replacementSerial?: string;
      creditAmount?: number;
      creditCurrency?: string;
    },
  ) {
    return this.run(ctx, id, version, "complete", async (tx, rma) => {
      const type = rma.type as Resolution;
      if (type === "credit" && input.creditAmount === undefined) {
        throw AppError.unprocessable(ErrorCode.CREDIT_AMOUNT_REQUIRED, "Enter the credit amount.", {
          creditAmount: ["Required for a credit."],
        });
      }
      if (type === "replace") {
        if (!input.replacementSerial) {
          throw AppError.unprocessable(
            ErrorCode.REPLACEMENT_SERIAL_REQUIRED,
            "Enter the replacement unit's serial number.",
            {
              replacementSerial: ["Required for a replacement."],
            },
          );
        }
        await this.registrations.registerReplacement(
          tx,
          ctx,
          rma.claim.registrationId,
          input.replacementSerial,
        );
      }
      await this.claims.applyRmaTransition(
        tx,
        ctx,
        rma.claimId,
        "complete",
        type,
        `RMA ${rma.displayNo} completed`,
      );
      return {
        completedAt: this.clock.now(),
        outboundTracking: input.outboundTracking,
        outboundCarrier: input.outboundTracking
          ? (input.outboundCarrier ?? detectCarrier(input.outboundTracking))
          : undefined,
        replacementSerial: input.replacementSerial,
        creditAmount: input.creditAmount,
        creditCurrency:
          input.creditAmount === undefined ? undefined : (input.creditCurrency ?? ctx.user.currency),
      };
    });
  }

  cancel(ctx: RequestContext, id: string, version: number, reason: string) {
    return this.run(ctx, id, version, "cancel", async (tx, rma) => {
      await this.claims.closeForCancelledRma(tx, ctx, rma.claimId, reason);
      return {};
    });
  }

  /** One transaction: scope → role/status check → versioned update → claim side effects → audit + outbox. */
  private async run(
    ctx: RequestContext,
    id: string,
    version: number,
    action: RmaAction,
    apply: (
      tx: Tx,
      rma: RmaRow,
    ) => Prisma.RmaUncheckedUpdateManyInput | Promise<Prisma.RmaUncheckedUpdateManyInput>,
  ): Promise<RmaResponse> {
    const updated = await this.prisma.$transaction(async (tx) => {
      const rma = await this.load(tx, ctx.user, id);
      const status = isRmaStatus(rma.status) ? rma.status : null;
      if (!status)
        throw new AppError(ErrorCode.INTERNAL_ERROR, HttpStatus.INTERNAL_SERVER_ERROR, "Unknown RMA status.");
      const check = checkRmaTransition(action, status, ctx.user.roles);
      if (!check.ok) {
        throw check.error === "FORBIDDEN"
          ? AppError.forbidden("You can't take this action on the RMA.")
          : AppError.conflict(
              ErrorCode.RMA_INVALID_TRANSITION,
              `An RMA in status ${status} can't do that. Reload and try again.`,
            );
      }
      // Lock the RMA first so the claim side effects can't race.
      const { count } = await this.repo.updateVersioned(tx, id, version, { status: check.to });
      if (count === 0) throw AppError.staleVersion();
      const data = await apply(tx, rma);
      if (Object.keys(data).length) await this.repo.update(tx, id, data);
      await this.audit.record(tx, ctx, {
        action: `rma.${action}`,
        entity: "rma",
        entityId: id,
        before: { status },
        after: { status: check.to },
      });
      await this.outbox.add(tx, {
        aggregate: "rma",
        aggregateId: id,
        type: "rma.status_changed",
        payload: { rmaId: id, displayNo: rma.displayNo, from: status, to: check.to, claimId: rma.claimId },
      });
      return this.load(tx, ctx.user, id);
    });
    return this.toResponse(ctx.user, updated);
  }

  private async load(db: Tx | PrismaService, user: AuthUser, id: string): Promise<RmaRow> {
    const rma = await this.repo.findScoped(db, id, rmaScope(user));
    if (!rma) throw AppError.notFound("RMA");
    return rma;
  }

  private toSummary(r: RmaRow): RmaSummary {
    return {
      id: r.id,
      displayNo: r.displayNo,
      claimId: r.claimId,
      claimDisplayNo: r.claim.displayNo,
      serialNumber: r.claim.registration.serialNumber,
      sku: r.claim.registration.product.sku,
      productName: r.claim.registration.product.name,
      type: r.type as RmaSummary["type"],
      status: r.status as RmaStatus,
      serviceCenter: r.serviceCenter,
      shipTo: r.shipTo as Partial<Address>,
      returnAddress: (r.claim.returnAddress as Partial<Address> | null) ?? null,
      inboundCarrier: r.inboundCarrier,
      inboundTracking: r.inboundTracking,
      outboundCarrier: r.outboundCarrier,
      outboundTracking: r.outboundTracking,
      inspectionNotes: r.inspectionNotes,
      rootCause: r.rootCause,
      partsUsed: r.partsUsed,
      replacementSerial: r.replacementSerial,
      creditAmount: r.creditAmount?.toFixed(2) ?? null,
      creditCurrency: r.creditCurrency,
      completedAt: r.completedAt?.toISOString() ?? null,
      version: r.version,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    };
  }

  private toResponse(user: AuthUser, r: RmaRow): RmaResponse {
    const status = r.status as RmaStatus;
    return { ...this.toSummary(r), allowedActions: allowedRmaActions(status, user.roles) };
  }
}

/** Creates the RMA when a claim is approved (implements the claims module's port). */
@Injectable()
export class RmaIssuanceService extends RmaIssuer {
  constructor(
    private readonly repo: RmaRepository,
    private readonly audit: AuditService,
  ) {
    super();
  }

  async issue(tx: Tx, ctx: RequestContext, claim: { id: string; resolution: Resolution }) {
    const serviceCenter = await this.repo.defaultServiceCenter(tx);
    if (!serviceCenter?.address) {
      throw new AppError(
        ErrorCode.SERVICE_UNAVAILABLE,
        HttpStatus.SERVICE_UNAVAILABLE,
        "No service center is set up to receive returns. Contact an admin.",
      );
    }
    const rma = await this.repo.create(tx, {
      claimId: claim.id,
      type: claim.resolution,
      serviceCenterId: serviceCenter.id,
      shipTo: serviceCenter.address,
    });
    await this.audit.record(tx, ctx, {
      action: "rma.issued",
      entity: "rma",
      entityId: rma.id,
      after: { claimId: claim.id, type: claim.resolution },
    });
    return rma;
  }
}

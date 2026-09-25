import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import type { ClaimStatus, Prisma } from "@prisma/client";
import type { AuthUser, RequestContext } from "../../common/auth/auth-user";
import { INTERNAL_NOTE_ROLES, isRole } from "../../common/auth/roles";
import { claimScope } from "../../common/auth/scope";
import { AppError } from "../../common/errors/app-error";
import { ErrorCode } from "../../common/errors/error-codes";
import { orderByFrom, pageArgs, type Paginated } from "../../common/pagination/pagination";
import { Clock } from "../../common/time/clock";
import { formatIsoDate, parseIsoDate, startOfUtcDay } from "../../common/time/utc-date";
import type { Address } from "../../common/validation/schemas";
import { ENV } from "../../config/config.module";
import type { Env } from "../../config/env";
import { OutboxService } from "../../infra/outbox/outbox.service";
import { PrismaService, type Tx } from "../../infra/prisma/prisma.service";
import { AttachmentsService } from "../attachments";
import { AuditService } from "../audit";
import { RegistrationsService } from "../registrations";
import { computeWarrantyStatus } from "../warranty";
import {
  allowedActions,
  type ClaimAction,
  checkTransition,
  EDITABLE_STATUSES,
  type Resolution,
  type TransitionInput,
} from "./claim-state-machine";
import { type ClaimDetailRow, ClaimsRepository, type ClaimSummaryRow } from "./claims.repository";
import type {
  ClaimDetail,
  ClaimEventResponse,
  ClaimListQueryDto,
  ClaimSummary,
  CreateClaimInput,
  UpdateClaimInput,
} from "./dto";
import { specificEventFor } from "./events";
import { RmaIssuer } from "./rma-issuer.port";
import { SlaService } from "./sla.service";

const REQUIREMENT_CODES = {
  MESSAGE_REQUIRED: ErrorCode.MESSAGE_REQUIRED,
  RESOLUTION_REQUIRED: ErrorCode.RESOLUTION_REQUIRED,
  REASON_REQUIRED: ErrorCode.REASON_REQUIRED,
} as const;

interface TransitionOptions {
  input?: TransitionInput & { rmaType?: Resolution };
  comment?: string | null;
  /** Extra column updates, computed inside the transaction once the claim is loaded. */
  extra?: (
    tx: Tx,
    claim: ClaimDetailRow,
  ) => Prisma.ClaimUncheckedUpdateManyInput | Promise<Prisma.ClaimUncheckedUpdateManyInput>;
}

type EventRow = Awaited<ReturnType<ClaimsRepository["addEvent"]>>;

function toEventResponse(e: EventRow): ClaimEventResponse {
  const roles = e.actor.roles.filter(isRole);
  const priority = ["admin", "claims_agent", "service_center", "distributor", "technician"] as const;
  return {
    id: e.id.toString(),
    at: e.createdAt.toISOString(),
    actor: {
      id: e.actor.id,
      name: e.actor.displayName,
      role: priority.find((r) => roles.includes(r)) ?? null,
    },
    type: e.type as ClaimEventResponse["type"],
    fromStatus: e.fromStatus,
    toStatus: e.toStatus,
    comment: e.comment,
    internal: e.internal,
  };
}

@Injectable()
export class ClaimsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: ClaimsRepository,
    private readonly registrations: RegistrationsService,
    private readonly attachments: AttachmentsService,
    private readonly sla: SlaService,
    private readonly rmaIssuer: RmaIssuer,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly clock: Clock,
    @Inject(ENV) private readonly env: Env,
  ) {}

  // ── Reads ────────────────────────────────────────────────────────

  async list(user: AuthUser, query: ClaimListQueryDto): Promise<Paginated<ClaimSummary>> {
    const assigned =
      query.assignedTo === "me"
        ? { assignedTo: user.id }
        : query.assignedTo === "unassigned"
          ? { assignedTo: null }
          : query.assignedTo
            ? { assignedTo: query.assignedTo }
            : {};
    const where: Prisma.ClaimWhereInput = {
      AND: [
        claimScope(user),
        assigned,
        query.status ? { status: { in: query.status } } : {},
        query.displayNo ? { displayNo: query.displayNo } : {},
        query.registrationId ? { registrationId: query.registrationId } : {},
        query.q
          ? {
              OR: [
                { displayNo: { contains: query.q, mode: "insensitive" } },
                { registration: { serialNumber: { contains: query.q, mode: "insensitive" } } },
              ],
            }
          : {},
      ],
    };
    const orderBy = orderByFrom<Prisma.ClaimOrderByWithRelationInput>(
      query.sort,
      {
        createdAt: (d) => ({ createdAt: d }),
        updatedAt: (d) => ({ updatedAt: d }),
        slaDueAt: (d) => ({ slaDueAt: { sort: d, nulls: "last" } }),
        displayNo: (d) => ({ displayNo: d }),
        status: (d) => ({ status: d }),
      },
      "-updatedAt",
    );
    const { skip, take } = pageArgs(query);
    const { items, total } = await this.repo.list(this.prisma, where, skip, take, orderBy);
    return { items: items.map((c) => this.toSummary(c)), page: query.page, pageSize: query.pageSize, total };
  }

  async get(user: AuthUser, id: string): Promise<ClaimDetail> {
    return this.toDetail(user, await this.load(this.prisma, user, id));
  }

  async events(user: AuthUser, id: string, after: string | undefined, limit: number) {
    await this.load(this.prisma, user, id);
    const rows = await this.repo.events(this.prisma, id, {
      includeInternal: user.hasAny(...INTERNAL_NOTE_ROLES),
      after: after === undefined ? undefined : BigInt(after),
      limit,
    });
    const page = rows.slice(0, limit);
    return {
      items: page.map(toEventResponse),
      nextCursor: rows.length > limit ? (page.at(-1)?.id.toString() ?? null) : null,
    };
  }

  // ── Drafts ───────────────────────────────────────────────────────

  async create(ctx: RequestContext, input: CreateClaimInput): Promise<ClaimDetail> {
    const created = await this.prisma.$transaction(async (tx) => {
      const registration = input.registrationId
        ? await this.registrations.findScopedRaw(tx, ctx.user, input.registrationId)
        : await this.registrations.findActiveBySerialScoped(tx, ctx.user, input.serialNumber!);
      if (!registration) {
        throw AppError.unprocessable(
          ErrorCode.REGISTRATION_NOT_FOUND,
          "We couldn't find that unit among your registered products. Register it first.",
          { serialNumber: ["Not registered to you."] },
        );
      }
      await this.assertCategory(tx, input.failureCategory);
      const failureDate = this.checkFailureDate(input.failureDate, registration.purchaseDate);

      const claim = await this.repo.create(tx, {
        registrationId: registration.id,
        failureCategory: input.failureCategory,
        description: input.description,
        failureDate,
        inWarranty: this.inWarranty(registration, failureDate),
        preferredResolution: input.preferredResolution ?? null,
        returnAddress: input.returnAddress ?? undefined,
        createdBy: ctx.user.id,
      });
      await this.attachments.link(tx, ctx.user, input.attachmentIds, "claim", claim.id);
      await this.repo.addEvent(tx, {
        claimId: claim.id,
        actorId: ctx.user.id,
        type: "created",
        toStatus: "DRAFT",
      });
      await this.audit.record(tx, ctx, {
        action: "claim.created",
        entity: "claim",
        entityId: claim.id,
        after: { displayNo: claim.displayNo },
      });
      return claim;
    });
    return this.toDetail(ctx.user, created);
  }

  /** Edit the claim body; only in DRAFT or NEEDS_INFO (Section 6.2). */
  async update(
    ctx: RequestContext,
    id: string,
    version: number,
    input: UpdateClaimInput,
  ): Promise<ClaimDetail> {
    const updated = await this.prisma.$transaction(async (tx) => {
      const claim = await this.load(tx, ctx.user, id);
      if (!EDITABLE_STATUSES.includes(claim.status)) {
        throw AppError.conflict(
          ErrorCode.CLAIM_NOT_EDITABLE,
          "This claim can only be edited while it's a draft or needs info.",
        );
      }
      if (claim.createdBy !== ctx.user.id && !ctx.user.hasAny("claims_agent", "admin"))
        throw AppError.forbidden();
      if (input.failureCategory) await this.assertCategory(tx, input.failureCategory);
      const failureDate = input.failureDate
        ? this.checkFailureDate(input.failureDate, claim.registration.purchaseDate)
        : undefined;

      const { attachmentIds, returnAddress, ...fields } = input;
      const { count } = await this.repo.updateVersioned(tx, id, version, {
        ...fields,
        failureDate,
        returnAddress: returnAddress === undefined ? undefined : (returnAddress ?? undefined),
        inWarranty: failureDate ? this.inWarranty(claim.registration, failureDate) : undefined,
      });
      if (count === 0) throw AppError.staleVersion();
      if (attachmentIds?.length) {
        await this.attachments.link(tx, ctx.user, attachmentIds, "claim", id);
        await this.repo.addEvent(tx, {
          claimId: id,
          actorId: ctx.user.id,
          type: "attachment_added",
          comment: `${attachmentIds.length} file(s) added`,
        });
      }
      await this.audit.record(tx, ctx, {
        action: "claim.updated",
        entity: "claim",
        entityId: id,
        after: { fields: Object.keys(input) },
      });
      return await this.load(tx, ctx.user, id);
    });
    return this.toDetail(ctx.user, updated);
  }

  // ── Transitions (Section 8.3) ────────────────────────────────────

  submit(ctx: RequestContext, id: string, version: number) {
    return this.transition(ctx, id, version, "submit", {
      extra: async (tx, claim) => {
        const category = await this.repo.failureCategory(tx, claim.failureCategory);
        if (category?.requiresPhoto && (await this.attachments.cleanImageCount(tx, "claim", id)) === 0) {
          throw AppError.unprocessable(
            ErrorCode.PHOTO_REQUIRED,
            "Add at least one photo of the damage or the display.",
            {
              attachmentIds: ["At least one photo is required for this failure type."],
            },
          );
        }
        const now = this.clock.now();
        return {
          submittedAt: now,
          slaDueAt: await this.sla.dueAt(now),
          inWarranty: this.inWarranty(claim.registration, claim.failureDate), // evaluated at submit and frozen
        };
      },
    });
  }

  startReview(ctx: RequestContext, id: string, version: number) {
    return this.transition(ctx, id, version, "startReview", {
      extra: (_tx, claim) => (claim.assignedTo ? {} : { assignedTo: ctx.user.id }),
    });
  }

  requestInfo(ctx: RequestContext, id: string, version: number, message: string) {
    return this.transition(ctx, id, version, "requestInfo", { input: { message }, comment: message });
  }

  respond(ctx: RequestContext, id: string, version: number, message: string) {
    return this.transition(ctx, id, version, "respond", { comment: message });
  }

  reject(ctx: RequestContext, id: string, version: number, reason: string, message: string) {
    return this.transition(ctx, id, version, "reject", {
      input: { reason },
      comment: message,
      extra: () => ({ rejectionReason: reason, resolution: "none" }),
    });
  }

  close(ctx: RequestContext, id: string, version: number, message?: string) {
    return this.transition(ctx, id, version, "close", {
      comment: message ?? null,
      extra: () => ({ closedAt: this.clock.now() }),
    });
  }

  /** Approve and, in the same transaction, issue the RMA and move to RMA_ISSUED (Section 8.3 step 6). */
  async approve(
    ctx: RequestContext,
    id: string,
    version: number,
    resolution: Resolution,
    comment?: string,
  ): Promise<ClaimDetail> {
    const claim = await this.prisma.$transaction(async (tx) => {
      await this.applyTransition(tx, ctx, id, version, "approve", {
        input: { resolution },
        comment: comment ?? null,
        extra: () => ({ resolution }),
      });
      const rma = await this.rmaIssuer.issue(tx, ctx, { id, resolution });
      await this.applySystemTransition(tx, ctx, id, "issueRma", `RMA ${rma.displayNo} issued`);
      return this.load(tx, ctx.user, id);
    });
    return this.toDetail(ctx.user, claim);
  }

  async assign(
    ctx: RequestContext,
    id: string,
    version: number,
    assigneeId: string | null,
  ): Promise<ClaimDetail> {
    const claim = await this.prisma.$transaction(async (tx) => {
      await this.load(tx, ctx.user, id);
      let assigneeName = "nobody";
      if (assigneeId) {
        const assignee = await tx.user.findFirst({
          where: { id: assigneeId, isActive: true, roles: { hasSome: ["claims_agent", "admin"] } },
        });
        if (!assignee)
          throw AppError.unprocessable(
            ErrorCode.ASSIGNEE_INVALID,
            "Assign the claim to an active claims agent.",
          );
        assigneeName = assignee.displayName;
      }
      const { count } = await this.repo.updateVersioned(tx, id, version, { assignedTo: assigneeId });
      if (count === 0) throw AppError.staleVersion();
      await this.repo.addEvent(tx, {
        claimId: id,
        actorId: ctx.user.id,
        type: "assigned",
        comment: `Assigned to ${assigneeName}`,
        internal: true,
      });
      await this.audit.record(tx, ctx, {
        action: "claim.assigned",
        entity: "claim",
        entityId: id,
        after: { assigneeId },
      });
      return this.load(tx, ctx.user, id);
    });
    return this.toDetail(ctx.user, claim);
  }

  async comment(
    ctx: RequestContext,
    id: string,
    text: string,
    internal: boolean,
  ): Promise<ClaimEventResponse> {
    if (internal && !ctx.user.hasAny(...INTERNAL_NOTE_ROLES)) {
      throw AppError.forbidden("Only Fieldpiece staff can add internal notes.");
    }
    return this.prisma.$transaction(async (tx) => {
      await this.load(tx, ctx.user, id);
      const event = await this.repo.addEvent(tx, {
        claimId: id,
        actorId: ctx.user.id,
        type: "comment",
        comment: text,
        internal,
      });
      await this.audit.record(tx, ctx, {
        action: "claim.commented",
        entity: "claim",
        entityId: id,
        after: { internal },
      });
      return toEventResponse(event);
    });
  }

  // ── Used by the RMA module, inside its transaction ───────────────

  /**
   * Applies an RMA-driven claim transition (shipInbound, receive, complete). The RMA row is already
   * locked by its own versioned update, so the claim update here is unversioned.
   */
  async applyRmaTransition(
    tx: Tx,
    ctx: RequestContext,
    claimId: string,
    action: "shipInbound" | "receive" | "complete",
    rmaType: Resolution,
    comment?: string,
  ) {
    const claim = await this.repo.findScoped(tx, claimId, {});
    if (!claim) throw AppError.notFound("Claim");
    const check = checkTransition(action, claim.status, ctx.user.roles, { rmaType });
    if (!check.ok) throw this.transitionError(check.error, claim.status);
    await this.repo.update(tx, claimId, { status: check.to });
    await this.recordStatusChange(tx, ctx, claim, check.to, comment ?? null);
  }

  /** RMA cancelled: the claim closes. */
  async closeForCancelledRma(tx: Tx, ctx: RequestContext, claimId: string, reason: string) {
    const claim = await this.repo.findScoped(tx, claimId, {});
    if (!claim || claim.status === "CLOSED") return;
    await this.repo.update(tx, claimId, { status: "CLOSED", closedAt: this.clock.now() });
    await this.recordStatusChange(tx, ctx, claim, "CLOSED", `RMA cancelled: ${reason}`);
  }

  forNotification(id: string) {
    return this.repo.forNotification(this.prisma, id);
  }

  // ── Internals ────────────────────────────────────────────────────

  private async transition(
    ctx: RequestContext,
    id: string,
    version: number,
    action: ClaimAction,
    options: TransitionOptions,
  ): Promise<ClaimDetail> {
    const claim = await this.prisma.$transaction(async (tx) => {
      await this.applyTransition(tx, ctx, id, version, action, options);
      return this.load(tx, ctx.user, id);
    });
    return this.toDetail(ctx.user, claim);
  }

  /** Section 8.3 steps 1-5, inside the caller's transaction. */
  private async applyTransition(
    tx: Tx,
    ctx: RequestContext,
    id: string,
    version: number,
    action: ClaimAction,
    options: TransitionOptions,
  ) {
    const claim = await this.load(tx, ctx.user, id); // 1. scope -> 404
    const check = checkTransition(action, claim.status, ctx.user.roles, options.input ?? {}); // 2. 403 / 409 / 422
    if (!check.ok) throw this.transitionError(check.error, claim.status);
    const extra = (await options.extra?.(tx, claim)) ?? {};
    const { count } = await this.repo.updateVersioned(tx, id, version, { ...extra, status: check.to }); // 3.
    if (count === 0) throw AppError.staleVersion();
    await this.recordStatusChange(tx, ctx, claim, check.to, options.comment ?? null); // 4. + 5.
  }

  private async applySystemTransition(
    tx: Tx,
    ctx: RequestContext,
    id: string,
    action: ClaimAction,
    comment: string,
  ) {
    const claim = await this.repo.findScoped(tx, id, {});
    if (!claim) throw AppError.notFound("Claim");
    const check = checkTransition(action, claim.status, ["system"]);
    if (!check.ok) throw this.transitionError(check.error, claim.status);
    await this.repo.update(tx, id, { status: check.to });
    await this.recordStatusChange(tx, ctx, claim, check.to, comment);
  }

  private async recordStatusChange(
    tx: Tx,
    ctx: RequestContext,
    claim: ClaimDetailRow,
    to: ClaimStatus,
    comment: string | null,
  ) {
    await this.repo.addEvent(tx, {
      claimId: claim.id,
      actorId: ctx.user.id,
      type: "status_changed",
      fromStatus: claim.status,
      toStatus: to,
      comment,
    });
    await this.audit.record(tx, ctx, {
      action: "claim.status_changed",
      entity: "claim",
      entityId: claim.id,
      before: { status: claim.status },
      after: { status: to },
    });
    const payload = {
      claimId: claim.id,
      displayNo: claim.displayNo,
      from: claim.status,
      to,
      actorId: ctx.user.id,
    };
    await this.outbox.add(tx, {
      aggregate: "claim",
      aggregateId: claim.id,
      type: "claim.status_changed",
      payload,
    });
    const specific = specificEventFor(to);
    if (specific)
      await this.outbox.add(tx, { aggregate: "claim", aggregateId: claim.id, type: specific, payload });
  }

  private transitionError(error: string, status: ClaimStatus): AppError {
    if (error === "FORBIDDEN") return AppError.forbidden("You can't take this action on the claim.");
    if (error === "CLAIM_INVALID_TRANSITION") {
      return AppError.conflict(
        ErrorCode.CLAIM_INVALID_TRANSITION,
        `A claim in status ${status} can't do that. Reload and try again.`,
      );
    }
    const code = REQUIREMENT_CODES[error as keyof typeof REQUIREMENT_CODES] ?? ErrorCode.VALIDATION_FAILED;
    return new AppError(code, HttpStatus.UNPROCESSABLE_ENTITY, "Some required information is missing.");
  }

  private async load(db: Tx | PrismaService, user: AuthUser, id: string): Promise<ClaimDetailRow> {
    const claim = await this.repo.findScoped(db, id, claimScope(user));
    if (!claim) throw AppError.notFound("Claim");
    return claim;
  }

  private async assertCategory(tx: Tx, code: string): Promise<void> {
    if (!(await this.repo.failureCategory(tx, code))) {
      throw AppError.unprocessable(ErrorCode.VALIDATION_FAILED, "Pick what went wrong from the list.", {
        failureCategory: ["Unknown failure category."],
      });
    }
  }

  private checkFailureDate(value: string, purchaseDate: Date): Date {
    const date = parseIsoDate(value);
    if (date > startOfUtcDay(this.clock.now()) || date < purchaseDate) {
      throw AppError.unprocessable(
        ErrorCode.FAILURE_DATE_INVALID,
        "The failure date must be between the purchase date and today.",
        {
          failureDate: ["Must be between the purchase date and today."],
        },
      );
    }
    return date;
  }

  private inWarranty(
    registration: { status: "ACTIVE" | "VOID"; warrantyEnd: Date },
    failureDate: Date,
  ): boolean {
    return registration.status === "ACTIVE" && failureDate <= registration.warrantyEnd;
  }

  private toSummary(c: ClaimSummaryRow | ClaimDetailRow): ClaimSummary {
    return {
      id: c.id,
      displayNo: c.displayNo,
      registrationId: c.registrationId,
      serialNumber: c.registration.serialNumber,
      sku: c.registration.product.sku,
      productName: c.registration.product.name,
      failureCategory: c.failureCategory,
      status: c.status,
      inWarranty: c.inWarranty,
      assignee: c.assignee ? { id: c.assignee.id, name: c.assignee.displayName } : null,
      slaDueAt: c.slaDueAt?.toISOString() ?? null,
      submittedAt: c.submittedAt?.toISOString() ?? null,
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
      version: c.version,
    };
  }

  private async toDetail(user: AuthUser, c: ClaimDetailRow): Promise<ClaimDetail> {
    return {
      ...this.toSummary(c),
      description: c.description,
      failureDate: formatIsoDate(c.failureDate),
      preferredResolution: (c.preferredResolution as Resolution | null) ?? null,
      resolution: (c.resolution as ClaimDetail["resolution"]) ?? null,
      rejectionReason: c.rejectionReason,
      returnAddress: (c.returnAddress as Partial<Address> | null) ?? null,
      customerName: c.registration.customer.companyName ?? c.registration.customer.contactName,
      createdBy: { id: c.creator.id, name: c.creator.displayName },
      warranty: {
        status: computeWarrantyStatus({
          status: c.registration.status,
          warrantyEnd: c.registration.warrantyEnd,
          today: this.clock.now(),
          expiringSoonDays: this.env.EXPIRING_SOON_DAYS,
        }),
        warrantyEnd: formatIsoDate(c.registration.warrantyEnd),
      },
      rma: c.rma ? { ...c.rma, type: c.rma.type as Resolution } : null,
      attachments: await this.attachments.forOwner(this.prisma, "claim", c.id),
      allowedActions: allowedActions(c.status, user.roles),
    };
  }
}

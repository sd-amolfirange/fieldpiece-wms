import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import {
  COMPLAINT_SOURCES,
  COMPLAINT_STATUSES,
  currentPart,
  entitlementFor,
  PART_TYPES,
  replacePart,
  type ComplaintSource,
  type ComplaintView,
  type Entitlement,
  type Paginated,
  type PartType,
  type ReplacedPart,
} from "@wms/domain";
import type { Ctx } from "../../common/auth/context";
import { fromDbDate, toDbDate } from "../../common/db/dates";
import { nextCounter, nextId } from "../../common/db/ids";
import { AppError } from "../../common/errors/app-error";
import { listQuery, pageArgs, queryEnum, type RawQuery, resolveSort } from "../../common/http/list-query";
import { type Db, PrismaService, type Tx } from "../../infra/prisma/prisma.service";
import { canSee, requireRole, scopeWhere } from "../../domain/scope";
import {
  complaintAttachmentIds,
  complaintInclude,
  type ComplaintRow,
  modelInclude,
  toComplaintView,
  toModelView,
  toUnit,
  unitInclude,
  type ViewCtx,
} from "../../domain/views";
import { ClaimsService } from "../claims";
import { FilesService } from "../files";
import { IntegrationLog, toJson } from "../integrations";
import { Notifier } from "../notifications";
import { UnitsRepository, UnitsService } from "../units";
import { jobPhotoSvg, newPartSerial, PART_NAMES, partToReplace } from "./job-photos";

// Complaint -> service -> job result -> manufacturer claim (W3, W4, W5).
// - The WMS decides entitlement when the complaint is raised (parts / labour covered or chargeable).
// - A job result replaces the part (its new warranty starts that day) and creates a Draft claim when the complaint
//   is claimable. Void or fully chargeable complaints never create a claim.
// - Every exchange with the service system is written to the integration log.

type OrderBy = Prisma.ComplaintOrderByWithRelationInput;
const SORTS: Record<string, (dir: Prisma.SortOrder) => OrderBy> = {
  id: (dir) => ({ id: dir }),
  unitSerial: (dir) => ({ unitSerial: dir }),
  source: (dir) => ({ source: dir }),
  status: (dir) => ({ status: dir }),
  raisedByName: (dir) => ({ raisedByName: dir }),
  description: (dir) => ({ description: dir }),
  createdAt: (dir) => ({ createdAt: dir }),
  dealerName: (dir) => ({ dealer: { name: dir } }),
  customerName: (dir) => ({ customer: { name: dir } }),
  modelCode: (dir) => ({ unit: { model: { code: dir } } }),
  modelName: (dir) => ({ unit: { model: { name: dir } } }),
  brandName: (dir) => ({ unit: { brand: { name: dir } } }),
};

const MIN_DESCRIPTION = 5;

@Injectable()
export class ComplaintsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly units: UnitsService,
    private readonly unitRows: UnitsRepository,
    private readonly files: FilesService,
    private readonly claims: ClaimsService,
    private readonly integrations: IntegrationLog,
    private readonly notifier: Notifier,
  ) {}

  private vc(ctx: Ctx): ViewCtx {
    return { user: ctx.user, today: ctx.today, fileUrl: this.files.fileUrl };
  }

  async list(ctx: Ctx, query: RawQuery): Promise<Paginated<ComplaintView>> {
    const list = listQuery(query);
    const q = list.q;
    const where: Prisma.ComplaintWhereInput = {
      ...scopeWhere(ctx.user),
      status: queryEnum(query, "status", COMPLAINT_STATUSES),
      source: queryEnum(query, "source", COMPLAINT_SOURCES),
      ...(q
        ? {
            OR: [
              { id: { contains: q, mode: "insensitive" } },
              { unitSerial: { contains: q, mode: "insensitive" } },
              { customer: { name: { contains: q, mode: "insensitive" } } },
              { dealer: { name: { contains: q, mode: "insensitive" } } },
            ],
          }
        : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.complaint.count({ where }),
      this.prisma.complaint.findMany({
        where,
        include: complaintInclude,
        orderBy: [resolveSort(list.sort, SORTS, "-createdAt"), { id: "asc" }],
        ...pageArgs(list),
      }),
    ]);
    return { items: await this.views(this.prisma, ctx, rows), total, page: list.page, pageSize: list.pageSize };
  }

  async get(ctx: Ctx, id: string, db: Db = this.prisma): Promise<ComplaintView> {
    const row = await db.complaint.findUnique({ where: { id }, include: complaintInclude });
    if (!row || !canSee(ctx.user, row)) throw AppError.notFound("Complaint");
    const [view] = await this.views(db, ctx, [row]);
    return view!;
  }

  /** CU04, DL06, A07: raise a complaint on a unit the caller can see. */
  async create(ctx: Ctx, body: { unitSerial?: unknown; description?: unknown; attachmentIds?: unknown }): Promise<ComplaintView> {
    const { user } = ctx;
    const serial = typeof body.unitSerial === "string" ? body.unitSerial : "";
    const attachmentIds = Array.isArray(body.attachmentIds)
      ? body.attachmentIds.filter((id): id is string => typeof id === "string").slice(0, 20)
      : [];
    const id = await this.prisma.tx(async (tx) => {
      const unit = await this.units.findVisible(tx, ctx, serial);
      const description = typeof body.description === "string" ? body.description.trim().slice(0, 5000) : "";
      if (description.length < MIN_DESCRIPTION) {
        throw AppError.validation("Describe the fault.", { description: "validation.describeFault" });
      }
      if (!unit.parts.length) {
        throw AppError.conflict("not_registered", "This unit isn't registered yet.", {
          unitSerial: "complaints.notRegistered",
        });
      }
      await this.files.assertOwn(tx, user, attachmentIds);

      const source: ComplaintSource = user.role === "customer" ? "CUSTOMER" : user.role === "admin" ? "ADMIN" : "DEALER";
      const raisedByName =
        user.role === "customer" && user.customerId
          ? ((await tx.customer.findUnique({ where: { id: user.customerId } }))?.name ?? user.name)
          : user.name;
      const complaintId = await nextId(tx, "CMP");
      await tx.complaint.create({
        data: {
          id: complaintId,
          unitSerial: unit.serial,
          source,
          raisedBy: user.id,
          raisedByName,
          dealerId: unit.dealerId,
          customerId: unit.customerId,
          description,
          attachmentIds,
          status: "NEW",
          entitlement: toJson(entitlementFor(toUnit(unit), ctx.today)),
          createdAt: ctx.now,
          events: { create: { at: ctx.now, status: "NEW", byName: raisedByName } },
        },
      });
      await this.units.addEvent(tx, unit.serial, { at: ctx.now, type: "complaint_raised", byName: raisedByName, refId: complaintId });
      await this.notifier.notify(tx, await this.notifier.adminIds(tx), "complaint_raised", ctx.now, {
        params: { id: complaintId, serial: unit.serial },
        link: `/complaints/${complaintId}`,
      });
      return complaintId;
    });
    return this.get(ctx, id);
  }

  /** A08: hand the complaint to the service system (NEW -> WITH_SERVICE). */
  async sendToService(ctx: Ctx, id: string): Promise<ComplaintView> {
    requireRole(ctx.user, "admin");
    await this.prisma.tx(async (tx) => {
      const complaint = await this.locked(tx, id);
      if (complaint.status !== "NEW") {
        throw AppError.conflict("already_sent", "This complaint is already with the service system.");
      }
      const unit = await tx.unit.findUniqueOrThrow({ where: { serial: complaint.unitSerial }, include: unitInclude });
      // Voided after the complaint was raised: the visit is now chargeable.
      let entitlement = complaint.entitlement as unknown as Entitlement;
      if (unit.voidedAt) entitlement = entitlementFor(toUnit(unit), ctx.today);
      const serviceRequestId = await nextId(tx, "SR");
      await tx.complaint.update({
        where: { id },
        data: {
          status: "WITH_SERVICE",
          serviceRequestId,
          entitlement: toJson(entitlement),
          events: { create: { at: ctx.now, status: "WITH_SERVICE", byName: ctx.user.name } },
        },
      });
      const customer = complaint.customerId ? await tx.customer.findUnique({ where: { id: complaint.customerId } }) : null;
      await this.integrations.log(
        tx,
        {
          system: "SERVICE",
          direction: "OUT",
          type: "service_request",
          refId: complaint.id,
          payload: {
            serviceRequestId,
            complaintId: complaint.id,
            unit: { serial: complaint.unitSerial, model: unit.model.code, location: unit.location ?? undefined },
            parts: unit.parts
              .filter((p) => !p.replacedAt)
              .map((p) => ({ partType: p.partType, serial: p.serial ?? undefined, warrantyEnd: fromDbDate(p.warrantyEnd) })),
            entitlement,
            customer: customer ? { name: customer.name, phone: customer.phone, city: customer.city } : undefined,
            fault: complaint.description,
          },
        },
        ctx.now,
      );
      await this.notifier.notify(tx, await this.notifier.followers(tx, complaint), "complaint_with_service", ctx.now, {
        params: { id: complaint.id },
        link: `/complaints/${complaint.id}`,
      });
    });
    return this.get(ctx, id);
  }

  /**
   * The service system's job result for a WITH_SERVICE complaint (today from the A13 simulator; in production from
   * the service system's integration). Replaces the part, resolves the complaint and, when something was covered,
   * creates the Draft claim with this job as evidence.
   */
  async recordJobResult(ctx: Ctx, body: { complaintId?: unknown; partType?: unknown }): Promise<ComplaintView> {
    requireRole(ctx.user, "admin");
    const id = typeof body.complaintId === "string" ? body.complaintId : "";
    const requested = PART_TYPES.includes(body.partType as PartType) ? (body.partType as PartType) : undefined;
    await this.prisma.tx(async (tx) => {
      const complaint = await this.locked(tx, id);
      if (complaint.status !== "WITH_SERVICE") {
        throw AppError.conflict("not_with_service", "Send the complaint to the service system first.");
      }
      await this.unitRows.lock(tx, complaint.unitSerial);
      const unitRow = await tx.unit.findUniqueOrThrow({ where: { serial: complaint.unitSerial }, include: unitInclude });
      const model = toModelView(await tx.model.findUniqueOrThrow({ where: { id: unitRow.modelId }, include: modelInclude }));
      const unit = toUnit(unitRow);
      let entitlement = complaint.entitlement as unknown as Entitlement;

      const partType = partToReplace({ entitlement }, requested);
      const line = model.parts.find((p) => p.partType === partType);
      if (!line) throw AppError.conflict("no_such_part", "This model has no such part.");
      const oldSerial = currentPart(unit, partType)?.serial;
      const newSerial = newPartSerial(partType, ctx.today, await nextCounter(tx, "NEWPART"));

      // The photos the technician took (placeholders until the service system sends real ones).
      const photoIds: string[] = [];
      for (const [caption, serial] of [
        [`Removed ${partType.toLowerCase()}`, oldSerial ?? "-"],
        [`New ${partType.toLowerCase()} fitted`, newSerial],
      ] as const) {
        const svg = jobPhotoSvg(caption, serial);
        const photo = await this.files.store(
          tx,
          { name: `${caption.replace(/\s+/g, "-").toLowerCase()}.svg`, mime: "image/svg+xml", buffer: Buffer.from(svg), uploadedBy: ctx.user.id },
          ctx.now,
        );
        photoIds.push(photo.id);
      }

      // The new part's warranty starts on the repair day.
      const parts = replacePart(unit.parts, line, {
        newSerial,
        date: ctx.today,
        newId: `${unit.serial}-${partType.toLowerCase()}-${newSerial}`,
      });
      const removed = parts.find((p) => p.partType === partType && p.replacedBySerial === newSerial);
      const fitted = parts[parts.length - 1]!;
      if (removed) {
        await tx.unitPart.update({
          where: { id: removed.id },
          data: { replacedAt: toDbDate(ctx.today), replacedBySerial: newSerial },
        });
      }
      await tx.unitPart.create({
        data: {
          id: fitted.id,
          unitSerial: unit.serial,
          position: unitRow.parts.reduce((max, p) => Math.max(max, p.position), -1) + 1,
          partType: fitted.partType,
          serial: fitted.serial,
          warrantyStart: toDbDate(fitted.warrantyStart),
          warrantyEnd: toDbDate(fitted.warrantyEnd),
          coversParts: fitted.coversParts,
          coversLabour: fitted.coversLabour,
          replacesSerial: fitted.replacesSerial,
        },
      });
      await this.units.addEvent(tx, unit.serial, {
        at: ctx.now,
        type: "part_replaced",
        byName: "Service system",
        text: `${PART_NAMES[partType]}: ${oldSerial ?? "-"} -> ${newSerial}`,
        refId: complaint.id,
      });

      const customer = complaint.customerId ? await tx.customer.findUnique({ where: { id: complaint.customerId } }) : null;
      const partsReplaced: ReplacedPart[] = [{ partType, oldSerial, newSerial }];
      const jobId = await nextId(tx, "JOB");
      const job = {
        id: jobId,
        complaintId: complaint.id,
        technician: "S. Pawar (CoolFix Services)",
        completedAt: ctx.now,
        partsReplaced,
        photoIds,
        signOffName: customer?.name ?? "Customer",
        notes: `Replaced the ${PART_NAMES[partType]}, recharged gas, tested: cooling normal.`,
      };
      await tx.jobResult.create({ data: { ...job, partsReplaced: toJson(partsReplaced) } });
      await this.integrations.log(
        tx,
        {
          system: "SERVICE",
          direction: "IN",
          type: "job_result",
          refId: complaint.id,
          payload: { serviceRequestId: complaint.serviceRequestId ?? undefined, ...job, completedAt: ctx.now.toISOString() },
        },
        ctx.now,
      );
      await this.notifier.notify(tx, await this.notifier.followers(tx, complaint), "complaint_resolved", ctx.now, {
        params: { id: complaint.id, part: PART_NAMES[partType], date: fitted.warrantyEnd },
        link: `/complaints/${complaint.id}`,
      });

      // Draft claim with the job's evidence, only when something was covered. Never on a void unit.
      if (unitRow.voidedAt) entitlement = entitlementFor(unit, ctx.today);
      let claimId: string | null = null;
      if (entitlement.claimable) {
        claimId = await this.claims.createDraft(
          tx,
          {
            complaintId: complaint.id,
            unitSerial: unit.serial,
            brandId: unitRow.brandId,
            dealerId: unitRow.dealerId,
            jobResultId: jobId,
            photoIds,
            partsReplaced,
          },
          ctx.now,
        );
        await this.units.addEvent(tx, unit.serial, { at: ctx.now, type: "claim_created", byName: "System", refId: claimId });
        await this.notifier.notify(tx, await this.notifier.adminIds(tx), "claim_draft_created", ctx.now, {
          params: { id: claimId, serial: unit.serial },
          link: `/claims/${claimId}`,
        });
      }
      await tx.complaint.update({
        where: { id: complaint.id },
        data: {
          status: "RESOLVED",
          jobResultId: jobId,
          claimId,
          entitlement: toJson(entitlement),
          events: { create: { at: ctx.now, status: "RESOLVED", byName: "Service system" } },
        },
      });
    });
    return this.get(ctx, id);
  }

  /** Complaint row locked for this transaction; 404 when missing (admin-only callers see every complaint). */
  private async locked(tx: Tx, id: string) {
    await tx.$queryRaw`SELECT id FROM complaints WHERE id = ${id} FOR UPDATE`;
    const complaint = await tx.complaint.findUnique({ where: { id } });
    if (!complaint) throw AppError.notFound("Complaint");
    return complaint;
  }

  private async views(db: Db, ctx: Ctx, rows: ComplaintRow[]): Promise<ComplaintView[]> {
    const claimIds = rows.flatMap((r) => r.claimId ?? []);
    const [attachments, claims] = await Promise.all([
      this.files.byIds(db, complaintAttachmentIds(rows)),
      claimIds.length
        ? db.claim.findMany({ where: { id: { in: claimIds } }, select: { id: true, status: true, dealerId: true } })
        : [],
    ]);
    const lookups = { attachments, claims: new Map(claims.map((c) => [c.id, c])) };
    const vc = this.vc(ctx);
    return rows.map((r) => toComplaintView(r, lookups, vc));
  }
}

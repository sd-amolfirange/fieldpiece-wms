import { Injectable } from "@nestjs/common";
import {
  entitlementFor,
  VOID_REASONS,
  WARRANTY_STATUSES,
  type Entitlement,
  type Paginated,
  type UnitEventType,
  type UnitView,
  type VoidReason,
} from "@wms/domain";
import type { Ctx } from "../../common/auth/context";
import { AppError } from "../../common/errors/app-error";
import { listQuery, queryEnum, queryString, type RawQuery } from "../../common/http/list-query";
import { type Db, PrismaService } from "../../infra/prisma/prisma.service";
import { canSee, requireRole } from "../../domain/scope";
import { toUnit, toUnitView, type UnitRow } from "../../domain/views";
import { Notifier } from "../notifications";
import { certificatePdf } from "./certificate";
import { UnitsRepository } from "./units.repository";

export interface NewUnitEvent {
  at: Date;
  type: UnitEventType;
  byName: string;
  text?: string;
  reason?: VoidReason;
  refId?: string;
}

@Injectable()
export class UnitsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly units: UnitsRepository,
    private readonly notifier: Notifier,
  ) {}

  async list(ctx: Ctx, query: RawQuery): Promise<Paginated<UnitView>> {
    const list = listQuery(query);
    const { serials, total } = await this.units.search(ctx.user, ctx.today, list, {
      status: queryEnum(query, "status", WARRANTY_STATUSES),
      dealerId: queryString(query, "dealerId"),
    });
    const rows = await this.units.load(this.prisma, serials);
    return { items: rows.map((r) => toUnitView(r, ctx.today)), total, page: list.page, pageSize: list.pageSize };
  }

  /** The unit if the caller may see it; 404 otherwise (never 403, so serials can't be probed). */
  async findVisible(db: Db, ctx: Ctx, serial: string): Promise<UnitRow> {
    const row = await this.units.findOne(db, serial.trim().toUpperCase());
    if (!row || !canSee(ctx.user, row)) throw AppError.notFound("Unit");
    return row;
  }

  async get(ctx: Ctx, serial: string): Promise<UnitView> {
    return toUnitView(await this.findVisible(this.prisma, ctx, serial), ctx.today);
  }

  /** What a complaint on this unit would get today (CU04 / DL06 preview). */
  async entitlement(ctx: Ctx, serial: string): Promise<Entitlement> {
    return entitlementFor(toUnit(await this.findVisible(this.prisma, ctx, serial)), ctx.today);
  }

  async certificate(ctx: Ctx, serial: string): Promise<{ serial: string; pdf: Buffer }> {
    const unit = await this.get(ctx, serial);
    if (!unit.parts.length) throw AppError.conflict("not_registered", "This unit isn't registered yet.");
    return { serial: unit.serial, pdf: await certificatePdf(unit) };
  }

  /** W5: an admin voids a unit's warranty with a reason and note, recorded with user and date. */
  async voidWarranty(ctx: Ctx, serial: string, body: { reason?: unknown; note?: unknown }): Promise<UnitView> {
    requireRole(ctx.user, "admin");
    const normalized = serial.trim().toUpperCase();
    await this.prisma.tx(async (tx) => {
      await this.units.lock(tx, normalized);
      const unit = await this.findVisible(tx, ctx, normalized);
      const reason = body.reason as VoidReason;
      if (!VOID_REASONS.includes(reason)) {
        throw AppError.validation("Choose a reason.", { reason: "validation.voidReason" });
      }
      if (unit.voidedAt) throw AppError.conflict("already_void", "This warranty is already void.");
      if (!unit.parts.length) throw AppError.conflict("not_registered", "This unit isn't registered yet.");
      const note = typeof body.note === "string" && body.note.trim() ? body.note.trim().slice(0, 2000) : undefined;
      await tx.unit.update({
        where: { serial: unit.serial },
        data: {
          voidReason: reason,
          voidNote: note ?? null,
          voidedBy: ctx.user.id,
          voidedByName: ctx.user.name,
          voidedAt: ctx.now,
        },
      });
      await this.addEvent(tx, unit.serial, { at: ctx.now, type: "voided", byName: ctx.user.name, reason, text: note });
      await this.notifier.notify(tx, await this.notifier.followers(tx, unit), "unit_voided", ctx.now, {
        params: { serial: unit.serial },
        link: `/units/${unit.serial}`,
      });
    });
    return this.get(ctx, normalized);
  }

  async addEvent(db: Db, serial: string, event: NewUnitEvent): Promise<void> {
    await db.unitEvent.create({
      data: {
        unitSerial: serial,
        at: event.at,
        type: event.type,
        byName: event.byName,
        text: event.text,
        reason: event.reason,
        refId: event.refId,
      },
    });
  }
}

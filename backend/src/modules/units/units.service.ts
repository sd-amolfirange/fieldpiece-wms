import { Inject, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  coverageFor,
  extensionQuote,
  FIELDPIECE_APP_CHANNELS,
  REGISTRATION_CHANNELS,
  VOID_REASONS,
  WARRANTY_STATUSES,
  type Coverage,
  type ExtensionBlock,
  type ExtensionQuote,
  type Paginated,
  type RegistrationChannel,
  type UnitEventType,
  type UnitView,
  type VoidReason,
} from "@wms/domain";
import type { Ctx } from "../../common/auth/context";
import { toDbDate } from "../../common/db/dates";
import { nextId } from "../../common/db/ids";
import { AppError } from "../../common/errors/app-error";
import { listQuery, queryEnum, queryString, type RawQuery } from "../../common/http/list-query";
import { type Db, PrismaService } from "../../infra/prisma/prisma.service";
import { ENV } from "../../config/config.module";
import type { Env } from "../../config/env";
import { canSee, requireRole } from "../../domain/scope";
import { moneyOf, toUnit, toUnitView, type UnitRow } from "../../domain/views";
import { IntegrationLog } from "../integrations";
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

/** `channel` of the product list: one registration channel, or APPS for either Fieldpiece app. Else no filter. */
export const UNIT_CHANNEL_FILTERS = [...REGISTRATION_CHANNELS, "APPS"] as const;

function channelFilter(query: RawQuery): readonly RegistrationChannel[] | undefined {
  const value = queryEnum(query, "channel", UNIT_CHANNEL_FILTERS);
  return value === "APPS" ? FIELDPIECE_APP_CHANNELS : value ? [value] : undefined;
}

/** Why a product can't get an extended warranty (409 not_extendable). */
const NOT_EXTENDABLE: Record<ExtensionBlock, string> = {
  NOT_REGISTERED: "This product isn't registered yet.",
  VOID: "This warranty is void, so it can't be extended.",
  REPLACED: "This product was replaced; extend the replacement's warranty instead.",
  EXPIRED: "This warranty has expired; only a warranty still in force can be extended.",
  LIMIT_REACHED: "This warranty was already extended by the maximum 36 months.",
};

@Injectable()
export class UnitsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly units: UnitsRepository,
    private readonly notifier: Notifier,
    private readonly integrations: IntegrationLog,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async list(ctx: Ctx, query: RawQuery): Promise<Paginated<UnitView>> {
    const list = listQuery(query);
    const { serials, total } = await this.units.search(ctx.user, ctx.today, list, {
      status: queryEnum(query, "status", WARRANTY_STATUSES),
      dealerId: queryString(query, "dealerId"),
      channels: channelFilter(query),
    });
    const rows = await this.units.load(this.prisma, serials);
    return {
      items: rows.map((r) => toUnitView(r, ctx.today)),
      total,
      page: list.page,
      pageSize: list.pageSize,
    };
  }

  /** The unit if the caller may see it; 404 otherwise (never 403, so serials can't be probed). */
  async findVisible(db: Db, ctx: Ctx, serial: string): Promise<UnitRow> {
    const row = await this.units.findOne(db, serial.trim().toUpperCase());
    if (!row || !canSee(ctx.user, row)) throw AppError.notFound("Product");
    return row;
  }

  async get(ctx: Ctx, serial: string): Promise<UnitView> {
    return toUnitView(await this.findVisible(this.prisma, ctx, serial), ctx.today);
  }

  /** Whether a warranty claim on this product would be covered today (shown before filing a claim). */
  async coverage(ctx: Ctx, serial: string): Promise<Coverage> {
    return coverageFor(toUnit(await this.findVisible(this.prisma, ctx, serial)), ctx.today);
  }

  async certificate(ctx: Ctx, serial: string): Promise<{ serial: string; pdf: Buffer }> {
    const unit = await this.get(ctx, serial);
    if (!unit.warrantyEnd) throw AppError.conflict("not_registered", "This product isn't registered yet.");
    return { serial: unit.serial, pdf: await certificatePdf(unit) };
  }

  /** W5: the warranty desk voids a product's warranty with a reason and note, recorded with user and date. */
  async voidWarranty(
    ctx: Ctx,
    serial: string,
    body: { reason?: unknown; note?: unknown },
  ): Promise<UnitView> {
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
      if (!unit.warrantyEnd) throw AppError.conflict("not_registered", "This product isn't registered yet.");
      const note =
        typeof body.note === "string" && body.note.trim() ? body.note.trim().slice(0, 2000) : undefined;
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
      await this.addEvent(tx, unit.serial, {
        at: ctx.now,
        type: "voided",
        byName: ctx.user.name,
        reason,
        text: note,
      });
      await this.notifier.notify(tx, await this.notifier.followers(tx, unit), "unit_voided", ctx.now, {
        params: { serial: unit.serial },
        link: `/units/${unit.serial}`,
      });
    });
    return this.get(ctx, normalized);
  }

  /** Extended-warranty offer for this product today: the plans still open, their price and new end date. */
  async extensionQuote(ctx: Ctx, serial: string): Promise<ExtensionQuote> {
    return quoteFor(await this.findVisible(this.prisma, ctx, serial), ctx);
  }

  /**
   * Sells an extended warranty: moves the warranty end date by the chosen plan, records who sold it (the dealer
   * is credited when a dealer sells it) and invoices it through Finance. Anyone who can see the product can buy one.
   */
  async extend(ctx: Ctx, serial: string, body: { months?: unknown }): Promise<UnitView> {
    const normalized = serial.trim().toUpperCase();
    await this.prisma.tx(async (tx) => {
      await this.units.lock(tx, normalized);
      const unit = await this.findVisible(tx, ctx, normalized);
      const quote = quoteFor(unit, ctx);
      if (!quote.eligible || !unit.warrantyEnd) {
        throw AppError.conflict("not_extendable", NOT_EXTENDABLE[quote.reason ?? "NOT_REGISTERED"]);
      }
      const option = quote.options.find((o) => o.months === body.months);
      if (!option) throw AppError.validation("Choose a plan.", { months: "validation.extensionPlan" });

      const id = await nextId(tx, "EXT");
      const dealerId = ctx.user.role === "dealer" && ctx.user.dealerId ? ctx.user.dealerId : unit.dealerId;
      const newEnd = toDbDate(option.newEnd);
      await tx.warrantyExtension.create({
        data: {
          id,
          unitSerial: unit.serial,
          months: option.months,
          price: new Prisma.Decimal(option.price.toFixed(2)),
          previousEnd: unit.warrantyEnd,
          newEnd,
          soldBy: ctx.user.id,
          soldByName: ctx.user.name,
          dealerId,
          createdAt: ctx.now,
        },
      });
      await tx.unit.update({ where: { serial: unit.serial }, data: { warrantyEnd: newEnd } });
      await this.addEvent(tx, unit.serial, {
        at: ctx.now,
        type: "extended",
        byName: ctx.user.name,
        text: `Warranty extended by ${option.months} months to ${option.newEnd}`,
        refId: id,
      });
      await this.notifier.notify(tx, await this.notifier.followers(tx, unit), "unit_extended", ctx.now, {
        params: { serial: unit.serial, months: option.months, newEnd: option.newEnd },
        link: `/units/${unit.serial}`,
      });
      await this.integrations.log(
        tx,
        {
          system: "FINANCE",
          direction: "OUT",
          type: "extension_invoice",
          refId: id,
          payload: {
            extensionId: id,
            serial: unit.serial,
            model: unit.model.code,
            months: option.months,
            price: option.price,
            currency: this.env.APP_CURRENCY,
            soldBy: ctx.user.id,
            dealerId,
          },
        },
        ctx.now,
      );
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

const quoteFor = (row: UnitRow, ctx: Pick<Ctx, "today">): ExtensionQuote =>
  extensionQuote(toUnit(row), { listPrice: moneyOf(row.model.listPrice) }, ctx.today);

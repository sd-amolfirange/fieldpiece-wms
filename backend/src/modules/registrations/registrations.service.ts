import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  buildUnitParts,
  hasErrors,
  isIsoDate,
  needsAdminReview,
  normalizeSerialValue,
  REGISTRATION_CHANNELS,
  REGISTRATION_FLAGS,
  REGISTRATION_STATUSES,
  validateRegistrationRow,
  type IsoDate,
  type Paginated,
  type RegistrationChannel,
  type RegistrationCustomer,
  type RegistrationFlag,
  type RegistrationRowInput,
  type RegistrationView,
  type RowContext,
} from "@wms/domain";
import type { Actor, Ctx } from "../../common/auth/context";
import { toDbDate, toDbDateOpt } from "../../common/db/dates";
import { nextId } from "../../common/db/ids";
import { AppError } from "../../common/errors/app-error";
import {
  listQuery,
  pageArgs,
  queryEnum,
  type RawQuery,
  resolveSort,
} from "../../common/http/list-query";
import { type Db, PrismaService, type Tx } from "../../infra/prisma/prisma.service";
import { canSee, dealerIdFor, requireRole, scopeWhere } from "../../domain/scope";
import { modelInclude, registrationInclude, type RegistrationRow, toModelView, toRegistrationView } from "../../domain/views";
import { CatalogService } from "../catalog";
import { FilesService } from "../files";
import { IntegrationLog } from "../integrations";
import { Notifier } from "../notifications";
import { UnitsRepository, UnitsService } from "../units";
import { createBody, emailKey, phoneKey, rowFieldErrors, rowToFields } from "./registration-input";

// Registration rules (api-contract §5.3, docs/demo-workflows.md W1, W2, W6):
// - Customer (Portal): always Pending; flagged when the serial is unknown, already registered or the model differs.
// - Dealer / distributor / admin (form or bulk): clean rows are approved at once; a duplicate serial goes to admin
//   review; other problems come back as field errors to fix.
// - Approval creates or completes the unit and attaches the model's parts, each with its own warranty.

/** Who a registration is written by: a signed-in user, or the system for ERP and email intake. */
export interface Submitter {
  id: string;
  name: string;
}

export interface NewRegistration {
  serial: string;
  modelCode: string;
  customer: RegistrationCustomer;
  customerId?: string;
  dealerId?: string;
  installDate?: IsoDate;
  purchaseDate?: IsoDate;
  invoiceNumber?: string;
  location?: string;
  attachmentIds?: string[];
  duplicateOfSerial?: string;
  batchId?: string;
}

type OrderBy = Prisma.RegistrationOrderByWithRelationInput;
const SORTS: Record<string, (dir: Prisma.SortOrder) => OrderBy> = {
  id: (dir) => ({ id: dir }),
  channel: (dir) => ({ channel: dir }),
  status: (dir) => ({ status: dir }),
  serial: (dir) => ({ serial: dir }),
  modelCode: (dir) => ({ modelCode: dir }),
  customer: (dir) => ({ customerName: dir }),
  customerName: (dir) => ({ customerName: dir }),
  installDate: (dir) => ({ installDate: dir }),
  purchaseDate: (dir) => ({ purchaseDate: dir }),
  invoiceNumber: (dir) => ({ invoiceNumber: dir }),
  submittedByName: (dir) => ({ submittedByName: dir }),
  submittedAt: (dir) => ({ submittedAt: dir }),
  reviewedAt: (dir) => ({ reviewedAt: dir }),
  dealerName: (dir) => ({ dealer: { name: dir } }),
};

const isUniqueViolation = (err: unknown) =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";

const duplicateSerial = () =>
  AppError.conflict("duplicate_serial", "This serial is already registered. Merge or reject the registration.");

@Injectable()
export class RegistrationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: CatalogService,
    private readonly files: FilesService,
    private readonly units: UnitsService,
    private readonly unitRows: UnitsRepository,
    private readonly notifier: Notifier,
    private readonly integrations: IntegrationLog,
  ) {}

  // ── Reads ──────────────────────────────────────────────────────────────────

  async list(ctx: Ctx, query: RawQuery): Promise<Paginated<RegistrationView>> {
    const list = listQuery(query);
    const flag = queryEnum(query, "flag", REGISTRATION_FLAGS);
    const q = list.q;
    const where: Prisma.RegistrationWhereInput = {
      ...scopeWhere(ctx.user),
      status: queryEnum(query, "status", REGISTRATION_STATUSES),
      channel: queryEnum(query, "channel", REGISTRATION_CHANNELS),
      ...(flag ? { flags: { has: flag } } : {}),
      ...(q
        ? {
            OR: [
              { serial: { contains: q, mode: "insensitive" } },
              { customerName: { contains: q, mode: "insensitive" } },
              { modelCode: { contains: q, mode: "insensitive" } },
              { dealer: { name: { contains: q, mode: "insensitive" } } },
            ],
          }
        : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.registration.count({ where }),
      this.prisma.registration.findMany({
        where,
        include: registrationInclude,
        orderBy: [resolveSort(list.sort, SORTS, "-submittedAt"), { id: "asc" }],
        ...pageArgs(list),
      }),
    ]);
    return { items: await this.views(this.prisma, ctx, rows), total, page: list.page, pageSize: list.pageSize };
  }

  async get(ctx: Ctx, id: string, db: Db = this.prisma): Promise<RegistrationView> {
    const row = await db.registration.findUnique({ where: { id }, include: registrationInclude });
    if (!row || !canSee(ctx.user, row)) throw AppError.notFound("Registration");
    const [view] = await this.views(db, ctx, [row]);
    return view!;
  }

  private async views(db: Db, ctx: Pick<Ctx, "user" | "today">, rows: RegistrationRow[]): Promise<RegistrationView[]> {
    const serials = ctx.user.role === "admin" ? rows.flatMap((r) => r.duplicateOfSerial ?? []) : [];
    const duplicates = new Map((await this.unitRows.load(db, serials)).map((u) => [u.serial, u]));
    return rows.map((r) => toRegistrationView(r, ctx, r.duplicateOfSerial ? duplicates.get(r.duplicateOfSerial) : null));
  }

  // ── Create (CU01, DL03) ────────────────────────────────────────────────────

  async create(ctx: Ctx, rawBody: unknown): Promise<RegistrationView> {
    const body = createBody(rawBody);
    const { user } = ctx;
    const id = await this.prisma.tx(async (tx) => {
      await this.files.assertOwn(tx, user, body.attachmentIds);
      return user.role === "customer" ? this.createByCustomer(tx, ctx, body) : this.createByDealer(tx, ctx, body);
    });
    return this.get(ctx, id);
  }

  /** CU01 (Portal): always Pending, for the admin to check against the invoice. */
  private async createByCustomer(tx: Tx, ctx: Ctx, body: ReturnType<typeof createBody>): Promise<string> {
    const { user } = ctx;
    const serial = normalizeSerialValue(body.serial);
    const modelCode = (body.modelCode ?? "").trim().toUpperCase();
    const errors: Record<string, string> = {};
    if (!serial) errors.serial = "validation.required";
    if (!modelCode) errors.modelCode = "validation.required";
    if (!isIsoDate(body.purchaseDate)) errors.purchaseDate = "validation.date";
    else if (body.purchaseDate > ctx.today) errors.purchaseDate = "rowErrors.future_date";
    if (!body.attachmentIds?.length) errors.attachmentIds = "validation.invoiceRequired";
    if (Object.keys(errors).length) throw AppError.validation("Check the highlighted fields.", errors);

    const unit = await tx.unit.findUnique({
      where: { serial },
      include: { model: true, _count: { select: { parts: true } } },
    });
    const customer = user.customerId ? await tx.customer.findUnique({ where: { id: user.customerId } }) : null;
    const registered = !!unit && unit._count.parts > 0;
    const flags: RegistrationFlag[] = [];
    if (!unit) flags.push("EXCEPTION");
    else if (registered) flags.push("DUPLICATE", "EXCEPTION");
    if (unit && unit.model.code !== modelCode) flags.push("MODEL_MISMATCH");

    const id = await this.insert(
      tx,
      {
        serial,
        modelCode,
        customer: {
          name: customer?.name ?? user.name,
          phone: customer?.phone || undefined,
          email: customer?.email ?? user.email,
          city: customer?.city || undefined,
        },
        customerId: user.customerId,
        dealerId: unit?.dealerId ?? undefined,
        purchaseDate: body.purchaseDate,
        location: body.location?.trim() || undefined,
        attachmentIds: body.attachmentIds ?? [],
        duplicateOfSerial: registered ? serial : undefined,
      },
      "PORTAL",
      user,
      ctx.now,
    );
    await this.sendToReview(tx, id, serial, flags, ctx.now);
    return id;
  }

  /** DL03: a clean registration is approved at once; a duplicate serial waits for the admin. */
  private async createByDealer(tx: Tx, ctx: Ctx, body: ReturnType<typeof createBody>): Promise<string> {
    const { user } = ctx;
    requireRole(user, "admin", "dealer", "distributor");
    const dealerId = dealerIdFor(user, body.dealerId, await this.catalog.dealerIds(tx));
    const errors = validateRegistrationRow(body, await this.rowContext(tx, ctx.today, body.serial));
    const fields = rowToFields(body);
    const extra = {
      dealerId,
      purchaseDate: body.purchaseDate || fields.installDate,
      location: body.location?.trim() || undefined,
      attachmentIds: body.attachmentIds ?? [],
    };
    if (needsAdminReview(errors)) {
      const id = await this.insert(tx, { ...fields, ...extra, duplicateOfSerial: fields.serial }, "DEALER", user, ctx.now);
      await this.sendToReview(tx, id, fields.serial, ["DUPLICATE", "EXCEPTION"], ctx.now);
      return id;
    }
    if (hasErrors(errors)) throw AppError.validation("Check the highlighted fields.", rowFieldErrors(errors));
    if (extra.purchaseDate && (!isIsoDate(extra.purchaseDate) || extra.purchaseDate > ctx.today)) {
      throw AppError.validation("Check the highlighted fields.", { purchaseDate: "validation.date" });
    }

    const customerId = await this.customerIdFor(tx, fields.customer, ctx.now);
    const id = await this.insert(tx, { ...fields, ...extra, customerId }, "DEALER", user, ctx.now);
    await this.approve(tx, ctx, id, "Auto-approved (dealer registration)");
    return id;
  }

  // ── Admin decisions (A02, A03) ─────────────────────────────────────────────

  async approveOne(ctx: Ctx, id: string): Promise<RegistrationView> {
    requireRole(ctx.user, "admin");
    await this.prisma.tx(async (tx) => {
      const reg = await this.pending(tx, id);
      if (reg.flags.includes("DUPLICATE")) throw duplicateSerial();
      if (!reg.customerId) {
        const customerId = await this.customerIdFor(tx, this.customerOf(reg), ctx.now);
        await tx.registration.update({ where: { id }, data: { customerId } });
      }
      await this.approve(tx, ctx, id, ctx.user.name);
    });
    return this.get(ctx, id);
  }

  async reject(ctx: Ctx, id: string, rawReason: unknown): Promise<RegistrationView> {
    requireRole(ctx.user, "admin");
    await this.prisma.tx(async (tx) => {
      const reg = await this.pending(tx, id);
      const reason = typeof rawReason === "string" ? rawReason.trim().slice(0, 1000) : "";
      if (!reason) throw AppError.validation("Give a reason.", { reason: "validation.reasonRequired" });
      await tx.registration.update({
        where: { id },
        data: { status: "REJECTED", rejectReason: reason, reviewedByName: ctx.user.name, reviewedAt: ctx.now },
      });
      const followers = await this.notifier.followers(tx, reg, { includeDealer: false });
      await this.notifier.notify(tx, [reg.submittedBy, ...followers], "registration_rejected", ctx.now, {
        params: { serial: reg.serial, reason },
      });
    });
    return this.get(ctx, id);
  }

  /** A duplicate of an existing unit: keep the existing record, add this submission's files to it. */
  async merge(ctx: Ctx, id: string): Promise<RegistrationView> {
    requireRole(ctx.user, "admin");
    await this.prisma.tx(async (tx) => {
      const reg = await this.pending(tx, id);
      const serial = reg.duplicateOfSerial;
      if (serial) await this.unitRows.lock(tx, serial);
      const unit = serial ? await tx.unit.findUnique({ where: { serial } }) : null;
      if (!unit) throw AppError.conflict("nothing_to_merge", "There's no existing record to merge into.");
      await tx.unit.update({
        where: { serial: unit.serial },
        data: { attachmentIds: [...unit.attachmentIds, ...reg.attachmentIds] },
      });
      await this.units.addEvent(tx, unit.serial, {
        at: ctx.now,
        type: "note",
        byName: ctx.user.name,
        text: `Merged registration ${reg.id}`,
        refId: reg.id,
      });
      await tx.registration.update({
        where: { id },
        data: { status: "APPROVED", reviewedByName: ctx.user.name, reviewedAt: ctx.now },
      });
    });
    return this.get(ctx, id);
  }

  /** A02 bulk approve. Skips duplicates, decided rows and unknown models; each approval stands on its own. */
  async bulkApprove(ctx: Ctx, rawIds: unknown): Promise<{ approved: number; skipped: number }> {
    requireRole(ctx.user, "admin");
    const ids = Array.isArray(rawIds) ? rawIds.filter((id): id is string => typeof id === "string").slice(0, 500) : [];
    const modelCodes = await this.catalog.modelCodes();
    let approved = 0;
    let skipped = 0;
    for (const id of ids) {
      let done = false;
      try {
        done = await this.prisma.tx(async (tx) => {
          const reg = await this.pending(tx, id);
          if (reg.flags.includes("DUPLICATE") || !modelCodes.has(reg.modelCode)) return false;
          if (!reg.customerId) {
            const customerId = await this.customerIdFor(tx, this.customerOf(reg), ctx.now);
            await tx.registration.update({ where: { id }, data: { customerId } });
          }
          await this.approve(tx, ctx, id, ctx.user.name);
          return true;
        });
      } catch (err) {
        // Missing, already decided, or registered meanwhile: skip it, keep going.
        if (!(err instanceof AppError)) throw err;
      }
      if (done) approved += 1;
      else skipped += 1;
    }
    return { approved, skipped };
  }

  // ── Shared with bulk import and the simulator ──────────────────────────────

  /** Row check context: the product master and whether this serial is already registered. */
  async rowContext(db: Db, today: IsoDate, serialInput: string | undefined, seenInFile?: ReadonlySet<string>): Promise<RowContext> {
    const serial = normalizeSerialValue(serialInput);
    const registered = serial
      ? await db.unit.findFirst({ where: { serial, parts: { some: {} } }, select: { serial: true } })
      : null;
    return {
      modelCodes: await this.catalog.modelCodes(db),
      existingSerials: new Set(registered ? [registered.serial] : []),
      seenInFile,
      today,
    };
  }

  async insert(db: Db, fields: NewRegistration, channel: RegistrationChannel, by: Submitter, now: Date): Promise<string> {
    const id = await nextId(db, "REG");
    await db.registration.create({
      data: {
        id,
        channel,
        status: "PENDING",
        flags: [],
        serial: fields.serial,
        modelCode: fields.modelCode,
        customerName: fields.customer.name,
        customerPhone: fields.customer.phone,
        customerEmail: fields.customer.email,
        customerCity: fields.customer.city,
        customerId: fields.customerId,
        dealerId: fields.dealerId,
        installDate: toDbDateOpt(fields.installDate),
        purchaseDate: toDbDateOpt(fields.purchaseDate),
        invoiceNumber: fields.invoiceNumber,
        location: fields.location,
        attachmentIds: fields.attachmentIds ?? [],
        submittedBy: by.id,
        submittedByName: by.name,
        submittedAt: now,
        duplicateOfSerial: fields.duplicateOfSerial,
        batchId: fields.batchId,
      },
    });
    return id;
  }

  /** Flags the registration and tells the admins it's waiting in the inbox. */
  async sendToReview(db: Db, id: string, serial: string, flags: RegistrationFlag[], now: Date): Promise<void> {
    await db.registration.update({ where: { id }, data: { flags } });
    await this.notifier.notify(db, await this.notifier.adminIds(db), "registration_submitted", now, {
      params: { serial },
      link: `/registrations/${id}`,
    });
  }

  /** Matches an existing customer by phone (last 10 digits) or email, otherwise creates one. */
  async customerIdFor(db: Db, customer: RegistrationCustomer, now: Date): Promise<string> {
    const phone = phoneKey(customer.phone);
    const email = emailKey(customer.email);
    const or: Prisma.CustomerWhereInput[] = [];
    if (phone) or.push({ phoneKey: phone });
    if (email) or.push({ emailKey: email });
    if (or.length) {
      const existing = await db.customer.findFirst({ where: { OR: or }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
      if (existing) return existing.id;
    }
    const id = await nextId(db, "CUS");
    await db.customer.create({
      data: {
        id,
        name: customer.name,
        phone: customer.phone ?? "",
        email: customer.email,
        city: customer.city ?? "",
        phoneKey: phone,
        emailKey: email,
        createdAt: now,
      },
    });
    return id;
  }

  /**
   * Creates or completes the unit, attaches the model's parts with their warranties, and approves. The warranty
   * starts on the install date, else the purchase date, else today.
   */
  async approve(
    tx: Tx,
    ctx: { today: IsoDate; now: Date },
    id: string,
    reviewer: string,
    { notifyDealer = true }: { notifyDealer?: boolean } = {},
  ): Promise<void> {
    const reg = await tx.registration.findUniqueOrThrow({ where: { id } });
    const model = await tx.model.findUnique({ where: { code: reg.modelCode }, include: modelInclude });
    if (!model) throw AppError.conflict("unknown_model", "The model code isn't in the product master.");

    await this.unitRows.lock(tx, reg.serial);
    let unit = await tx.unit.findUnique({ where: { serial: reg.serial }, include: { model: { include: modelInclude } } });
    if (unit && (await tx.unitPart.count({ where: { unitSerial: unit.serial } }))) throw duplicateSerial();
    if (!unit) {
      try {
        // Savepoint-free: a concurrent insert of the same serial fails the whole transaction, reported as a duplicate.
        await tx.unit.create({ data: { serial: reg.serial, modelId: model.id, brandId: model.brandId, attachmentIds: [] } });
      } catch (err) {
        if (isUniqueViolation(err)) throw duplicateSerial();
        throw err;
      }
      unit = await tx.unit.findUniqueOrThrow({ where: { serial: reg.serial }, include: { model: { include: modelInclude } } });
    }

    const unitModel = toModelView(unit.model);
    const installDate = reg.installDate ?? reg.purchaseDate;
    const purchaseDate = reg.purchaseDate ?? reg.installDate;
    const start: IsoDate = installDate ? installDate.toISOString().slice(0, 10) : ctx.today;
    const suffix = reg.serial.slice(-6);
    const parts = buildUnitParts(unitModel, start, {
      idPrefix: reg.serial,
      serials: { COMPRESSOR: `CP-${suffix}`, PCB: `PCB-${suffix}` },
    });
    await tx.unit.update({
      where: { serial: unit.serial },
      data: {
        dealerId: unit.dealerId ?? reg.dealerId,
        customerId: reg.customerId,
        installDate,
        purchaseDate,
        location: reg.location ?? unit.location,
        registrationId: reg.id,
        attachmentIds: [...unit.attachmentIds, ...reg.attachmentIds],
      },
    });
    await tx.unitPart.createMany({
      data: parts.map((p, position) => ({
        id: p.id,
        unitSerial: unit.serial,
        position,
        partType: p.partType,
        serial: p.serial,
        warrantyStart: toDbDate(p.warrantyStart),
        warrantyEnd: toDbDate(p.warrantyEnd),
        coversParts: p.coversParts,
        coversLabour: p.coversLabour,
      })),
    });
    await this.units.addEvent(tx, unit.serial, { at: ctx.now, type: "registered", byName: reviewer, refId: reg.id });
    await tx.registration.update({
      where: { id },
      data: { status: "APPROVED", reviewedByName: reviewer, reviewedAt: ctx.now },
    });

    // W6: an emailed registration updates the customer record in CRM once approved.
    if (reg.channel === "EMAIL") {
      const customer = reg.customerId ? await tx.customer.findUnique({ where: { id: reg.customerId } }) : null;
      await this.integrations.log(
        tx,
        {
          system: "CRM",
          direction: "OUT",
          type: "crm_update",
          refId: reg.id,
          payload: {
            action: "customer_product_registered",
            customer: { id: customer?.id, name: customer?.name, email: customer?.email, phone: customer?.phone },
            product: {
              serial: reg.serial,
              modelCode: reg.modelCode,
              purchaseDate: purchaseDate?.toISOString().slice(0, 10),
            },
            registrationId: reg.id,
            channel: reg.channel,
          },
        },
        ctx.now,
      );
    }
    const recipients = await this.notifier.followers(tx, reg, { includeDealer: notifyDealer });
    await this.notifier.notify(tx, recipients, "registration_approved", ctx.now, {
      params: { serial: reg.serial },
      link: `/units/${reg.serial}`,
    });
  }

  /** Row check for one bulk-import row, as the shared rules see it. */
  validateRow(values: RegistrationRowInput, context: RowContext) {
    return validateRegistrationRow(values, context);
  }

  /** A pending registration, locked for this transaction. 404 if missing, 409 if already decided. */
  private async pending(tx: Tx, id: string) {
    await tx.$queryRaw`SELECT id FROM registrations WHERE id = ${id} FOR UPDATE`;
    const reg = await tx.registration.findUnique({ where: { id } });
    if (!reg) throw AppError.notFound("Registration");
    if (reg.status !== "PENDING") throw AppError.conflict("not_pending", "This registration was already decided.");
    return reg;
  }

  private customerOf(reg: { customerName: string; customerPhone: string | null; customerEmail: string | null; customerCity: string | null }): RegistrationCustomer {
    return {
      name: reg.customerName,
      phone: reg.customerPhone ?? undefined,
      email: reg.customerEmail ?? undefined,
      city: reg.customerCity ?? undefined,
    };
  }

  /** The actor as a submitter. */
  static submitter(user: Actor): Submitter {
    return { id: user.id, name: user.name };
  }
}

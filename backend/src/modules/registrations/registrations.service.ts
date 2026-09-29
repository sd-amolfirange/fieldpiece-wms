import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  hasErrors,
  isIsoDate,
  isModelSerial,
  modelSerial,
  needsAdminReview,
  normalizeBatchValue,
  REGISTRATION_CHANNELS,
  REGISTRATION_FLAGS,
  REGISTRATION_STATUSES,
  SERIAL_PATTERN,
  serialNumberPart,
  validateRegistrationRow,
  warrantyFromPurchase,
  type IsoDate,
  type Paginated,
  type RegistrationChannel,
  type RegistrationCustomer,
  type RegistrationFlag,
  type RegistrationRowInput,
  type RegistrationView,
  type RowContext,
  type RowErrors,
} from "@wms/domain";
import type { Ctx } from "../../common/auth/context";
import { toDbDate, toDbDateOpt } from "../../common/db/dates";
import { nextId } from "../../common/db/ids";
import { AppError } from "../../common/errors/app-error";
import { listQuery, pageArgs, queryEnum, type RawQuery, resolveSort } from "../../common/http/list-query";
import { type Db, PrismaService, type Tx } from "../../infra/prisma/prisma.service";
import { canSee, dealerIdFor, requireRole, scopeWhere } from "../../domain/scope";
import { registrationInclude, type RegistrationRow, toRegistrationView } from "../../domain/views";
import { CatalogService } from "../catalog";
import { FilesService } from "../files";
import { IntegrationLog } from "../integrations";
import { Notifier } from "../notifications";
import { UnitsRepository, UnitsService } from "../units";
import {
  createBody,
  emailKey,
  isUsState,
  isUsZip,
  phoneKey,
  rowFieldErrors,
  rowToFields,
  type CreateRegistrationBody,
} from "./registration-input";

// Registration rules (docs/demo-workflows.md W1, W2, W6). Every entry point comes through here:
// - trusted senders (dealer form DEALER, bulk file BULK, partner systems with an API key: API / RETAIL / ERP): each row is checked against the
//   catalogue (model, serial and batch format, purchase date); clean rows are approved at once, a serial that's
//   already registered goes to admin review, anything else is returned as field errors;
// - customer-facing channels and invoices (signed-in customer PORTAL, public web form WEB, emailed invoices EMAIL,
//   distributor ERP invoice feed ERP):
//   always Pending for the warranty desk, flagged when the serial is unknown, already registered or the model differs.
// Approval creates or completes the product with its warranty: from the purchase date, for the model's term.

/** Who a registration is written by: a signed-in user, "system" for ERP / email intake, "partner:<id>" for the API. */
export interface Submitter {
  id: string;
  name: string;
}

export interface NewRegistration {
  serial: string;
  batchNumber?: string;
  modelCode: string;
  customer: RegistrationCustomer;
  customerId?: string;
  dealerId?: string;
  purchaseDate?: IsoDate;
  invoiceNumber?: string;
  placeOfPurchase?: string;
  attachmentIds?: string[];
  duplicateOfSerial?: string;
  importId?: string;
}

/** Outcome of a trusted registration (dealer form, bulk row, partner API item). */
export type TrustedResult =
  | { status: "REGISTERED"; registrationId: string }
  | { status: "REVIEW"; registrationId: string; errors: RowErrors }
  | { status: "ERROR"; errors: RowErrors };

type OrderBy = Prisma.RegistrationOrderByWithRelationInput;
const SORTS: Record<string, (dir: Prisma.SortOrder) => OrderBy> = {
  id: (dir) => ({ id: dir }),
  channel: (dir) => ({ channel: dir }),
  status: (dir) => ({ status: dir }),
  serial: (dir) => ({ serial: dir }),
  batchNumber: (dir) => ({ batchNumber: dir }),
  modelCode: (dir) => ({ modelCode: dir }),
  customer: (dir) => ({ customerName: dir }),
  customerName: (dir) => ({ customerName: dir }),
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
  AppError.conflict(
    "duplicate_serial",
    "This serial is already registered. Merge or reject the registration.",
  );

/** Channels whose approval updates the customer record in CRM (registrations that didn't come through a dealer). */
const CRM_CHANNELS: ReadonlySet<string> = new Set(["EMAIL", "WEB", "RETAIL"]);

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
              { batchNumber: { contains: q, mode: "insensitive" } },
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
    return {
      items: await this.views(this.prisma, ctx, rows),
      total,
      page: list.page,
      pageSize: list.pageSize,
    };
  }

  async get(ctx: Pick<Ctx, "user" | "today">, id: string, db: Db = this.prisma): Promise<RegistrationView> {
    const row = await db.registration.findUnique({ where: { id }, include: registrationInclude });
    if (!row || !canSee(ctx.user, row)) throw AppError.notFound("Registration");
    const [view] = await this.views(db, ctx, [row]);
    return view!;
  }

  private async views(
    db: Db,
    ctx: Pick<Ctx, "user" | "today">,
    rows: RegistrationRow[],
  ): Promise<RegistrationView[]> {
    const serials = ctx.user.role === "admin" ? rows.flatMap((r) => r.duplicateOfSerial ?? []) : [];
    const [duplicateRows, modelImages] = await Promise.all([
      this.unitRows.load(db, serials),
      this.catalog.modelImages(db),
    ]);
    const duplicates = new Map(duplicateRows.map((u) => [u.serial, u]));
    return rows.map((r) =>
      toRegistrationView(
        r,
        ctx,
        r.duplicateOfSerial ? duplicates.get(r.duplicateOfSerial) : null,
        modelImages,
      ),
    );
  }

  // ── Signed-in entry points: dealer form (DL03) and customer portal (CU01) ───

  async create(ctx: Ctx, rawBody: unknown): Promise<RegistrationView> {
    const body = createBody(rawBody);
    const { user } = ctx;
    const id = await this.prisma.tx(async (tx) => {
      await this.files.assertOwn(tx, user, body.attachmentIds);
      return user.role === "customer"
        ? this.createByCustomer(tx, ctx, body)
        : this.createByDealer(tx, ctx, body);
    });
    return this.get(ctx, id);
  }

  /** CU01 (PORTAL): always Pending, for the warranty desk to check against the proof of purchase. */
  private async createByCustomer(tx: Tx, ctx: Ctx, body: CreateRegistrationBody): Promise<string> {
    const { user } = ctx;
    const errors = await this.selfServiceErrors(tx, ctx.today, body, { proofRequired: true });
    if (Object.keys(errors).length) throw AppError.validation("Check the highlighted fields.", errors);
    const customer = user.customerId
      ? await tx.customer.findUnique({ where: { id: user.customerId } })
      : null;
    const fields = rowToFields(body);
    return this.submitForReview(
      tx,
      {
        ...fields,
        customer: {
          name: customer?.name ?? user.name,
          phone: customer?.phone || undefined,
          email: customer?.email ?? user.email,
          city: customer?.city || undefined,
          state: customer?.state || undefined,
          zip: customer?.zip || undefined,
        },
        customerId: user.customerId,
        placeOfPurchase: body.placeOfPurchase?.trim() || undefined,
        attachmentIds: body.attachmentIds ?? [],
      },
      "PORTAL",
      { id: user.id, name: user.name },
      ctx.now,
    );
  }

  /** DL03: a clean registration is approved at once; a duplicate serial waits for the warranty desk. */
  private async createByDealer(tx: Tx, ctx: Ctx, body: CreateRegistrationBody): Promise<string> {
    const { user } = ctx;
    requireRole(user, "admin", "dealer", "distributor");
    const dealerId = dealerIdFor(user, body.dealerId, await this.catalog.dealerIds(tx));
    const result = await this.registerTrusted(
      tx,
      ctx,
      body,
      "DEALER",
      { id: user.id, name: user.name },
      {
        dealerId,
        attachmentIds: body.attachmentIds ?? [],
        reviewer: "Auto-approved (dealer registration)",
      },
    );
    if (result.status === "ERROR") {
      throw AppError.validation("Check the highlighted fields.", rowFieldErrors(result.errors));
    }
    return result.registrationId;
  }

  // ── Shared by every entry point ─────────────────────────────────────────────

  /**
   * Field checks for self-service registrations (customer portal, public web form): model, serial and batch against
   * the model's format, purchase date not in the future, proof of purchase. Batch is optional here (the label may be
   * hard to read), but must match the model's format when given.
   */
  async selfServiceErrors(
    db: Db,
    today: IsoDate,
    body: RegistrationRowInput & { attachmentIds?: string[] },
    { proofRequired }: { proofRequired: boolean },
  ): Promise<Record<string, string>> {
    const errors: Record<string, string> = {};
    const modelCode = (body.modelCode ?? "").trim().toUpperCase();
    const serial = modelSerial(modelCode, body.serial);
    const batch = normalizeBatchValue(body.batchNumber);
    const format = (await this.catalog.modelFormats(db)).get(modelCode);
    if (!modelCode) errors.modelCode = "validation.required";
    else if (!format) errors.modelCode = "rowErrors.unknown_model";
    if (!serial) errors.serial = "validation.required";
    else if (!SERIAL_PATTERN.test(serial) || (format && !isModelSerial(serial, modelCode, format)))
      errors.serial = "rowErrors.invalid_serial";
    if (batch && format && !format.batch.test(batch)) errors.batchNumber = "rowErrors.invalid_batch";
    if (!isIsoDate(body.purchaseDate)) errors.purchaseDate = "validation.date";
    else if (body.purchaseDate > today) errors.purchaseDate = "rowErrors.future_date";
    if (!isUsState(body.state?.trim().toUpperCase())) errors.state = "validation.state";
    if (!isUsZip(body.zip?.trim())) errors.zip = "validation.zip";
    if (proofRequired && !body.attachmentIds?.length) errors.attachmentIds = "validation.invoiceRequired";
    return errors;
  }

  /**
   * A trusted sender's registration: checked against the catalogue; clean -> approved at once, duplicate serial ->
   * admin review, anything else -> field errors (nothing stored).
   */
  async registerTrusted(
    tx: Tx,
    ctx: { today: IsoDate; now: Date },
    values: RegistrationRowInput,
    channel: RegistrationChannel,
    by: { id: string; name: string },
    extra: {
      dealerId?: string;
      placeOfPurchase?: string;
      attachmentIds?: string[];
      importId?: string;
      seenInFile?: ReadonlySet<string>;
      reviewer: string;
      notifyDealer?: boolean;
    },
  ): Promise<TrustedResult> {
    const errors = validateRegistrationRow(
      values,
      await this.rowContext(tx, ctx.today, values.serial, values.modelCode, extra.seenInFile),
    );
    const fields = rowToFields(values);
    const common = {
      ...fields,
      dealerId: extra.dealerId,
      placeOfPurchase: extra.placeOfPurchase,
      attachmentIds: extra.attachmentIds ?? [],
      importId: extra.importId,
    };
    if (needsAdminReview(errors)) {
      const registrationId = await this.insert(
        tx,
        { ...common, duplicateOfSerial: fields.serial },
        channel,
        by,
        ctx.now,
      );
      await this.sendToReview(tx, registrationId, fields.serial, ["DUPLICATE", "EXCEPTION"], ctx.now);
      return { status: "REVIEW", registrationId, errors };
    }
    if (hasErrors(errors)) return { status: "ERROR", errors };
    const customerId = await this.customerIdFor(tx, fields.customer, ctx.now);
    const registrationId = await this.insert(tx, { ...common, customerId }, channel, by, ctx.now);
    await this.approve(tx, ctx, registrationId, extra.reviewer, { notifyDealer: extra.notifyDealer });
    return { status: "REGISTERED", registrationId };
  }

  /** A customer-facing channel's registration: Pending, flagged for the warranty desk. */
  async submitForReview(
    tx: Tx,
    fields: NewRegistration,
    channel: RegistrationChannel,
    by: { id: string; name: string },
    now: Date,
  ): Promise<string> {
    // The ERP is where new serials come from: an unknown serial is expected there, not an exception.
    const flags = (await this.reviewFlags(tx, fields.serial, fields.modelCode)).filter(
      (f, _i, all) => channel !== "ERP" || f !== "EXCEPTION" || all.includes("DUPLICATE"),
    );
    const duplicate = flags.includes("DUPLICATE");
    const unit = await tx.unit.findUnique({ where: { serial: fields.serial }, select: { dealerId: true } });
    const id = await this.insert(
      tx,
      {
        ...fields,
        dealerId: fields.dealerId ?? unit?.dealerId ?? undefined,
        duplicateOfSerial: duplicate ? fields.serial : undefined,
      },
      channel,
      by,
      now,
    );
    await this.sendToReview(tx, id, fields.serial, flags, now);
    return id;
  }

  /**
   * EXCEPTION when the serial is unknown; DUPLICATE when already registered; MODEL_MISMATCH when we know this label
   * number under another model (the serial is MODEL-NUMBER, so a wrongly picked model gives an unknown serial).
   */
  async reviewFlags(db: Db, serial: string, modelCode: string): Promise<RegistrationFlag[]> {
    const unit = await db.unit.findUnique({ where: { serial }, include: { model: true } });
    const flags: RegistrationFlag[] = [];
    if (!unit) flags.push("EXCEPTION");
    else if (unit.warrantyEnd) flags.push("DUPLICATE", "EXCEPTION");
    if (unit && unit.model.code !== modelCode) flags.push("MODEL_MISMATCH");
    if (!unit) {
      const number = serialNumberPart(serial);
      const sameNumber = await db.unit.findFirst({
        where: { serial: { endsWith: `-${number}` }, NOT: { serial } },
        select: { serial: true },
      });
      if (sameNumber) flags.push("MODEL_MISMATCH");
    }
    return flags;
  }

  // ── Warranty desk decisions (A02, A03) ──────────────────────────────────────

  async approveOne(ctx: Ctx, id: string): Promise<RegistrationView> {
    requireRole(ctx.user, "admin");
    await this.prisma.tx(async (tx) => {
      const reg = await this.pending(tx, id);
      if (reg.flags.includes("DUPLICATE")) throw duplicateSerial();
      await this.ensureCustomer(tx, reg, ctx.now);
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
        data: {
          status: "REJECTED",
          rejectReason: reason,
          reviewedByName: ctx.user.name,
          reviewedAt: ctx.now,
        },
      });
      const followers = await this.notifier.followers(tx, reg, { includeDealer: false });
      await this.notifier.notify(tx, [reg.submittedBy, ...followers], "registration_rejected", ctx.now, {
        params: { serial: reg.serial, reason },
      });
    });
    return this.get(ctx, id);
  }

  /** A duplicate of an existing product: keep the existing record, add this submission's files to it. */
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
    const ids = Array.isArray(rawIds)
      ? rawIds.filter((id): id is string => typeof id === "string").slice(0, 500)
      : [];
    const models = await this.catalog.modelFormats();
    let approved = 0;
    let skipped = 0;
    for (const id of ids) {
      let done = false;
      try {
        done = await this.prisma.tx(async (tx) => {
          const reg = await this.pending(tx, id);
          if (reg.flags.includes("DUPLICATE") || !models.has(reg.modelCode)) return false;
          await this.ensureCustomer(tx, reg, ctx.now);
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

  // ── Building blocks ─────────────────────────────────────────────────────────

  /** Row check context: the catalogue and whether this serial is already registered. */
  async rowContext(
    db: Db,
    today: IsoDate,
    serialInput: string | undefined,
    modelCode: string | undefined,
    seenInFile?: ReadonlySet<string>,
  ): Promise<RowContext> {
    const serial = modelSerial(modelCode, serialInput);
    const registered = serial
      ? await db.unit.findFirst({ where: { serial, warrantyEnd: { not: null } }, select: { serial: true } })
      : null;
    return {
      models: await this.catalog.modelFormats(db),
      existingSerials: new Set(registered ? [registered.serial] : []),
      seenInFile,
      today,
    };
  }

  async insert(
    db: Db,
    fields: NewRegistration,
    channel: RegistrationChannel,
    by: Submitter,
    now: Date,
  ): Promise<string> {
    const id = await nextId(db, "REG");
    await db.registration.create({
      data: {
        id,
        channel,
        status: "PENDING",
        flags: [],
        serial: fields.serial,
        batchNumber: fields.batchNumber,
        modelCode: fields.modelCode,
        customerName: fields.customer.name,
        customerPhone: fields.customer.phone,
        customerEmail: fields.customer.email,
        customerCity: fields.customer.city,
        customerState: fields.customer.state,
        customerZip: fields.customer.zip,
        customerId: fields.customerId,
        dealerId: fields.dealerId,
        purchaseDate: toDbDateOpt(fields.purchaseDate),
        invoiceNumber: fields.invoiceNumber,
        placeOfPurchase: fields.placeOfPurchase,
        attachmentIds: fields.attachmentIds ?? [],
        submittedBy: by.id,
        submittedByName: by.name,
        submittedAt: now,
        duplicateOfSerial: fields.duplicateOfSerial,
        importId: fields.importId,
      },
    });
    return id;
  }

  /** Flags the registration and tells the warranty desk it's waiting in the inbox. */
  async sendToReview(
    db: Db,
    id: string,
    serial: string,
    flags: RegistrationFlag[],
    now: Date,
  ): Promise<void> {
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
      const existing = await db.customer.findFirst({
        where: { OR: or },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      });
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
        state: customer.state ?? "",
        zip: customer.zip ?? "",
        phoneKey: phone,
        emailKey: email,
        createdAt: now,
      },
    });
    return id;
  }

  private async ensureCustomer(tx: Tx, reg: Prisma.RegistrationGetPayload<object>, now: Date): Promise<void> {
    if (reg.customerId) return;
    const customerId = await this.customerIdFor(
      tx,
      {
        name: reg.customerName,
        phone: reg.customerPhone ?? undefined,
        email: reg.customerEmail ?? undefined,
        city: reg.customerCity ?? undefined,
        state: reg.customerState ?? undefined,
        zip: reg.customerZip ?? undefined,
      },
      now,
    );
    await tx.registration.update({ where: { id: reg.id }, data: { customerId } });
  }

  /**
   * Creates or completes the product and starts its warranty: from the purchase date (today when unknown), for the
   * model's warranty term.
   */
  async approve(
    tx: Tx,
    ctx: { today: IsoDate; now: Date },
    id: string,
    reviewer: string,
    { notifyDealer = true }: { notifyDealer?: boolean } = {},
  ): Promise<void> {
    const reg = await tx.registration.findUniqueOrThrow({ where: { id } });
    const model = await tx.model.findUnique({ where: { code: reg.modelCode } });
    if (!model) throw AppError.conflict("unknown_model", "The model isn't in the product catalog.");

    await this.unitRows.lock(tx, reg.serial);
    const existing = await tx.unit.findUnique({ where: { serial: reg.serial } });
    if (existing?.warrantyEnd) throw duplicateSerial();
    const purchaseDate = reg.purchaseDate ? reg.purchaseDate.toISOString().slice(0, 10) : undefined;
    // An ERP-known product keeps its catalogue model; its template decides the warranty term.
    const unitModel = existing
      ? ((await tx.model.findUnique({ where: { id: existing.modelId } })) ?? model)
      : model;
    const warranty = warrantyFromPurchase(unitModel, purchaseDate, ctx.today);
    const data = {
      batchNumber: reg.batchNumber ?? existing?.batchNumber ?? null,
      dealerId: existing?.dealerId ?? reg.dealerId,
      customerId: reg.customerId,
      purchaseDate: toDbDate(warranty.warrantyStart),
      placeOfPurchase: reg.placeOfPurchase ?? existing?.placeOfPurchase ?? null,
      warrantyStart: toDbDate(warranty.warrantyStart),
      warrantyEnd: toDbDate(warranty.warrantyEnd),
      registrationId: reg.id,
    };
    if (existing) {
      await tx.unit.update({
        where: { serial: existing.serial },
        data: { ...data, attachmentIds: [...existing.attachmentIds, ...reg.attachmentIds] },
      });
    } else {
      try {
        await tx.unit.create({
          data: { serial: reg.serial, modelId: model.id, attachmentIds: reg.attachmentIds, ...data },
        });
      } catch (err) {
        // A concurrent insert of the same serial fails the whole transaction; report it as a duplicate.
        if (isUniqueViolation(err)) throw duplicateSerial();
        throw err;
      }
    }
    await this.units.addEvent(tx, reg.serial, {
      at: ctx.now,
      type: "registered",
      byName: reviewer,
      refId: reg.id,
    });
    await tx.registration.update({
      where: { id },
      data: { status: "APPROVED", reviewedByName: reviewer, reviewedAt: ctx.now },
    });

    // Registrations that didn't come through a dealer update the customer record in CRM once approved.
    if (CRM_CHANNELS.has(reg.channel)) {
      const customer = reg.customerId
        ? await tx.customer.findUnique({ where: { id: reg.customerId } })
        : null;
      await this.integrations.log(
        tx,
        {
          system: "CRM",
          direction: "OUT",
          type: "crm_update",
          refId: reg.id,
          payload: {
            action: "customer_product_registered",
            customer: {
              id: customer?.id,
              name: customer?.name,
              email: customer?.email,
              phone: customer?.phone,
              state: customer?.state,
            },
            product: {
              serial: reg.serial,
              batchNumber: reg.batchNumber,
              modelCode: reg.modelCode,
              purchaseDate,
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

  /** A pending registration, locked for this transaction. 404 if missing, 409 if already decided. */
  private async pending(tx: Tx, id: string) {
    await tx.$queryRaw`SELECT id FROM registrations WHERE id = ${id} FOR UPDATE`;
    const reg = await tx.registration.findUnique({ where: { id } });
    if (!reg) throw AppError.notFound("Registration");
    if (reg.status !== "PENDING")
      throw AppError.conflict("not_pending", "This registration was already decided.");
    return reg;
  }
}

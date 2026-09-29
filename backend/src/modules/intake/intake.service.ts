import { Inject, Injectable, Logger } from "@nestjs/common";
import {
  modelSerial,
  type IntakeInfo,
  type RegistrationRowInput,
  type RowErrors,
} from "@wms/domain";
import { timingSafeEqual } from "node:crypto";
import type { SystemCtx } from "../../common/auth/context";
import { AppError } from "../../common/errors/app-error";
import type { UploadedFile } from "../../common/http/multipart";
import { ENV } from "../../config/config.module";
import type { Env } from "../../config/env";
import { PrismaService } from "../../infra/prisma/prisma.service";
import { FilesService } from "../files";
import { IntegrationLog } from "../integrations";
import { RegistrationsService } from "../registrations";
import { parseRegistrationEmail } from "./email-parser";
import type { PartnerClientRow } from "./partner-clients.service";

// Registration entry points besides the signed-in screens (item 6 of the Fieldpiece feedback):
// - the public registration form (WEB): no account; always reviewed by the warranty desk;
// - the partner API (API / RETAIL / ERP): partner systems send registrations; clean ones are registered at once;
// - email intake (EMAIL): the mail provider forwards emailed invoices; reviewed by the warranty desk.
// Every one goes through RegistrationsService, so the rules are the same as for the dealer and customer screens.

export interface PublicRegistrationFields {
  serial?: string;
  batchNumber?: string;
  modelCode?: string;
  purchaseDate?: string;
  placeOfPurchase?: string;
  invoiceNumber?: string;
  customerName?: string;
  customerEmail?: string;
  customerPhone?: string;
  city?: string;
  state?: string;
  zip?: string;
  /** Honeypot: people never fill it in; spam bots do. */
  website?: string;
}

export interface PartnerItemResult {
  index: number;
  serial: string;
  status: "REGISTERED" | "REVIEW" | "ERROR";
  registrationId?: string;
  errors?: RowErrors;
}

export interface InboundEmail {
  from?: unknown;
  to?: unknown;
  subject?: unknown;
  text?: unknown;
  attachments?: unknown;
}

const MAX_PARTNER_ITEMS = 500;
const MAX_EMAIL_ATTACHMENTS = 5;

const str = (value: unknown, max = 200) =>
  typeof value === "string"
    ? value.trim().slice(0, max)
    : typeof value === "number"
      ? String(value)
      : undefined;

/** Accepts `{ customer: { name, email, ... } }` or flat `customerName` / `customerEmail` fields. */
function partnerRow(item: Record<string, unknown>): RegistrationRowInput & { placeOfPurchase?: string } {
  const customer = (item.customer && typeof item.customer === "object" ? item.customer : {}) as Record<
    string,
    unknown
  >;
  return {
    serial: str(item.serial),
    batchNumber: str(item.batchNumber),
    modelCode: str(item.modelCode ?? item.model),
    purchaseDate: str(item.purchaseDate),
    customerName: str(customer.name ?? item.customerName),
    customerEmail: str(customer.email ?? item.customerEmail),
    customerPhone: str(customer.phone ?? item.customerPhone),
    city: str(customer.city ?? item.city),
    state: str(customer.state ?? item.state),
    zip: str(customer.zip ?? item.zip),
    invoiceNumber: str(item.invoiceNumber ?? item.orderNumber),
    placeOfPurchase: str(item.placeOfPurchase),
  };
}

@Injectable()
export class IntakeService {
  private readonly logger = new Logger(IntakeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly registrations: RegistrationsService,
    private readonly files: FilesService,
    private readonly integrations: IntegrationLog,
    @Inject(ENV) private readonly env: Env,
  ) {}

  info(): IntakeInfo {
    return {
      publicFormPath: "/register-product",
      inboundEmail: this.env.INBOUND_EMAIL_ADDRESS,
      partnerApiPath: `/${this.env.API_PREFIX}/partner/v1`,
    };
  }

  // ── Public registration form (WEB) ─────────────────────────────────────────

  /** A registration from the public form. Returns only what the confirmation page shows. */
  async publicRegistration(
    ctx: SystemCtx,
    fields: PublicRegistrationFields,
    proof: UploadedFile | undefined,
  ): Promise<{ registrationId: string; status: "PENDING" }> {
    // A filled-in honeypot is a bot: answer like a success, store nothing.
    if (fields.website) return { registrationId: "REG-0", status: "PENDING" };

    const errors = await this.registrations.selfServiceErrors(
      this.prisma,
      ctx.today,
      { ...fields, attachmentIds: proof ? ["proof"] : [] },
      {
        proofRequired: true,
      },
    );
    const name = fields.customerName?.trim() ?? "";
    const email = fields.customerEmail?.trim().toLowerCase() ?? "";
    if (!name) errors.customerName = "validation.required";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.customerEmail = "validation.email";
    if (Object.keys(errors).length) throw AppError.validation("Check the highlighted fields.", errors);
    const checked = this.files.check(proof);

    const registrationId = await this.prisma.tx(async (tx) => {
      const attachment = await this.files.store(tx, { ...checked, uploadedBy: "public" }, ctx.now);
      return this.registrations.submitForReview(
        tx,
        {
          serial: modelSerial(fields.modelCode, fields.serial),
          batchNumber: fields.batchNumber?.trim().toUpperCase() || undefined,
          modelCode: (fields.modelCode ?? "").trim().toUpperCase(),
          customer: {
            name,
            email,
            phone: fields.customerPhone?.trim() || undefined,
            city: fields.city?.trim() || undefined,
            state: fields.state?.trim().toUpperCase() || undefined,
            zip: fields.zip?.trim() || undefined,
          },
          purchaseDate: fields.purchaseDate,
          invoiceNumber: fields.invoiceNumber?.trim() || undefined,
          placeOfPurchase: fields.placeOfPurchase?.trim() || undefined,
          attachmentIds: [attachment.id],
        },
        "WEB",
        { id: "public", name: `Web form: ${name}` },
        ctx.now,
      );
    });
    return { registrationId, status: "PENDING" };
  }

  // ── Partner API (API / RETAIL / ERP) ────────────────────────────────────────

  /** One or many registrations from a partner system; each item gets its own result. */
  async partnerRegistrations(
    ctx: SystemCtx,
    client: PartnerClientRow,
    body: unknown,
  ): Promise<{ results: PartnerItemResult[] }> {
    const source = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
    const items = Array.isArray(source.registrations) ? source.registrations : [source];
    if (!items.length) throw AppError.validation("Send at least one registration.");
    if (items.length > MAX_PARTNER_ITEMS) {
      throw AppError.validation(`Send at most ${MAX_PARTNER_ITEMS} registrations per request.`);
    }
    const by = { id: `partner:${client.id}`, name: client.name };
    const seen = new Set<string>();
    const results: PartnerItemResult[] = [];
    for (const [index, raw] of items.entries()) {
      const row = partnerRow((raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>);
      const result = await this.prisma.tx((tx) =>
        this.registrations.registerTrusted(tx, ctx, row, client.channel, by, {
          dealerId: client.dealerId ?? undefined,
          placeOfPurchase: row.placeOfPurchase ?? (client.channel === "RETAIL" ? client.name : undefined),
          seenInFile: seen,
          reviewer: `Auto-approved (${client.name})`,
        }),
      );
      const serial = modelSerial(row.modelCode, row.serial);
      if (result.status !== "ERROR") seen.add(serial);
      results.push(
        result.status === "ERROR"
          ? { index, serial, status: "ERROR", errors: result.errors }
          : { index, serial, status: result.status, registrationId: result.registrationId },
      );
    }
    await this.integrations.log(
      this.prisma,
      {
        system: client.channel === "ERP" ? "ERP" : "PARTNER",
        direction: "IN",
        type: "partner_registration",
        refId: client.id,
        payload: {
          partner: client.name,
          channel: client.channel,
          received: results.length,
          registered: results.filter((r) => r.status === "REGISTERED").length,
          review: results.filter((r) => r.status === "REVIEW").length,
          errors: results.filter((r) => r.status === "ERROR").length,
          serials: results.map((r) => r.serial),
        },
      },
      ctx.now,
    );
    return { results };
  }

  // ── Email intake (EMAIL) ────────────────────────────────────────────────────

  /** Checks the webhook's shared secret; email intake is off (404) when none is configured. */
  assertInboundSecret(secret: string | undefined): void {
    const expected = this.env.INBOUND_EMAIL_SECRET;
    if (!expected) throw AppError.notFound("Route");
    const a = Buffer.from(secret ?? "");
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b))
      throw AppError.unauthenticated("Wrong or missing inbound secret.");
  }

  /**
   * An emailed invoice or message: the registration is read from the text, the attachments kept as proof of purchase,
   * and the result waits in the inbox. Emails without a serial are logged as failed for the desk to follow up.
   */
  async inboundEmail(
    ctx: SystemCtx,
    email: InboundEmail,
  ): Promise<{ status: "RECEIVED" | "IGNORED"; registrationId?: string }> {
    const from = str(email.from, 300) ?? "";
    const subject = str(email.subject, 300);
    const text = str(email.text, 20_000);
    const row = parseRegistrationEmail({ from, subject, text });
    const serial = modelSerial(row.modelCode, row.serial);
    const logPayload = { from, to: str(email.to, 300), subject, read: row };

    if (!serial) {
      await this.integrations.log(
        this.prisma,
        {
          system: "EMAIL",
          direction: "IN",
          type: "registration_email",
          status: "FAILED",
          lastError: "No serial number found in the email.",
          payload: logPayload,
        },
        ctx.now,
      );
      return { status: "IGNORED" };
    }
    const attachments = (Array.isArray(email.attachments) ? email.attachments : []).slice(
      0,
      MAX_EMAIL_ATTACHMENTS,
    );
    const registrationId = await this.prisma.tx(async (tx) => {
      const attachmentIds: string[] = [];
      for (const raw of attachments) {
        const a = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
        try {
          const checked = this.files.check({
            fileName: str(a.filename, 255) ?? "attachment",
            mime: str(a.contentType, 100) ?? "application/octet-stream",
            buffer: Buffer.from(typeof a.contentBase64 === "string" ? a.contentBase64 : "", "base64"),
          });
          attachmentIds.push((await this.files.store(tx, { ...checked, uploadedBy: "system" }, ctx.now)).id);
        } catch (err) {
          // Signatures and logos come along with invoices; skip what isn't a photo or PDF.
          if (!(err instanceof AppError)) throw err;
          this.logger.debug({ file: a.filename, err: err.message }, "Email attachment skipped");
        }
      }
      const id = await this.registrations.submitForReview(
        tx,
        {
          serial,
          batchNumber: row.batchNumber?.toUpperCase(),
          modelCode: (row.modelCode ?? "").toUpperCase(),
          customer: {
            name: row.customerName ?? "Unknown sender",
            email: row.customerEmail,
            phone: row.customerPhone,
            city: row.city,
            state: row.state?.toUpperCase(),
            zip: row.zip,
          },
          purchaseDate:
            row.purchaseDate && /^\d{4}-\d{2}-\d{2}$/.test(row.purchaseDate) ? row.purchaseDate : undefined,
          invoiceNumber: row.invoiceNumber,
          attachmentIds,
        },
        "EMAIL",
        { id: "system", name: `Email from ${row.customerEmail ?? from}` },
        ctx.now,
      );
      await this.integrations.log(
        tx,
        {
          system: "EMAIL",
          direction: "IN",
          type: "registration_email",
          refId: id,
          payload: { ...logPayload, attachments: attachmentIds.length },
        },
        ctx.now,
      );
      return id;
    });
    return { status: "RECEIVED", registrationId };
  }
}

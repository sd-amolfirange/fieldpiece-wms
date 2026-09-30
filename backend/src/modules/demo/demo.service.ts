import { Inject, Injectable, Logger } from "@nestjs/common";
import { addDaysIso, type PartnerChannel, type RegistrationView, serialNumberPart } from "@wms/domain";
import type { Ctx } from "../../common/auth/context";
import { nextCounter } from "../../common/db/ids";
import { AppError } from "../../common/errors/app-error";
import { ENV } from "../../config/config.module";
import type { Env } from "../../config/env";
import { type Db, PrismaService } from "../../infra/prisma/prisma.service";
import { BlobStorage } from "../../infra/storage/blob-storage";
import { requireRole } from "../../domain/scope";
import { hashPassword } from "../auth";
import { IntakeService } from "../intake";
import { IntegrationLog } from "../integrations";
import { Notifier } from "../notifications";
import { RegistrationsService } from "../registrations";
import { DEMO_ACCOUNTS } from "./seed-data";
import { writeSeed } from "./seed-writer";

// Demo-only (DEMO_FEATURES_ENABLED): the sign-in picker's accounts and the System events page (A13), which sends
// the messages the connected systems would: an ERP sales invoice, a registration email, a marketplace order, and
// registrations from Fieldpiece's apps (Job Link, Overwatch). The email, the marketplace order and the app
// registrations go through the same intake code as the real webhook and partner API.

/** A customer as a partner system sends it. */
interface PartnerCustomer {
  name: string;
  email: string;
  phone: string;
  city: string;
  state: string;
  zip: string;
}

/** The emailed invoice: a minimal one-page PDF, so it passes the same file checks as a real invoice. */
function invoicePdf(lines: [string, string][]): Buffer {
  // PDF string literals escape (, ) and \.
  const pdfText = (value: string) => value.replace(/[()\\]/g, (c) => `\\${c}`);
  const text = lines
    .map(([k, v], i) => `BT /F1 12 Tf 72 ${700 - i * 22} Td (${pdfText(`${k}: ${v}`)}) Tj ET`)
    .join("\n");
  const stream = `BT /F1 20 Tf 72 740 Td (INVOICE) Tj ET\n${text}`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}

@Injectable()
export class DemoService {
  private readonly logger = new Logger(DemoService.name);
  private passwordHash?: Promise<string>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: BlobStorage,
    private readonly registrations: RegistrationsService,
    private readonly intake: IntakeService,
    private readonly integrations: IntegrationLog,
    private readonly notifier: Notifier,
    @Inject(ENV) private readonly env: Env,
  ) {}

  accounts() {
    return DEMO_ACCOUNTS.map((a) => ({ ...a, password: this.env.DEMO_PASSWORD }));
  }

  /** Replaces all data with the starting data, dated from today. Signed-in seeded users stay signed in. */
  async reset(ctx: Ctx): Promise<{ ok: true }> {
    requireRole(ctx.user, "admin");
    this.passwordHash ??= hashPassword(this.env.DEMO_PASSWORD);
    const { removedFileKeys } = await writeSeed(this.prisma, {
      today: ctx.today,
      now: ctx.now,
      passwordHash: await this.passwordHash,
    });
    // The rows are gone; remove the bytes too (best effort, after the commit).
    for (const key of removedFileKeys) {
      await this.storage
        .delete(key)
        .catch((err: Error) => this.logger.warn({ key, err: err.message }, "File not removed"));
    }
    return { ok: true };
  }

  /** A distributor ERP invoice with three new serials: three Pending registrations, channel ERP. */
  async erpInvoice(ctx: Ctx): Promise<RegistrationView[]> {
    requireRole(ctx.user, "admin");
    const ids = await this.prisma.tx(async (tx) => {
      const invoiceNumber = `GS-${ctx.today.replace(/-/g, "").slice(2)}-${String(await nextCounter(tx, "ERPINV")).padStart(2, "0")}`;
      const customer = {
        name: "Northside Heating & Air",
        phone: "(214) 555-0133",
        email: "office@northside-hvac.example.com",
        city: "Richardson",
        state: "TX",
        zip: "75080",
      };
      const dealerId = (await tx.dealer.findUnique({ where: { id: "d-bayou" } }))?.id;
      const lines = [
        { model: "SC480", batch: this.batchFor(ctx.today, 1) },
        { model: "SM482V", batch: this.batchFor(ctx.today, 2) },
        { model: "MG44", batch: this.batchFor(ctx.today, 1) },
      ];
      const created: { id: string; serial: string; modelCode: string; batchNumber: string }[] = [];
      for (const line of lines) {
        const serial = await this.freeSerial(tx, ctx.today, line.model);
        const id = await this.registrations.submitForReview(
          tx,
          {
            serial,
            batchNumber: line.batch,
            modelCode: line.model,
            customer,
            dealerId,
            purchaseDate: ctx.today,
            invoiceNumber,
          },
          "ERP",
          { id: "system", name: "ERP sales feed" },
          ctx.now,
        );
        created.push({ id, serial, modelCode: line.model, batchNumber: line.batch });
      }
      await this.integrations.log(
        tx,
        {
          system: "ERP",
          direction: "IN",
          type: "erp_invoice",
          refId: invoiceNumber,
          payload: {
            invoiceNumber,
            invoiceDate: ctx.today,
            dealer: "Bayou Air Parts",
            customer,
            lines: created.map((r) => ({
              serial: r.serial,
              batchNumber: r.batchNumber,
              model: r.modelCode,
              registrationId: r.id,
            })),
          },
        },
        ctx.now,
      );
      await this.notifier.notify(tx, await this.notifier.adminIds(tx), "erp_invoice_received", ctx.now, {
        params: { invoice: invoiceNumber, count: created.length },
        link: "/registrations?channel=ERP",
      });
      return created.map((r) => r.id);
    });
    return Promise.all(ids.map((id) => this.registrations.get(ctx, id)));
  }

  /** A customer emails the registration mailbox with the invoice attached (the real email intake path). */
  async registrationEmail(ctx: Ctx): Promise<RegistrationView> {
    requireRole(ctx.user, "admin");
    const serial = await this.freeSerial(this.prisma, ctx.today, "SC680");
    const batch = this.batchFor(ctx.today, 3);
    const purchaseDate = addDaysIso(ctx.today, -3);
    const [y, m, d] = purchaseDate.split("-");
    const invoiceNumber = `LS-${ctx.today.slice(0, 4)}-${serial.slice(-4)}`;
    const invoice = invoicePdf([
      ["Invoice", invoiceNumber],
      ["Date", `${m}/${d}/${y}`],
      ["Sold by", "Lone Star Refrigeration Supply, Houston TX"],
      ["Item", "Fieldpiece SC680 Swivel Head Wireless Clamp Meter"],
      ["Serial", serial],
      ["Batch", batch],
    ]);
    const result = await this.intake.inboundEmail(ctx, {
      from: "Samantha Ortiz <sam.ortiz@example.com>",
      to: this.env.INBOUND_EMAIL_ADDRESS,
      subject: "Warranty registration for my new clamp meter",
      text: [
        "Hi, please register my new Fieldpiece meter. Invoice attached.",
        "Model: SC680",
        `Serial number: ${serial}`,
        `Batch: ${batch}`,
        `Purchased: ${m}/${d}/${y}`,
        "Phone: (713) 555-0186",
        "City: Pasadena",
        "State: TX",
        "ZIP: 77502",
      ].join("\n"),
      attachments: [
        {
          filename: `invoice-${invoiceNumber}.pdf`,
          contentType: "application/pdf",
          contentBase64: invoice.toString("base64"),
        },
      ],
    });
    if (!result.registrationId)
      throw AppError.conflict("invalid_transition", "The sample email couldn't be read.");
    return this.registrations.get(ctx, result.registrationId);
  }

  /** An online marketplace sends two orders through the partner API (channel RETAIL): registered at once. */
  async marketplaceOrder(ctx: Ctx): Promise<RegistrationView[]> {
    requireRole(ctx.user, "admin");
    const client = await this.prisma.partnerClient.findUnique({ where: { id: "pc-marketplace" } });
    if (!client?.active) throw AppError.notFound("Active marketplace partner");
    const serials = [await this.freeSerial(this.prisma, ctx.today, "VP87")];
    serials.push(await this.freeSerial(this.prisma, ctx.today, "SM482V", new Set(serials)));
    const { results } = await this.intake.partnerRegistrations(
      ctx,
      { id: client.id, name: client.name, channel: "RETAIL", dealerId: client.dealerId },
      {
        registrations: [
          {
            serial: serials[0],
            batchNumber: this.batchFor(ctx.today, 1),
            modelCode: "VP87",
            purchaseDate: addDaysIso(ctx.today, -1),
            orderNumber: `MKT-${serials[0]!.slice(-6)}`,
            customer: {
              name: "Tyler Brooks",
              email: "tyler.brooks@example.com",
              phone: "(303) 555-0114",
              city: "Denver",
              state: "CO",
              zip: "80205",
            },
          },
          {
            serial: serials[1],
            batchNumber: this.batchFor(ctx.today, 2),
            modelCode: "SM482V",
            purchaseDate: addDaysIso(ctx.today, -1),
            orderNumber: `MKT-${serials[1]!.slice(-6)}`,
            customer: {
              name: "Nina Patel",
              email: "nina.patel@example.com",
              phone: "(404) 555-0167",
              city: "Atlanta",
              state: "GA",
              zip: "30309",
            },
          },
        ],
      },
    );
    const ids = results.flatMap((r) => r.registrationId ?? []);
    return Promise.all(ids.map((id) => this.registrations.get(ctx, id)));
  }

  /** Job Link: a technician registers two new products for a customer from the app (partner API, channel JOBLINK). */
  joblinkRegistration(ctx: Ctx): Promise<RegistrationView[]> {
    return this.appRegistration(ctx, "pc-joblink", ["JL3KH6", "MG44"], 0, {
      name: "Owen Castillo",
      email: "owen.castillo@example.com",
      phone: "(512) 555-0158",
      city: "Austin",
      state: "TX",
      zip: "78704",
    });
  }

  /** Overwatch: one new product registered from the app (partner API, channel OVERWATCH). */
  overwatchRegistration(ctx: Ctx): Promise<RegistrationView[]> {
    return this.appRegistration(ctx, "pc-overwatch", ["SM482V"], 2, {
      name: "Grace Whitfield",
      email: "grace.whitfield@example.com",
      phone: "(615) 555-0173",
      city: "Nashville",
      state: "TN",
      zip: "37203",
    });
  }

  /** New products bought `purchasedDaysAgo` sent by a Fieldpiece app with its own partner key: registered at once. */
  private async appRegistration(
    ctx: Ctx,
    clientId: "pc-joblink" | "pc-overwatch",
    models: string[],
    purchasedDaysAgo: number,
    customer: PartnerCustomer,
  ): Promise<RegistrationView[]> {
    requireRole(ctx.user, "admin");
    const client = await this.prisma.partnerClient.findUnique({ where: { id: clientId } });
    if (!client?.active) throw AppError.notFound("Active Fieldpiece app partner");
    const serials: string[] = [];
    for (const model of models) {
      serials.push(await this.freeSerial(this.prisma, ctx.today, model, new Set(serials)));
    }
    const { results } = await this.intake.partnerRegistrations(
      ctx,
      {
        id: client.id,
        name: client.name,
        channel: client.channel as PartnerChannel,
        dealerId: client.dealerId,
      },
      {
        registrations: models.map((modelCode, i) => ({
          serial: serials[i],
          batchNumber: this.batchFor(ctx.today, i + 1),
          modelCode,
          purchaseDate: addDaysIso(ctx.today, -purchasedDaysAgo),
          customer,
        })),
      },
    );
    const ids = results.flatMap((r) => r.registrationId ?? []);
    return Promise.all(ids.map((id) => this.registrations.get(ctx, id)));
  }

  /** Batch for products built about four weeks before `today`: yyww-L + line. */
  private batchFor(today: string, line: number): string {
    const built = new Date(`${addDaysIso(today, -28)}T00:00:00Z`);
    const start = Date.UTC(built.getUTCFullYear(), 0, 1);
    const week = Math.min(52, Math.floor((built.getTime() - start) / (7 * 86_400_000)) + 1);
    return `${String(built.getUTCFullYear()).slice(2)}${String(week).padStart(2, "0")}-L${String(line).padStart(2, "0")}`;
  }

  /**
   * A MODEL-NUMBER serial nobody has used yet; the number is in the label format (the batch's yyww + a 5-digit
   * sequence) and not used under any model, so the demo never produces a MODEL_MISMATCH by accident.
   */
  private async freeSerial(
    db: Db,
    today: string,
    modelCode: string,
    taken: ReadonlySet<string> = new Set(),
  ): Promise<string> {
    const prefix = this.batchFor(today, 1).slice(0, 4);
    const where = { serial: { contains: `-${prefix}` } };
    const [units, registrations] = await Promise.all([
      db.unit.findMany({ where, select: { serial: true } }),
      db.registration.findMany({ where, select: { serial: true } }),
    ]);
    const used = new Set(
      [...taken, ...units.map((u) => u.serial), ...registrations.map((r) => r.serial)].map(serialNumberPart),
    );
    for (let n = 30001; ; n += 1) {
      const number = `${prefix}${String(n).padStart(5, "0")}`;
      if (!used.has(number)) return `${modelCode}-${number}`;
    }
  }
}

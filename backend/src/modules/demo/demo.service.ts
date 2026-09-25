import { Inject, Injectable, Logger } from "@nestjs/common";
import { addDaysIso, type RegistrationView } from "@wms/domain";
import type { Ctx } from "../../common/auth/context";
import { nextCounter } from "../../common/db/ids";
import { ENV } from "../../config/config.module";
import type { Env } from "../../config/env";
import { type Db, PrismaService } from "../../infra/prisma/prisma.service";
import { BlobStorage } from "../../infra/storage/blob-storage";
import { requireRole } from "../../domain/scope";
import { hashPassword } from "../auth";
import { FilesService } from "../files";
import { IntegrationLog } from "../integrations";
import { Notifier } from "../notifications";
import { RegistrationsService } from "../registrations";
import { DEMO_ACCOUNTS } from "./seed-data";
import { writeSeed } from "./seed-writer";

// Demo-only (DEMO_FEATURES_ENABLED): the sign-in picker's accounts and the A13 simulator, which stands in for the
// ERP feed and the registration mailbox (W6). Job results and OEM decisions go through the same services a real
// integration would call.

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);

/** The emailed invoice, drawn as an image so A03 can show it next to the data. */
function invoiceSvg(lines: [string, string][]): string {
  const rows = lines
    .map(
      ([k, v], i) =>
        `<text x="48" y="${170 + i * 44}" font-family="sans-serif" font-size="22" fill="#5e5e5c">${esc(k)}</text>` +
        `<text x="300" y="${170 + i * 44}" font-family="monospace" font-size="22" fill="#12130d">${esc(v)}</text>`,
    )
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480" viewBox="0 0 640 480">
<rect width="640" height="480" fill="#ffffff"/><rect x="0" y="0" width="640" height="96" fill="#e8e8e9"/>
<text x="48" y="60" font-family="sans-serif" font-size="32" font-weight="bold" fill="#12130d">TAX INVOICE</text>${rows}</svg>`;
}

@Injectable()
export class DemoService {
  private readonly logger = new Logger(DemoService.name);
  private passwordHash?: Promise<string>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: BlobStorage,
    private readonly files: FilesService,
    private readonly registrations: RegistrationsService,
    private readonly integrations: IntegrationLog,
    private readonly notifier: Notifier,
    @Inject(ENV) private readonly env: Env,
  ) {}

  accounts() {
    return DEMO_ACCOUNTS.map((a) => ({ ...a, password: this.env.DEMO_PASSWORD }));
  }

  /** Replaces all data with the seed, dated from today. Signed-in seeded users stay signed in. */
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
      await this.storage.delete(key).catch((err: Error) => this.logger.warn({ key, err: err.message }, "File not removed"));
    }
    return { ok: true };
  }

  /** One ERP sales invoice with three new serials: three Pending registrations, channel ERP. */
  async erpInvoice(ctx: Ctx): Promise<RegistrationView[]> {
    requireRole(ctx.user, "admin");
    const ids = await this.prisma.tx(async (tx) => {
      const invoiceNumber = `BP-INV-${ctx.today.replace(/-/g, "")}-${String(await nextCounter(tx, "ERPINV")).padStart(2, "0")}`;
      const customer = { name: "Sunrise Dental Clinic", phone: "+91 90000 00301", email: "accounts@sunrise-dental.example", city: "Pune" };
      const dealerId = (await tx.dealer.findUnique({ where: { id: "d-breeze" } }))?.id;
      const created: { id: string; serial: string; modelCode: string }[] = [];
      for (const modelCode of ["AER-SPL15", "AER-SPL18", "AER-SPL18"]) {
        const serial = await this.freeSerial(tx, modelCode, ctx.today);
        const id = await this.registrations.insert(
          tx,
          { serial, modelCode, customer, dealerId, purchaseDate: ctx.today, invoiceNumber, location: "Aundh, Pune: clinic" },
          "ERP",
          { id: ctx.user.id, name: "ERP sales feed" },
          ctx.now,
        );
        created.push({ id, serial, modelCode });
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
            dealer: "Breeze Point",
            customer,
            lines: created.map((r) => ({ serial: r.serial, modelCode: r.modelCode, registrationId: r.id })),
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

  /** A customer emails the registration mailbox with the invoice attached: one Pending registration, channel EMAIL. */
  async registrationEmail(ctx: Ctx): Promise<RegistrationView> {
    requireRole(ctx.user, "admin");
    const id = await this.prisma.tx(async (tx) => {
      const serial = await this.freeSerial(tx, "POL-SPL12", ctx.today);
      const purchaseDate = addDaysIso(ctx.today, -3);
      const [seq] = await tx.$queryRaw<{ last_value: bigint }[]>`SELECT last_value FROM id_seq_reg`;
      const invoiceNumber = `CA/${ctx.today.slice(0, 4)}/${String(900 + Number(seq?.last_value ?? 0)).padStart(4, "0")}`;
      const from = "m.iyer@example.com";
      const fileName = `invoice-${invoiceNumber.replace(/\//g, "-")}.svg`;
      const invoice = await this.files.store(
        tx,
        {
          name: fileName,
          mime: "image/svg+xml",
          uploadedBy: ctx.user.id,
          buffer: Buffer.from(
            invoiceSvg([
              ["Invoice", invoiceNumber],
              ["Date", purchaseDate],
              ["Sold by", "CoolAir Traders, Pune"],
              ["Customer", "M. Iyer"],
              ["Model", "POL-SPL12"],
              ["Serial", serial],
            ]),
          ),
        },
        ctx.now,
      );
      const dealerId = (await tx.dealer.findUnique({ where: { id: "d-coolair" } }))?.id;
      const regId = await this.registrations.insert(
        tx,
        {
          serial,
          modelCode: "POL-SPL12",
          customer: { name: "M. Iyer", phone: "+91 90000 00302", email: from, city: "Pune" },
          dealerId,
          purchaseDate,
          invoiceNumber,
          location: "Wakad, Pune",
          attachmentIds: [invoice.id],
        },
        "EMAIL",
        { id: ctx.user.id, name: `Email from ${from}` },
        ctx.now,
      );
      await this.integrations.log(
        tx,
        {
          system: "EMAIL",
          direction: "IN",
          type: "registration_email",
          refId: regId,
          payload: {
            from,
            to: "register@warranty.example",
            subject: `Warranty registration ${serial}`,
            attachments: [fileName],
            read: { serial, modelCode: "POL-SPL12", purchaseDate, invoiceNumber },
          },
        },
        ctx.now,
      );
      await this.notifier.notify(tx, await this.notifier.adminIds(tx), "registration_email_received", ctx.now, {
        params: { serial },
        link: `/registrations/${regId}`,
      });
      return regId;
    });
    return this.registrations.get(ctx, id);
  }

  /** A serial nobody has used yet, in the seed's "<model>-<yymm><nn>" style. */
  private async freeSerial(db: Db, modelCode: string, today: string): Promise<string> {
    const prefix = `${modelCode}-${today.slice(2, 7).replace("-", "")}`;
    const [units, registrations] = await Promise.all([
      db.unit.findMany({ where: { serial: { startsWith: prefix } }, select: { serial: true } }),
      db.registration.findMany({ where: { serial: { startsWith: prefix } }, select: { serial: true } }),
    ]);
    const taken = new Set([...units, ...registrations].map((r) => r.serial));
    for (let n = 1; ; n += 1) {
      const serial = `${prefix}${String(n).padStart(2, "0")}`;
      if (!taken.has(serial)) return serial;
    }
  }
}

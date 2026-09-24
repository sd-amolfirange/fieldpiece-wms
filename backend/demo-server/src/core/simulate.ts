import { addDaysIso, type Registration, type RegistrationView } from "@wms/domain";
import { logMessage } from "./complaints";
import { getRegistration, notify, requireRole, type Ctx } from "./services";
import { nextId, type DemoState } from "./state";

// A13 stand-ins for the systems that send registrations in (W6). Mock API: minimal rules.
// - ERP sales invoice: one invoice, three serials, three Pending registrations with channel ERP.
// - Registration email: one Pending registration with channel EMAIL and the invoice attached.
// Both are logged in the integration log and wait in the A02 inbox for the same review as any other channel.

const adminIds = (state: DemoState) => state.users.filter((u) => u.role === "admin").map((u) => u.id);

/** A serial nobody has used yet, in the seed's "<model>-<yymm><nn>" style. */
function freeSerial(ctx: Ctx, modelCode: string): string {
  const taken = new Set([...ctx.state.units.map((u) => u.serial), ...ctx.state.registrations.map((r) => r.serial)]);
  const yymm = ctx.today.slice(2, 7).replace("-", "");
  for (let n = 1; ; n += 1) {
    const serial = `${modelCode}-${yymm}${String(n).padStart(2, "0")}`;
    if (!taken.has(serial)) return serial;
  }
}

function pending(ctx: Ctx, fields: Omit<Registration, "id" | "status" | "flags" | "submittedBy" | "submittedAt">) {
  const reg: Registration = {
    id: nextId(ctx.state, "REG"),
    status: "PENDING",
    flags: [],
    submittedBy: ctx.user.id,
    submittedAt: ctx.now,
    ...fields,
  };
  ctx.state.registrations.push(reg);
  return reg;
}

export function simulateErpInvoice(ctx: Ctx): RegistrationView[] {
  requireRole(ctx, "admin");
  const invoiceNumber = `BP-INV-${ctx.today.replace(/-/g, "")}-${String((ctx.state.counters.ERPINV ?? 0) + 1).padStart(2, "0")}`;
  ctx.state.counters.ERPINV = (ctx.state.counters.ERPINV ?? 0) + 1;
  const customer = {
    name: "Sunrise Dental Clinic",
    phone: "+91 90000 00301",
    email: "accounts@sunrise-dental.example",
    city: "Pune",
  };
  // One registration per invoice line; each is saved before the next serial is picked, so serials never repeat.
  const regs: Registration[] = [];
  for (const modelCode of ["AER-SPL15", "AER-SPL18", "AER-SPL18"]) {
    regs.push(
      pending(ctx, {
        channel: "ERP",
        serial: freeSerial(ctx, modelCode),
        modelCode,
        customer,
        dealerId: "d-breeze",
        purchaseDate: ctx.today,
        invoiceNumber,
        location: "Aundh, Pune: clinic",
        attachmentIds: [],
        submittedByName: "ERP sales feed",
      }),
    );
  }
  logMessage(ctx, {
    system: "ERP",
    direction: "IN",
    type: "erp_invoice",
    refId: invoiceNumber,
    payload: {
      invoiceNumber,
      invoiceDate: ctx.today,
      dealer: "Breeze Point",
      customer,
      lines: regs.map((r) => ({ serial: r.serial, modelCode: r.modelCode, registrationId: r.id })),
    },
  });
  notify(ctx.state, adminIds(ctx.state), "erp_invoice_received", ctx.now, {
    params: { invoice: invoiceNumber, count: regs.length },
    link: "/registrations?channel=ERP",
  });
  return regs.map((r) => getRegistration(ctx, r.id));
}

/** The emailed invoice, drawn as an image so A03 can show it next to the data. */
export function invoiceSvg(lines: [string, string][]): string {
  const esc = (s: string) =>
    s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);
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

/**
 * A customer emails the registration mailbox with the invoice attached. `store` saves the invoice file and returns
 * its attachment id (the Express server writes it to disk; the test adapter keeps it in memory).
 */
export function simulateRegistrationEmail(
  ctx: Ctx,
  store: (file: { name: string; mime: string; content: string }) => string,
): RegistrationView {
  requireRole(ctx, "admin");
  const serial = freeSerial(ctx, "POL-SPL12");
  const purchaseDate = addDaysIso(ctx.today, -3);
  const invoiceNumber = `CA/${ctx.today.slice(0, 4)}/${String(900 + (ctx.state.counters.REG ?? 0)).padStart(4, "0")}`;
  const from = "m.iyer@example.com";
  const attachmentId = store({
    name: `invoice-${invoiceNumber.replace(/\//g, "-")}.svg`,
    mime: "image/svg+xml",
    content: invoiceSvg([
      ["Invoice", invoiceNumber],
      ["Date", purchaseDate],
      ["Sold by", "CoolAir Traders, Pune"],
      ["Customer", "M. Iyer"],
      ["Model", "POL-SPL12"],
      ["Serial", serial],
    ]),
  });
  const reg = pending(ctx, {
    channel: "EMAIL",
    serial,
    modelCode: "POL-SPL12",
    customer: { name: "M. Iyer", phone: "+91 90000 00302", email: from, city: "Pune" },
    dealerId: "d-coolair",
    purchaseDate,
    invoiceNumber,
    location: "Wakad, Pune",
    attachmentIds: [attachmentId],
    submittedByName: `Email from ${from}`,
  });
  logMessage(ctx, {
    system: "EMAIL",
    direction: "IN",
    type: "registration_email",
    refId: reg.id,
    payload: {
      from,
      to: "register@warranty.example",
      subject: `Warranty registration ${serial}`,
      attachments: [`invoice-${invoiceNumber}.svg`],
      read: { serial, modelCode: "POL-SPL12", purchaseDate, invoiceNumber },
    },
  });
  notify(ctx.state, adminIds(ctx.state), "registration_email_received", ctx.now, {
    params: { serial },
    link: `/registrations/${reg.id}`,
  });
  return getRegistration(ctx, reg.id);
}

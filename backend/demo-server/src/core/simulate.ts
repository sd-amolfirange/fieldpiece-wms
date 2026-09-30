import { addDaysIso, type IsoDate, type RegistrationView, serialNumberPart } from "@wms/domain";
import { conflict, notFound } from "./errors";
import { inboundEmail, INBOUND_EMAIL_ADDRESS, partnerRegistrations } from "./intake";
import { simplePdf } from "./pdf";
import { getRegistration, submitForReview } from "./registrations";
import { adminIds, logMessage, notify, requireRole, type Ctx } from "./services";
import { nextCounter, type DemoState } from "./state";

// The System events page (A13), as backend/src/modules/demo/demo.service.ts: the messages the connected systems would
// send. The email and the marketplace order go through the same intake code as the real webhook and partner API.
// - ERP sales invoice: one invoice, three new serials, three Pending registrations with channel ERP.
// - Registration email: one Pending registration with channel EMAIL and the invoice (a PDF) attached.
// - Marketplace order: two orders through the partner API (channel RETAIL), registered at once.
// - Job Link / Overwatch: Fieldpiece's apps register new products through the partner API with their own keys
//   (channels JOBLINK and OVERWATCH), registered at once.

/** Batch for products built about four weeks before `today`: yyww-L + line. */
function batchFor(today: IsoDate, line: number): string {
  const built = new Date(`${addDaysIso(today, -28)}T00:00:00Z`);
  const start = Date.UTC(built.getUTCFullYear(), 0, 1);
  const week = Math.min(52, Math.floor((built.getTime() - start) / (7 * 86_400_000)) + 1);
  return `${String(built.getUTCFullYear()).slice(2)}${String(week).padStart(2, "0")}-L${String(line).padStart(2, "0")}`;
}

/**
 * A MODEL-NUMBER serial nobody has used yet; the number is in the label format (the batch's yyww + a 5-digit
 * sequence) and not used under any model, so the demo never produces a MODEL_MISMATCH by accident.
 */
function freeSerial(
  state: DemoState,
  today: IsoDate,
  modelCode: string,
  taken: ReadonlySet<string> = new Set(),
): string {
  const used = new Set(
    [...taken, ...state.units.map((u) => u.serial), ...state.registrations.map((r) => r.serial)].map(
      serialNumberPart,
    ),
  );
  const prefix = batchFor(today, 1).slice(0, 4);
  for (let n = 30001; ; n += 1) {
    const number = `${prefix}${String(n).padStart(5, "0")}`;
    if (!used.has(number)) return `${modelCode}-${number}`;
  }
}

/** A distributor ERP invoice with three new serials: three Pending registrations, channel ERP. */
export function simulateErpInvoice(ctx: Ctx): RegistrationView[] {
  requireRole(ctx, "admin");
  const { state, today } = ctx;
  const invoiceNumber = `GS-${today.replace(/-/g, "").slice(2)}-${String(nextCounter(state, "ERPINV")).padStart(2, "0")}`;
  const customer = {
    name: "Northside Heating & Air",
    phone: "(214) 555-0133",
    email: "office@northside-hvac.example.com",
    city: "Richardson",
    state: "TX",
    zip: "75080",
  };
  const dealerId = state.dealers.find((d) => d.id === "d-bayou")?.id;
  const lines = [
    { model: "SC480", batch: batchFor(today, 1) },
    { model: "SM482V", batch: batchFor(today, 2) },
    { model: "MG44", batch: batchFor(today, 1) },
  ];
  // One registration per invoice line; each is saved before the next serial is picked, so serials never repeat.
  const created = lines.map((line) => {
    const serial = freeSerial(state, today, line.model);
    const id = submitForReview(
      ctx,
      {
        serial,
        batchNumber: line.batch,
        modelCode: line.model,
        customer,
        dealerId,
        purchaseDate: today,
        invoiceNumber,
      },
      "ERP",
      { id: "system", name: "ERP sales feed" },
    );
    return { id, serial, modelCode: line.model, batchNumber: line.batch };
  });
  logMessage(ctx, {
    system: "ERP",
    direction: "IN",
    type: "erp_invoice",
    refId: invoiceNumber,
    payload: {
      invoiceNumber,
      invoiceDate: today,
      dealer: "Bayou Air Parts",
      customer,
      lines: created.map((r) => ({
        serial: r.serial,
        batchNumber: r.batchNumber,
        model: r.modelCode,
        registrationId: r.id,
      })),
    },
  });
  notify(state, adminIds(state), "erp_invoice_received", ctx.now, {
    params: { invoice: invoiceNumber, count: created.length },
    link: "/registrations?channel=ERP",
  });
  return created.map((r) => getRegistration(ctx, r.id));
}

/** A customer emails the registration mailbox with the invoice attached (the real email intake path). */
export function simulateRegistrationEmail(ctx: Ctx): RegistrationView {
  requireRole(ctx, "admin");
  const { today } = ctx;
  const serial = freeSerial(ctx.state, today, "SC680");
  const batch = batchFor(today, 3);
  const [y, m, d] = addDaysIso(today, -3).split("-");
  const invoiceNumber = `LS-${today.slice(0, 4)}-${serial.slice(-4)}`;
  const invoice = simplePdf("INVOICE", [
    ["Invoice", invoiceNumber],
    ["Date", `${m}/${d}/${y}`],
    ["Sold by", "Lone Star Refrigeration Supply, Houston TX"],
    ["Item", "Fieldpiece SC680 Swivel Head Wireless Clamp Meter"],
    ["Serial", serial],
    ["Batch", batch],
  ]);
  const result = inboundEmail(ctx, {
    from: "Samantha Ortiz <sam.ortiz@example.com>",
    to: INBOUND_EMAIL_ADDRESS,
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
        contentBase64: btoa(invoice),
      },
    ],
  });
  if (!result.registrationId) throw conflict("invalid_transition", "The sample email couldn't be read.");
  return getRegistration(ctx, result.registrationId);
}

/** An online marketplace sends two orders through the partner API (channel RETAIL): registered at once. */
export function simulateMarketplaceOrder(ctx: Ctx): RegistrationView[] {
  requireRole(ctx, "admin");
  const { state, today } = ctx;
  const client = state.partnerClients.find((p) => p.id === "pc-marketplace");
  if (!client?.active) throw notFound("Active marketplace partner");
  const first = freeSerial(state, today, "VP87");
  const second = freeSerial(state, today, "SM482V", new Set([first]));
  const order = (serial: string, line: number, modelCode: string, customer: Record<string, string>) => ({
    serial,
    batchNumber: batchFor(today, line),
    modelCode,
    purchaseDate: addDaysIso(today, -1),
    orderNumber: `MKT-${serial.slice(-6)}`,
    customer,
  });
  const { results } = partnerRegistrations(
    ctx,
    { ...client, channel: "RETAIL" },
    {
      registrations: [
        order(first, 1, "VP87", {
          name: "Tyler Brooks",
          email: "tyler.brooks@example.com",
          phone: "(303) 555-0114",
          city: "Denver",
          state: "CO",
          zip: "80205",
        }),
        order(second, 2, "SM482V", {
          name: "Nina Patel",
          email: "nina.patel@example.com",
          phone: "(404) 555-0167",
          city: "Atlanta",
          state: "GA",
          zip: "30309",
        }),
      ],
    },
  );
  return results.flatMap((r) => (r.registrationId ? [getRegistration(ctx, r.registrationId)] : []));
}

/** New products bought `purchasedDaysAgo` sent by a Fieldpiece app with its own partner key: registered at once. */
function appRegistration(
  ctx: Ctx,
  clientId: "pc-joblink" | "pc-overwatch",
  models: string[],
  purchasedDaysAgo: number,
  customer: Record<string, string>,
): RegistrationView[] {
  requireRole(ctx, "admin");
  const { state, today } = ctx;
  const client = state.partnerClients.find((p) => p.id === clientId);
  if (!client?.active) throw notFound("Active Fieldpiece app partner");
  const serials: string[] = [];
  for (const model of models) serials.push(freeSerial(state, today, model, new Set(serials)));
  const { results } = partnerRegistrations(ctx, client, {
    registrations: models.map((modelCode, i) => ({
      serial: serials[i],
      batchNumber: batchFor(today, i + 1),
      modelCode,
      purchaseDate: addDaysIso(today, -purchasedDaysAgo),
      customer,
    })),
  });
  return results.flatMap((r) => (r.registrationId ? [getRegistration(ctx, r.registrationId)] : []));
}

/** Job Link: a technician registers two new products for a customer from the app (partner API, channel JOBLINK). */
export function simulateJoblinkRegistration(ctx: Ctx): RegistrationView[] {
  return appRegistration(ctx, "pc-joblink", ["JL3KH6", "MG44"], 0, {
    name: "Owen Castillo",
    email: "owen.castillo@example.com",
    phone: "(512) 555-0158",
    city: "Austin",
    state: "TX",
    zip: "78704",
  });
}

/** Overwatch: one new product registered from the app (partner API, channel OVERWATCH). */
export function simulateOverwatchRegistration(ctx: Ctx): RegistrationView[] {
  return appRegistration(ctx, "pc-overwatch", ["SM482V"], 2, {
    name: "Grace Whitfield",
    email: "grace.whitfield@example.com",
    phone: "(615) 555-0173",
    city: "Nashville",
    state: "TN",
    zip: "37203",
  });
}

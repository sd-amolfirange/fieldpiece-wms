import {
  normalizeSerialValue,
  type IntakeInfo,
  type PartnerClientView,
  type RegistrationRowInput,
  type RowErrors,
} from "@wms/domain";
import { notFound, ServiceError, throwIfErrors, unauthenticated, validation } from "./errors";
import { registerTrusted, selfServiceErrors, submitForReview } from "./registrations";
import {
  checkFile,
  dealerName,
  logMessage,
  requireRole,
  storeFile,
  transaction,
  type Ctx,
  type DemoFile,
  type SystemCtx,
} from "./services";
import type { PartnerClientRecord } from "./state";

// Registration entry points besides the signed-in screens, as backend/src/modules/intake:
// - the public registration form (WEB): no account; always reviewed by the warranty desk;
// - the partner API (API / RETAIL / ERP): partner systems send registrations with an X-Api-Key; clean ones are
//   registered at once;
// - email intake (EMAIL): the mail provider forwards emailed invoices; reviewed by the warranty desk.
// Every one goes through registrations.ts, so the rules are the same as for the dealer and customer screens.

/** Mailbox that turns emailed invoices into registrations (the backend's INBOUND_EMAIL_ADDRESS default). */
export const INBOUND_EMAIL_ADDRESS = "registrations@wms.local";

export const intakeInfo = (ctx: Ctx): IntakeInfo => {
  requireRole(ctx, "admin", "dealer", "distributor");
  return {
    publicFormPath: "/register-product",
    inboundEmail: INBOUND_EMAIL_ADDRESS,
    partnerApiPath: "/api/partner/v1",
  };
};

const str = (value: unknown, max = 200) =>
  typeof value === "string"
    ? value.trim().slice(0, max)
    : typeof value === "number"
      ? String(value)
      : undefined;

// ---- public registration form (WEB) --------------------------------------------------------------

export const PUBLIC_FIELDS = [
  "serial",
  "batchNumber",
  "modelCode",
  "purchaseDate",
  "placeOfPurchase",
  "invoiceNumber",
  "customerName",
  "customerEmail",
  "customerPhone",
  "city",
  "state",
  "zip",
  "website",
] as const;

export type PublicRegistrationFields = Partial<Record<(typeof PUBLIC_FIELDS)[number], string>>;

/** The form's text fields (multipart fields or JSON), each cut to 200 characters. */
export function publicFields(body: unknown): PublicRegistrationFields {
  const source = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const fields: PublicRegistrationFields = {};
  for (const key of PUBLIC_FIELDS) {
    const value = source[key];
    if (typeof value === "string") fields[key] = value.slice(0, 200);
  }
  return fields;
}

/** A registration from the public form, with `file` as the proof of purchase. Returns only what the confirmation shows. */
export function publicRegistration(
  ctx: SystemCtx,
  fields: PublicRegistrationFields,
  proof: DemoFile | undefined,
): { registrationId: string; status: "PENDING" } {
  // A filled-in honeypot is a bot: answer like a success, store nothing.
  if (fields.website) return { registrationId: "REG-0", status: "PENDING" };

  const errors = selfServiceErrors(
    ctx.state,
    ctx.today,
    { ...fields, attachmentIds: proof ? ["proof"] : [] },
    { proofRequired: true },
  );
  const name = fields.customerName?.trim() ?? "";
  const email = fields.customerEmail?.trim().toLowerCase() ?? "";
  if (!name) errors.customerName = "validation.required";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.customerEmail = "validation.email";
  throwIfErrors(errors);
  const attachment = storeFile(ctx, checkFile(proof), "public");

  const registrationId = submitForReview(
    ctx,
    {
      serial: normalizeSerialValue(fields.serial),
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
  );
  return { registrationId, status: "PENDING" };
}

// ---- partner API (API / RETAIL / ERP) ------------------------------------------------------------

export interface PartnerItemResult {
  index: number;
  serial: string;
  status: "REGISTERED" | "REVIEW" | "ERROR";
  registrationId?: string;
  errors?: RowErrors;
}

const MAX_PARTNER_ITEMS = 500;
const PARTNER_CHANNELS: readonly PartnerClientRecord["channel"][] = ["API", "RETAIL", "ERP"];

const invalidKey = () =>
  new ServiceError(401, "invalid_api_key", "The API key is missing, wrong or no longer active.");

/** The partner behind an X-Api-Key header, or 401. Records when the key was last used. */
export function authenticatePartner(ctx: SystemCtx, key: string | undefined): PartnerClientRecord {
  if (!key || !key.startsWith("fpk_") || key.length > 200) throw invalidKey();
  const client = ctx.state.partnerClients.find((p) => p.apiKey === key);
  if (!client || !client.active) throw invalidKey();
  client.lastUsedAt = ctx.now;
  return client;
}

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

/** One registration, or `{ registrations: [...] }` (up to 500); each item gets its own result. */
export function partnerRegistrations(
  ctx: SystemCtx,
  client: PartnerClientRecord,
  body: unknown,
): { results: PartnerItemResult[] } {
  const source = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const items: unknown[] = Array.isArray(source.registrations) ? source.registrations : [source];
  if (!items.length) throw validation("Send at least one registration.");
  if (items.length > MAX_PARTNER_ITEMS)
    throw validation(`Send at most ${MAX_PARTNER_ITEMS} registrations per request.`);
  const by = { id: `partner:${client.id}`, name: client.name };
  const seen = new Set<string>();
  const results: PartnerItemResult[] = [];
  items.forEach((raw, index) => {
    const row = partnerRow((raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>);
    const result = transaction(ctx.state, () =>
      registerTrusted(ctx, row, client.channel, by, {
        dealerId: client.dealerId,
        placeOfPurchase: row.placeOfPurchase ?? (client.channel === "RETAIL" ? client.name : undefined),
        seenInFile: seen,
        reviewer: `Auto-approved (${client.name})`,
      }),
    );
    const serial = normalizeSerialValue(row.serial);
    if (result.status !== "ERROR") seen.add(serial);
    results.push(
      result.status === "ERROR"
        ? { index, serial, status: "ERROR", errors: result.errors }
        : { index, serial, status: result.status, registrationId: result.registrationId },
    );
  });
  logMessage(ctx, {
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
  });
  return { results };
}

// ---- partner keys (admin) ------------------------------------------------------------------------

const toPartnerView = (ctx: Ctx, p: PartnerClientRecord): PartnerClientView => ({
  id: p.id,
  name: p.name,
  channel: p.channel,
  dealerId: p.dealerId,
  dealerName: dealerName(ctx.state, p.dealerId),
  keyPrefix: p.keyPrefix,
  active: p.active,
  lastUsedAt: p.lastUsedAt,
});

export function listPartnerClients(ctx: Ctx): PartnerClientView[] {
  requireRole(ctx, "admin");
  return ctx.state.partnerClients.map((p) => toPartnerView(ctx, p));
}

const randomChars = (bytes: number) => {
  const values = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...values))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
};

/** Adds a partner system and returns its API key, which is never shown again. */
export function createPartnerClient(
  ctx: Ctx,
  body: { name?: unknown; channel?: unknown; dealerId?: unknown },
): { client: PartnerClientView; apiKey: string } {
  requireRole(ctx, "admin");
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 120) : "";
  const channel = body.channel as PartnerClientRecord["channel"];
  const dealerId = typeof body.dealerId === "string" && body.dealerId ? body.dealerId : undefined;
  const errors: Record<string, string> = {};
  if (!name) errors.name = "validation.required";
  if (!PARTNER_CHANNELS.includes(channel)) errors.channel = "validation.channel";
  if (dealerId && !ctx.state.dealers.some((d) => d.id === dealerId))
    errors.dealerId = "validation.pickDealer";
  throwIfErrors(errors);
  // "fpk_" + 40 random characters, like the backend's keys.
  const apiKey = `fpk_${randomChars(30)}`;
  const id = `pc-${Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => b.toString(16).padStart(2, "0")).join("")}`;
  const client: PartnerClientRecord = {
    id,
    name,
    channel,
    dealerId,
    apiKey,
    keyPrefix: apiKey.slice(0, 12),
    active: true,
    createdAt: ctx.now,
  };
  ctx.state.partnerClients.push(client);
  return { client: toPartnerView(ctx, client), apiKey };
}

/** Turns a partner's key on or off. */
export function setPartnerActive(ctx: Ctx, id: string, active: boolean): PartnerClientView {
  requireRole(ctx, "admin");
  const client = ctx.state.partnerClients.find((p) => p.id === id);
  if (!client) throw notFound("Partner");
  client.active = active;
  return toPartnerView(ctx, client);
}

// ---- email intake (EMAIL) ------------------------------------------------------------------------

const MAX_EMAIL_ATTACHMENTS = 5;

const EMAIL_FIELDS: [keyof RegistrationRowInput, RegExp][] = [
  ["serial", /^(?:serial(?:\s*(?:number|no\.?|#))?|s\/n|sn)\s*[:#-]?\s*(\S+)/i],
  ["batchNumber", /^(?:batch(?:\s*(?:number|no\.?|#))?|lot(?:\s*(?:number|no\.?|#))?)\s*[:#-]?\s*(\S+)/i],
  ["modelCode", /^(?:model(?:\s*(?:number|no\.?|#))?|product)\s*[:#-]?\s*([A-Z0-9-]+)/i],
  ["purchaseDate", /^(?:purchase(?:d| date)?|date of purchase|purchase-date)\s*[:#-]?\s*([0-9/.-]+)/i],
  ["customerName", /^(?:name|customer(?:\s*name)?)\s*[:#-]\s*(.+)$/i],
  ["customerPhone", /^(?:phone|tel|telephone|mobile)\s*[:#-]?\s*(.+)$/i],
  ["city", /^city\s*[:#-]\s*(.+)$/i],
  ["state", /^state\s*[:#-]\s*([A-Za-z]{2})\b/i],
  ["zip", /^(?:zip|zip code|postal code)\s*[:#-]?\s*(\d{5}(?:-\d{4})?)/i],
  ["invoiceNumber", /^(?:invoice|invoice number|order|order number)\s*[:#-]?\s*(\S+)/i],
];

/** US dates (MM/DD/YYYY) and ISO dates as yyyy-MM-dd; anything else is left as written for the validation to flag. */
function normalizeDate(value: string): string {
  const us = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(value);
  if (us) return `${us[3]}-${(us[1] ?? "").padStart(2, "0")}-${(us[2] ?? "").padStart(2, "0")}`;
  return value;
}

/** "Jane Doe <jane@x.com>" -> { name: "Jane Doe", email: "jane@x.com" }. */
function parseSender(from: string): { name?: string; email?: string } {
  const match = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(from);
  if (match) return { name: match[1]?.trim() || undefined, email: match[2]?.trim().toLowerCase() };
  const email = from.trim().toLowerCase();
  return /@/.test(email) ? { email } : {};
}

/** Reads a registration out of an emailed invoice or message ("Serial: 241807532", "Model: SC680", ...). */
export function parseRegistrationEmail(email: {
  from: string;
  subject?: string;
  text?: string;
}): RegistrationRowInput {
  const row: RegistrationRowInput = {};
  const lines = [email.subject ?? "", ...(email.text ?? "").split(/\r?\n/)].map((l) =>
    l.trim().replace(/^[-*•]\s*/, ""),
  );
  for (const line of lines) {
    for (const [field, pattern] of EMAIL_FIELDS) {
      if (row[field]) continue;
      const value = pattern.exec(line)?.[1]?.trim();
      if (value) row[field] = field === "purchaseDate" ? normalizeDate(value) : value.slice(0, 200);
    }
  }
  const sender = parseSender(email.from);
  row.customerEmail = sender.email;
  row.customerName ??= sender.name ?? sender.email?.split("@")[0];
  return row;
}

/** Checks the webhook's shared secret; email intake is off (404) when none is configured. */
export function assertInboundSecret(expected: string | undefined, secret: string | undefined) {
  if (!expected) throw notFound("Route");
  if (secret !== expected) throw unauthenticated("Wrong or missing inbound secret.");
}

const base64Bytes = (value: string): Uint8Array => {
  try {
    return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
  } catch {
    return new Uint8Array();
  }
};

export interface InboundEmail {
  from?: unknown;
  to?: unknown;
  subject?: unknown;
  text?: unknown;
  /** [{ filename, contentType, contentBase64 }] */
  attachments?: unknown;
}

/**
 * An emailed invoice or message: the registration is read from the text, the attachments kept as proof of purchase,
 * and the result waits in the inbox. Emails without a serial are logged as failed for the desk to follow up.
 */
export function inboundEmail(
  ctx: SystemCtx,
  email: InboundEmail,
): { status: "RECEIVED" | "IGNORED"; registrationId?: string } {
  const from = str(email.from, 300) ?? "";
  const subject = str(email.subject, 300);
  const row = parseRegistrationEmail({ from, subject, text: str(email.text, 20_000) });
  const serial = normalizeSerialValue(row.serial);
  const logPayload = { from, to: str(email.to, 300), subject, read: row };

  if (!serial) {
    logMessage(ctx, {
      system: "EMAIL",
      direction: "IN",
      type: "registration_email",
      status: "FAILED",
      lastError: "No serial number found in the email.",
      payload: logPayload,
    });
    return { status: "IGNORED" };
  }
  const attachments = (Array.isArray(email.attachments) ? email.attachments : []).slice(
    0,
    MAX_EMAIL_ATTACHMENTS,
  );
  const attachmentIds: string[] = [];
  for (const raw of attachments) {
    const a = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const data = base64Bytes(typeof a.contentBase64 === "string" ? a.contentBase64 : "");
    try {
      const file = checkFile({
        name: str(a.filename, 255) ?? "attachment",
        mime: str(a.contentType, 100) ?? "application/octet-stream",
        size: data.length,
        data,
      });
      attachmentIds.push(storeFile(ctx, file, "system").id);
    } catch (e) {
      // Signatures and logos come along with invoices; skip what isn't a photo or PDF.
      if (!(e instanceof ServiceError)) throw e;
    }
  }
  const registrationId = submitForReview(
    ctx,
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
  );
  logMessage(ctx, {
    system: "EMAIL",
    direction: "IN",
    type: "registration_email",
    refId: registrationId,
    payload: { ...logPayload, attachments: attachmentIds.length },
  });
  return { status: "RECEIVED", registrationId };
}

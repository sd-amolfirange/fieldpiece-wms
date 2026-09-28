import type { RegistrationRowInput } from "@wms/domain";

// Reads a registration out of an emailed invoice or a customer's message ("Serial: 241807532", "Model: SC680",
// "Purchased: 09/01/2026", ...). Pure. Anything it can't read stays empty, and the warranty desk completes it in the
// registration inbox.

const FIELDS: [keyof RegistrationRowInput, RegExp][] = [
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
export function normalizeDate(value: string): string {
  const us = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(value);
  if (us) return `${us[3]}-${us[1]!.padStart(2, "0")}-${us[2]!.padStart(2, "0")}`;
  return value;
}

/** "Jane Doe <jane@x.com>" -> { name: "Jane Doe", email: "jane@x.com" }. */
export function parseSender(from: string): { name?: string; email?: string } {
  const match = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(from);
  if (match) return { name: match[1]?.trim() || undefined, email: match[2]?.trim().toLowerCase() };
  const email = from.trim().toLowerCase();
  return /@/.test(email) ? { email } : {};
}

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
    for (const [field, pattern] of FIELDS) {
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

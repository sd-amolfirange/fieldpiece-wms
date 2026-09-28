import {
  normalizeBatchValue,
  normalizeSerialValue,
  type RegistrationCustomer,
  type RegistrationRowInput,
  type RowErrors,
} from "@wms/domain";

// Pure helpers for registration input. The row rules themselves live in shared/wms-domain (registration-rules.ts),
// shared with the frontend.

export interface CreateRegistrationBody extends RegistrationRowInput {
  placeOfPurchase?: string;
  dealerId?: string;
  attachmentIds?: string[];
}

const ROW_FIELDS = [
  "serial",
  "batchNumber",
  "modelCode",
  "purchaseDate",
  "customerName",
  "customerPhone",
  "customerEmail",
  "city",
  "state",
  "zip",
  "invoiceNumber",
] as const satisfies readonly (keyof RegistrationRowInput)[];

const text = (value: unknown, max = 200): string | undefined =>
  typeof value === "string" ? value.slice(0, max) : typeof value === "number" ? String(value) : undefined;

/** Keeps only the known row fields, as strings. Anything else in the body is ignored. */
export function rowInput(body: unknown): RegistrationRowInput {
  const source = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const row: RegistrationRowInput = {};
  for (const field of ROW_FIELDS) {
    const value = text(source[field]);
    if (value !== undefined) row[field] = value;
  }
  return row;
}

export const idList = (value: unknown, max = 20): string[] | undefined =>
  Array.isArray(value) ? value.filter((id): id is string => typeof id === "string").slice(0, max) : undefined;

export function createBody(body: unknown): CreateRegistrationBody {
  const source = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  return {
    ...rowInput(source),
    placeOfPurchase: text(source.placeOfPurchase, 200),
    dealerId: text(source.dealerId, 100),
    attachmentIds: idList(source.attachmentIds),
  };
}

/** A row's values as registration fields (serial and batch normalised, blanks dropped). */
export const rowToFields = (values: RegistrationRowInput) => ({
  serial: normalizeSerialValue(values.serial),
  batchNumber: normalizeBatchValue(values.batchNumber) || undefined,
  modelCode: (values.modelCode ?? "").trim().toUpperCase(),
  customer: {
    name: (values.customerName ?? "").trim(),
    phone: values.customerPhone?.trim() || undefined,
    email: values.customerEmail?.trim() || undefined,
    city: values.city?.trim() || undefined,
    state: values.state?.trim().toUpperCase() || undefined,
    zip: values.zip?.trim() || undefined,
  } satisfies RegistrationCustomer,
  purchaseDate: values.purchaseDate?.trim() || undefined,
  invoiceNumber: values.invoiceNumber?.trim() || undefined,
});

/** Row errors as form field errors: i18n keys under `rowErrors.`. */
export const rowFieldErrors = (errors: RowErrors): Record<string, string> =>
  Object.fromEntries(Object.entries(errors).map(([field, code]) => [field, `rowErrors.${code}`]));

/** Matching keys for customers: the last 10 digits of the phone, and the lower-cased email. */
export const phoneKey = (phone: string | undefined) =>
  (phone ?? "").replace(/\D/g, "").slice(-10) || undefined;
export const emailKey = (email: string | undefined) => email?.trim().toLowerCase() || undefined;

/** Loose email check for forms that must reach the customer. */
export const looksLikeEmail = (email: string | undefined) =>
  !!email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

/** US ZIP (5 digits, optional +4) and two-letter state code. */
export const isUsZip = (zip: string | undefined) => !zip || /^\d{5}(-\d{4})?$/.test(zip);
export const isUsState = (state: string | undefined) => !state || /^[A-Z]{2}$/.test(state);

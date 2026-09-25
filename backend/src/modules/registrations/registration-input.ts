import {
  normalizeSerialValue,
  type RegistrationCustomer,
  type RegistrationRowInput,
  type RowErrors,
} from "@wms/domain";

// Pure helpers for registration input. The row rules themselves live in shared/wms-domain (registration-rules.ts),
// shared with the frontend.

export interface CreateRegistrationBody extends RegistrationRowInput {
  purchaseDate?: string;
  location?: string;
  dealerId?: string;
  attachmentIds?: string[];
}

const ROW_FIELDS = [
  "serial",
  "modelCode",
  "installDate",
  "customerName",
  "customerPhone",
  "customerEmail",
  "city",
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

export function createBody(body: unknown): CreateRegistrationBody {
  const source = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const ids = Array.isArray(source.attachmentIds)
    ? source.attachmentIds.filter((id): id is string => typeof id === "string").slice(0, 20)
    : undefined;
  return {
    ...rowInput(source),
    purchaseDate: text(source.purchaseDate, 20),
    location: text(source.location, 300),
    dealerId: text(source.dealerId, 100),
    attachmentIds: ids,
  };
}

/** A row's values as registration fields (serial normalised, blanks dropped). */
export const rowToFields = (values: RegistrationRowInput) => ({
  serial: normalizeSerialValue(values.serial),
  modelCode: (values.modelCode ?? "").trim().toUpperCase(),
  customer: {
    name: (values.customerName ?? "").trim(),
    phone: values.customerPhone?.trim() || undefined,
    email: values.customerEmail?.trim() || undefined,
    city: values.city?.trim() || undefined,
  } satisfies RegistrationCustomer,
  installDate: values.installDate?.trim() || undefined,
  invoiceNumber: values.invoiceNumber?.trim() || undefined,
});

/** Row errors as form field errors: i18n keys under `rowErrors.`. */
export const rowFieldErrors = (errors: RowErrors): Record<string, string> =>
  Object.fromEntries(Object.entries(errors).map(([field, code]) => [field, `rowErrors.${code}`]));

/** Matching keys for customers: the last 10 digits of the phone, and the lower-cased email. */
export const phoneKey = (phone: string | undefined) => (phone ?? "").replace(/\D/g, "").slice(-10) || undefined;
export const emailKey = (email: string | undefined) => email?.trim().toLowerCase() || undefined;

import { isIsoDate } from "./dates";
import type { IsoDate } from "./types";

// Row validation for dealer registrations (single form and bulk import), checked against the product master.

export interface RegistrationRowInput {
  serial?: string;
  modelCode?: string;
  installDate?: string;
  customerName?: string;
  customerPhone?: string;
  customerEmail?: string;
  city?: string;
  invoiceNumber?: string;
}

export type RegistrationField = "serial" | "modelCode" | "installDate" | "customerName" | "customerPhone";

export type RowErrorCode =
  | "required"
  | "invalid_serial"
  | "unknown_model"
  | "duplicate_serial"
  | "duplicate_in_file"
  | "invalid_date"
  | "future_date";

export type RowErrors = Partial<Record<RegistrationField, RowErrorCode>>;

export const SERIAL_PATTERN = /^[A-Z0-9-]{6,20}$/;

export const normalizeSerialValue = (value: string | undefined) =>
  (value ?? "").replace(/\s+/g, "").toUpperCase();

export interface RowContext {
  modelCodes: ReadonlySet<string>;
  /** Serials already registered in the system. */
  existingSerials: ReadonlySet<string>;
  /** Serials seen earlier in the same upload. */
  seenInFile?: ReadonlySet<string>;
  today: IsoDate;
}

export function validateRegistrationRow(row: RegistrationRowInput, ctx: RowContext): RowErrors {
  const errors: RowErrors = {};
  const serial = normalizeSerialValue(row.serial);
  const modelCode = (row.modelCode ?? "").trim().toUpperCase();
  const installDate = (row.installDate ?? "").trim();

  if (!serial) errors.serial = "required";
  else if (!SERIAL_PATTERN.test(serial)) errors.serial = "invalid_serial";
  else if (ctx.existingSerials.has(serial)) errors.serial = "duplicate_serial";
  else if (ctx.seenInFile?.has(serial)) errors.serial = "duplicate_in_file";

  if (!modelCode) errors.modelCode = "required";
  else if (!ctx.modelCodes.has(modelCode)) errors.modelCode = "unknown_model";

  if (!installDate) errors.installDate = "required";
  else if (!isIsoDate(installDate)) errors.installDate = "invalid_date";
  else if (installDate > ctx.today) errors.installDate = "future_date";

  if (!(row.customerName ?? "").trim()) errors.customerName = "required";

  return errors;
}

export const hasErrors = (errors: RowErrors) => Object.keys(errors).length > 0;

/** A duplicate serial needs a human (admin review); every other error is fixed by the dealer. */
export const needsAdminReview = (errors: RowErrors) =>
  errors.serial === "duplicate_serial" && Object.keys(errors).length === 1;

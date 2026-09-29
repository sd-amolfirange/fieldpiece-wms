import { isIsoDate } from "./dates";
import type { IsoDateTime, IsoDate, Model } from "./types";

// Row validation for dealer, bulk and partner registrations, checked against the product catalogue.
// Serial and batch formats come from each model (Model.serialPattern / batchPattern). Fieldpiece doesn't publish
// them; the defaults below are assumptions until Fieldpiece confirms the real label format. [CONFIRM]

export interface RegistrationRowInput {
  serial?: string;
  batchNumber?: string;
  modelCode?: string;
  purchaseDate?: string;
  customerName?: string;
  customerPhone?: string;
  customerEmail?: string;
  city?: string;
  state?: string;
  zip?: string;
  invoiceNumber?: string;
}

export type RegistrationField =
  "serial" | "batchNumber" | "modelCode" | "purchaseDate" | "customerName";

export type RowErrorCode =
  | "required"
  | "invalid_serial"
  | "invalid_batch"
  | "unknown_model"
  | "duplicate_serial"
  | "duplicate_in_file"
  | "invalid_date"
  | "future_date";

export type RowErrors = Partial<Record<RegistrationField, RowErrorCode>>;

/** Loose check any serial must pass (before the model's own format is known). */
export const SERIAL_PATTERN = /^[A-Z0-9-]{6,20}$/;

/**
 * Assumed Fieldpiece formats: the number on the label = yy + ww + 5-digit sequence; batch = yyww-L + line. [CONFIRM]
 * A product's serial is stored as MODEL-NUMBER (e.g. "SC680-251406233"), so the same number on two models never
 * collides; `serialPattern` is the format of the NUMBER part.
 */
export const DEFAULT_SERIAL_PATTERN = "^\\d{9}$";
export const DEFAULT_BATCH_PATTERN = "^\\d{4}-L\\d{2}$";

export const normalizeSerialValue = (value: string | undefined) =>
  (value ?? "").replace(/\s+/g, "").toUpperCase();

export const normalizeBatchValue = (value: string | undefined) =>
  (value ?? "").trim().toUpperCase();

/**
 * The stored serial for what someone typed or scanned: "251406233" with model SC680 -> "SC680-251406233"; a value
 * that already starts with "SC680-" is kept. Anything else (another model's prefix, letters) is returned
 * normalized, for validation to reject.
 */
export function modelSerial(
  modelCode: string | undefined,
  value: string | undefined,
): string {
  const serial = normalizeSerialValue(value);
  const code = (modelCode ?? "").trim().toUpperCase();
  if (!serial || !code || serial.startsWith(`${code}-`)) return serial;
  return /^\d+$/.test(serial) ? `${code}-${serial}` : serial;
}

/** The number part of a stored serial ("SC680-251406233" -> "251406233"); the value itself when it has no prefix. */
export function serialNumberPart(serial: string): string {
  const dash = serial.lastIndexOf("-");
  return dash < 0 ? serial : serial.slice(dash + 1);
}

/** The formats of one model, compiled. */
export interface ModelFormat {
  serial: RegExp;
  batch: RegExp;
}

/** Whether `serial` (already through modelSerial) is MODEL-NUMBER for this model, with the number in its format. */
export function isModelSerial(
  serial: string,
  modelCode: string,
  format: ModelFormat,
): boolean {
  const prefix = `${modelCode.trim().toUpperCase()}-`;
  return (
    SERIAL_PATTERN.test(serial) &&
    serial.startsWith(prefix) &&
    format.serial.test(serial.slice(prefix.length))
  );
}

export const modelFormat = (
  model: Pick<Model, "serialPattern" | "batchPattern">,
): ModelFormat => ({
  serial: new RegExp(model.serialPattern || DEFAULT_SERIAL_PATTERN),
  batch: new RegExp(model.batchPattern || DEFAULT_BATCH_PATTERN),
});

export interface RowContext {
  /** Model code -> its serial and batch formats (the catalogue). */
  models: ReadonlyMap<string, ModelFormat>;
  /** Serials already registered in the system. */
  existingSerials: ReadonlySet<string>;
  /** Serials seen earlier in the same upload. */
  seenInFile?: ReadonlySet<string>;
  today: IsoDate;
}

export function validateRegistrationRow(
  row: RegistrationRowInput,
  ctx: RowContext,
): RowErrors {
  const errors: RowErrors = {};
  const modelCode = (row.modelCode ?? "").trim().toUpperCase();
  const serial = modelSerial(modelCode, row.serial);
  const batch = normalizeBatchValue(row.batchNumber);
  const purchaseDate = (row.purchaseDate ?? "").trim();
  const format = ctx.models.get(modelCode);

  if (!modelCode) errors.modelCode = "required";
  else if (!format) errors.modelCode = "unknown_model";

  if (!serial) errors.serial = "required";
  else if (
    !SERIAL_PATTERN.test(serial) ||
    (format && !isModelSerial(serial, modelCode, format))
  )
    errors.serial = "invalid_serial";
  else if (ctx.existingSerials.has(serial)) errors.serial = "duplicate_serial";
  else if (ctx.seenInFile?.has(serial)) errors.serial = "duplicate_in_file";

  if (!batch) errors.batchNumber = "required";
  else if (format && !format.batch.test(batch))
    errors.batchNumber = "invalid_batch";

  if (!purchaseDate) errors.purchaseDate = "required";
  else if (!isIsoDate(purchaseDate)) errors.purchaseDate = "invalid_date";
  else if (purchaseDate > ctx.today) errors.purchaseDate = "future_date";

  if (!(row.customerName ?? "").trim()) errors.customerName = "required";

  return errors;
}

export const hasErrors = (errors: RowErrors) => Object.keys(errors).length > 0;

/** A duplicate serial needs a human (admin review); every other error is fixed by the sender. */
export const needsAdminReview = (errors: RowErrors) =>
  errors.serial === "duplicate_serial" && Object.keys(errors).length === 1;

// ---- Bulk import (DL02) -------------------------------------------------------------------------

export const BULK_ROW_STATUSES = [
  "REGISTERED",
  "FIXED",
  "ERROR",
  "REVIEW",
] as const;
/** REGISTERED: imported as it was; FIXED: imported after an inline fix; ERROR: needs fixing; REVIEW: sent to admin. */
export type BulkRowStatus = (typeof BULK_ROW_STATUSES)[number];

export interface BulkRow {
  /** Row number in the uploaded sheet (header = row 1). */
  rowNumber: number;
  values: RegistrationRowInput;
  errors: RowErrors;
  status: BulkRowStatus;
  registrationId?: string;
}

export interface BulkImport {
  id: string;
  fileName: string;
  dealerId: string;
  uploadedBy: string;
  uploadedByName: string;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  rows: BulkRow[];
}

export function bulkCounts(rows: readonly BulkRow[]) {
  const count = (s: BulkRowStatus) => rows.filter((r) => r.status === s).length;
  return {
    total: rows.length,
    registered: count("REGISTERED") + count("FIXED"),
    errors: count("ERROR"),
    review: count("REVIEW"),
  };
}

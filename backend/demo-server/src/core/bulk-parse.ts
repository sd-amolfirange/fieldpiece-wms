import { isIsoDate, type RegistrationRowInput } from "@wms/domain";

// Bulk registration sheets (DL02), as backend/src/modules/registrations/sheets.ts: the template columns and turning an
// uploaded sheet (already read into a string matrix) into rows. Columns are matched by header name, so their order in
// the file doesn't matter. Reading .xlsx needs exceljs and lives in the server adapter (src/documents.ts).

export const TEMPLATE_HEADERS = [
  "Serial number",
  "Batch number",
  "Model",
  "Purchase date",
  "Customer name",
  "Customer phone",
  "Customer email",
  "City",
  "State",
  "ZIP",
  "Invoice number",
] as const;

const FIELD_BY_HEADER: Record<string, keyof RegistrationRowInput> = {
  "serial number": "serial",
  serial: "serial",
  "batch number": "batchNumber",
  batch: "batchNumber",
  "lot number": "batchNumber",
  model: "modelCode",
  "model number": "modelCode",
  "model code": "modelCode",
  "purchase date": "purchaseDate",
  "date of purchase": "purchaseDate",
  "customer name": "customerName",
  customer: "customerName",
  "customer phone": "customerPhone",
  phone: "customerPhone",
  "customer email": "customerEmail",
  email: "customerEmail",
  city: "city",
  state: "state",
  zip: "zip",
  "zip code": "zip",
  "invoice number": "invoiceNumber",
  invoice: "invoiceNumber",
};

/** The template's example row. */
export const TEMPLATE_SAMPLE_ROW = [
  "SC680-243500101",
  "2435-L02",
  "SC680",
  "2026-09-15",
  "Alex Rivera",
  "(713) 555-0100",
  "",
  "Houston",
  "TX",
  "77002",
  "INV-10001",
] as const;

// As backend/src/modules/registrations/sheets.ts: a US dealer's own spreadsheet is usually M/D/YYYY or
// MM-DD-YYYY, not ISO — accept that in an uploaded sheet's Purchase date column and convert to yyyy-MM-dd
// before validation sees it. Four-digit years only, so it's never ambiguous with ISO or day-first (DD/MM/YYYY).
const US_DATE = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/;

/** "9/15/2026" or "09-15-2026" -> "2026-09-15"; anything already ISO, or not a recognised US date, is unchanged. */
export function normalizeSheetDate(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || isIsoDate(trimmed)) return trimmed;
  const m = US_DATE.exec(trimmed);
  if (!m) return trimmed;
  const [, monthStr, dayStr, year] = m;
  const month = Number(monthStr);
  const day = Number(dayStr);
  if (month < 1 || month > 12 || day < 1 || day > 31) return trimmed;
  const iso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return isIsoDate(iso) ? iso : trimmed;
}

/** Rows from a string matrix (header row first). Blank rows are skipped. */
export function rowsFromMatrix(matrix: string[][]): RegistrationRowInput[] {
  const [header, ...body] = matrix;
  if (!header) return [];
  const fields = header.map((h) => FIELD_BY_HEADER[h.trim().toLowerCase()]);
  return body
    .filter((cells) => cells.some((c) => c.trim()))
    .map((cells) => {
      const row: RegistrationRowInput = {};
      fields.forEach((field, i) => {
        if (!field) return;
        const text = (cells[i] ?? "").trim().slice(0, 200);
        row[field] = field === "purchaseDate" ? normalizeSheetDate(text) : text;
      });
      return row;
    });
}

/** Minimal CSV reader: commas, double-quoted fields with "" escapes, CRLF or LF line ends, optional BOM. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const input = text.startsWith("\u{FEFF}") ? text.slice(1) : text; // byte-order mark
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    if (quoted) {
      if (ch === '"' && input[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && input[i + 1] === "\n") i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export const templateCsv = () => `${TEMPLATE_HEADERS.join(",")}\r\n${TEMPLATE_SAMPLE_ROW.join(",")}\r\n`;

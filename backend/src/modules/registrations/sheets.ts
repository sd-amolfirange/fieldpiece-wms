import { isValid, parse } from "date-fns";
import ExcelJS from "exceljs";
import { isIsoDate, type RegistrationRowInput } from "@wms/domain";

// Bulk registration sheets (DL02): the templates, and reading an uploaded .xlsx or .csv into rows. Columns are
// matched by header name, so their order in the file doesn't matter.

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

const SAMPLE_ROW = [
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
];

// A US dealer's own spreadsheet usually has Excel's US locale default, M/D/YYYY (or MM-DD-YYYY), not ISO — accept
// those in an uploaded sheet's Purchase date column and convert to yyyy-MM-dd before validation ever sees them.
// An .xlsx date CELL is already converted to ISO in cellText() below; this only covers a date typed as TEXT
// (every CSV cell, or a text-formatted Excel cell). Four-digit years only, so it's never ambiguous with ISO or
// with a day-first (DD/MM/YYYY) reading.
const US_DATE_FORMATS = ["M/d/yyyy", "MM/dd/yyyy", "M-d-yyyy", "MM-dd-yyyy"];

/** "9/15/2026" or "09-15-2026" -> "2026-09-15"; anything already ISO, or not a recognised US date, is unchanged. */
export function normalizeSheetDate(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || isIsoDate(trimmed)) return trimmed;
  for (const dateFormat of US_DATE_FORMATS) {
    const parsed = parse(trimmed, dateFormat, new Date());
    if (isValid(parsed) && parsed.getFullYear() >= 1000) {
      const y = parsed.getFullYear();
      const m = String(parsed.getMonth() + 1).padStart(2, "0");
      const d = String(parsed.getDate()).padStart(2, "0");
      return `${y}-${m}-${d}`;
    }
  }
  return trimmed;
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

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  // Excel stores dates without a zone; exceljs returns them as UTC midnight.
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object") {
    if ("result" in value) return cellText(value.result);
    if ("richText" in value) return value.richText.map((r) => r.text).join("");
    if ("text" in value) return String(value.text);
    return "";
  }
  return String(value);
}

/** Reads the first sheet of an .xlsx file, or a .csv file, into a string matrix. */
export async function readSheet(fileName: string, buffer: Buffer): Promise<string[][]> {
  if (/\.csv$/i.test(fileName)) return parseCsv(buffer.toString("utf8"));
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) return [];
  const width = Math.max(sheet.columnCount, TEMPLATE_HEADERS.length);
  const matrix: string[][] = [];
  sheet.eachRow({ includeEmpty: false }, (row) => {
    matrix.push(Array.from({ length: width }, (_, i) => cellText(row.getCell(i + 1).value)));
  });
  return matrix;
}

export const templateCsv = () => `${TEMPLATE_HEADERS.join(",")}\r\n${SAMPLE_ROW.join(",")}\r\n`;

export async function templateXlsx(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Registrations");
  sheet.columns = TEMPLATE_HEADERS.map((header) => ({ header, width: 20 }));
  sheet.getRow(1).font = { bold: true };
  sheet.addRow([...SAMPLE_ROW.slice(0, 3), new Date(`${SAMPLE_ROW[3]}T00:00:00Z`), ...SAMPLE_ROW.slice(4)]);
  sheet.getColumn(4).numFmt = "yyyy-mm-dd";
  // Serial numbers and ZIP codes are text: keep Excel from dropping leading zeros.
  for (const column of [1, 10]) sheet.getColumn(column).numFmt = "@";
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

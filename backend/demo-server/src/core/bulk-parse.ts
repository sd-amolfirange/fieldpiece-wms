import type { RegistrationRowInput } from "@wms/domain";

// Turns an uploaded sheet (already read into a string matrix) into registration rows. Columns are matched by
// header name, so the order in the file doesn't matter.

export const TEMPLATE_HEADERS = [
  "Serial number",
  "Model code",
  "Customer name",
  "Customer phone",
  "Customer email",
  "City",
  "Install date",
  "Invoice number",
] as const;

const FIELD_BY_HEADER: Record<string, keyof RegistrationRowInput> = {
  "serial number": "serial",
  serial: "serial",
  "model code": "modelCode",
  model: "modelCode",
  "customer name": "customerName",
  customer: "customerName",
  "customer phone": "customerPhone",
  phone: "customerPhone",
  "customer email": "customerEmail",
  email: "customerEmail",
  city: "city",
  "install date": "installDate",
  "installation date": "installDate",
  "invoice number": "invoiceNumber",
  invoice: "invoiceNumber",
};

export function rowsFromMatrix(matrix: string[][]): RegistrationRowInput[] {
  const [header, ...body] = matrix;
  if (!header) return [];
  const fields = header.map((h) => FIELD_BY_HEADER[h.trim().toLowerCase()]);
  return body
    .filter((cells) => cells.some((c) => c.trim()))
    .map((cells) => {
      const row: RegistrationRowInput = {};
      fields.forEach((field, i) => {
        if (field) row[field] = (cells[i] ?? "").trim();
      });
      return row;
    });
}

/** Minimal CSV reader: commas, double-quoted fields with "" escapes, CRLF or LF line ends. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const input = text.replace(/^\uFEFF/, "");
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

export const templateCsv = () =>
  `${TEMPLATE_HEADERS.join(",")}\r\nAER-SPL15-260999,AER-SPL15,A. Sample,+91 90000 00000,,Pune,2026-09-15,INV-0001\r\n`;

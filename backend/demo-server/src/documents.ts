import ExcelJS from "exceljs";
import { parseCsv, TEMPLATE_HEADERS, TEMPLATE_SAMPLE_ROW } from "./core/index";

// Sheet formats the mock API reads or writes (as backend/src/modules/registrations/sheets.ts): bulk upload sheets
// (.xlsx / .csv) and the Excel template. Server-only; the shared core works on plain rows.

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  // Excel stores dates without a zone; exceljs returns them as UTC midnight.
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object") {
    if ("result" in value) return cellText(value.result as ExcelJS.CellValue);
    if ("richText" in value) return value.richText.map((r) => r.text).join("");
    if ("text" in value) return String(value.text);
    return "";
  }
  return String(value);
}

/** Reads the first sheet of an .xlsx file or a .csv file into a string matrix (header row first). */
export async function readSheet(fileName: string, buffer: Buffer): Promise<string[][]> {
  if (/\.csv$/i.test(fileName)) return parseCsv(buffer.toString("utf8"));
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) return [];
  const width = Math.max(sheet.columnCount, TEMPLATE_HEADERS.length);
  const matrix: string[][] = [];
  sheet.eachRow({ includeEmpty: false }, (row) => {
    matrix.push(Array.from({ length: width }, (_, i) => cellText(row.getCell(i + 1).value)));
  });
  return matrix;
}

export async function templateXlsx(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Registrations");
  sheet.columns = TEMPLATE_HEADERS.map((header) => ({ header, width: 20 }));
  sheet.getRow(1).font = { bold: true };
  const sample = [...TEMPLATE_SAMPLE_ROW];
  sheet.addRow([...sample.slice(0, 3), new Date(`${sample[3]}T00:00:00Z`), ...sample.slice(4)]);
  sheet.getColumn(4).numFmt = "yyyy-mm-dd";
  // Serial numbers and ZIP codes are text: keep Excel from dropping leading zeros.
  for (const column of [1, 10]) sheet.getColumn(column).numFmt = "@";
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

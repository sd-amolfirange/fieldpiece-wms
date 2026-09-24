import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import type { UnitView } from "@wms/domain";
import { parseCsv, TEMPLATE_HEADERS } from "./core/index";

// File formats the mock API reads or writes: bulk upload sheets (xlsx / csv), the upload templates and the
// warranty certificate PDF. Express-only; the shared core works on plain rows.

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
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
export async function readSheet(
  fileName: string,
  buffer: Buffer,
): Promise<string[][]> {
  if (/\.csv$/i.test(fileName)) return parseCsv(buffer.toString("utf8"));
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) return [];
  const width = Math.max(sheet.columnCount, TEMPLATE_HEADERS.length);
  const matrix: string[][] = [];
  sheet.eachRow({ includeEmpty: false }, (row) => {
    matrix.push(
      Array.from({ length: width }, (_, i) =>
        cellText(row.getCell(i + 1).value),
      ),
    );
  });
  return matrix;
}

export async function templateXlsx(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Registrations");
  sheet.columns = TEMPLATE_HEADERS.map((header) => ({ header, width: 20 }));
  sheet.getRow(1).font = { bold: true };
  sheet.addRow([
    "AER-SPL15-260999",
    "AER-SPL15",
    "A. Sample",
    "+91 90000 00000",
    "",
    "Pune",
    new Date("2026-09-15T00:00:00Z"),
    "INV-0001",
  ]);
  sheet.getColumn(7).numFmt = "yyyy-mm-dd";
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

const PART_NAMES: Record<string, string> = {
  UNIT: "Unit",
  COMPRESSOR: "Compressor",
  PCB: "PCB",
};

const longDate = (iso?: string) =>
  iso
    ? new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      })
    : "-";

/** Warranty certificate generated from the unit's current data. */
export function certificatePdf(unit: UnitView): PDFKit.PDFDocument {
  const doc = new PDFDocument({
    size: "A4",
    margin: 56,
    info: { Title: `Warranty certificate ${unit.serial}` },
  });
  doc.fontSize(22).font("Helvetica-Bold").text("Warranty certificate");
  doc
    .moveDown(0.3)
    .fontSize(11)
    .font("Helvetica")
    .fillColor("#555555")
    .text(`${unit.brandName} · ${unit.modelName}`);
  doc.moveDown(1).fillColor("#000000");

  const row = (label: string, value: string) => {
    doc
      .font("Helvetica-Bold")
      .text(`${label}: `, { continued: true })
      .font("Helvetica")
      .text(value);
  };
  row("Serial number", unit.serial);
  row("Model", `${unit.modelCode} (${unit.capacity} ${unit.unitType})`);
  row("Owner", unit.customerName ?? "-");
  row(
    "Installed",
    `${longDate(unit.installDate)}${unit.location ? `, ${unit.location}` : ""}`,
  );
  row("Sold by", unit.dealerName ?? "-");
  if (unit.void)
    row(
      "Status",
      `VOID (${unit.void.reason.replace(/_/g, " ").toLowerCase()})`,
    );

  doc
    .moveDown(1)
    .font("Helvetica-Bold")
    .fontSize(13)
    .text("Part-wise warranty");
  doc.moveDown(0.4).fontSize(10);
  const cols = [56, 170, 290, 380, 470];
  const header = ["Part", "Serial", "Starts", "Ends", "Covers"];
  let y = doc.y;
  header.forEach((h, i) => doc.font("Helvetica-Bold").text(h, cols[i], y));
  y += 18;
  for (const part of unit.parts.filter((p) => !p.replacedAt)) {
    const cells = [
      PART_NAMES[part.partType] ?? part.partType,
      part.serial ?? "-",
      longDate(part.warrantyStart),
      longDate(part.warrantyEnd),
      part.coversLabour ? "Parts and labour" : "Parts",
    ];
    cells.forEach((c, i) =>
      doc
        .font("Helvetica")
        .text(c, cols[i], y, {
          width: (cols[i + 1] ?? 540) - (cols[i] ?? 0) - 6,
        }),
    );
    y += 18;
  }
  doc.x = 56;
  doc.y = y + 16;
  doc
    .fontSize(9)
    .fillColor("#555555")
    .text(
      "Each part is covered from its start date until its end date, inclusive. A replaced part gets a new warranty from the " +
        "replacement date. Warranty is void after unauthorised repair or missed servicing. Demo document.",
      { width: 480 },
    );
  doc.end();
  return doc;
}

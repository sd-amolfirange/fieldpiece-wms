import PDFDocument from "pdfkit";
import type { UnitView } from "@wms/domain";

// Warranty certificate PDF (A05, DL05, CU03), generated from the unit's current data on every download, so it
// always shows replacements and voids. Readable on a phone.

const PART_NAMES: Record<string, string> = { UNIT: "Unit", COMPRESSOR: "Compressor", PCB: "PCB" };

const longDate = (iso?: string) =>
  iso
    ? new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      })
    : "-";

export function certificatePdf(unit: UnitView): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", margin: 56, info: { Title: `Warranty certificate ${unit.serial}` } });
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  doc.fontSize(22).font("Helvetica-Bold").text("Warranty certificate");
  doc.moveDown(0.3).fontSize(11).font("Helvetica").fillColor("#555555").text(`${unit.brandName} · ${unit.modelName}`);
  doc.moveDown(1).fillColor("#000000");

  const row = (label: string, value: string) => {
    doc.font("Helvetica-Bold").text(`${label}: `, { continued: true }).font("Helvetica").text(value);
  };
  row("Serial number", unit.serial);
  row("Model", `${unit.modelCode} (${unit.capacity} ${unit.unitType})`);
  row("Owner", unit.customerName ?? "-");
  row("Installed", `${longDate(unit.installDate)}${unit.location ? `, ${unit.location}` : ""}`);
  row("Sold by", unit.dealerName ?? "-");
  if (unit.void) row("Status", `VOID (${unit.void.reason.replace(/_/g, " ").toLowerCase()})`);

  doc.moveDown(1).font("Helvetica-Bold").fontSize(13).text("Part-wise warranty");
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
      doc.font("Helvetica").text(c, cols[i], y, { width: (cols[i + 1] ?? 540) - (cols[i] ?? 0) - 6 }),
    );
    y += 18;
  }
  doc.x = 56;
  doc.y = y + 16;
  doc
    .fontSize(9)
    .fillColor("#555555")
    .text(
      "Each part is covered from its start date until its end date, inclusive. A replaced part gets a new warranty " +
        "from the replacement date. Warranty is void after unauthorised repair or missed servicing.",
      { width: 480 },
    );
  doc.end();
  return done;
}

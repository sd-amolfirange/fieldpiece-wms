import PDFDocument from "pdfkit";
import type { UnitView } from "@wms/domain";

// Warranty certificate PDF (A05, DL05, CU03), generated from the product's current data on every download, so it
// always shows a void or a replacement. Readable on a phone.

const longDate = (iso?: string) =>
  iso
    ? new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
      })
    : "-";

export function certificatePdf(unit: UnitView): Promise<Buffer> {
  const doc = new PDFDocument({
    size: "LETTER",
    margin: 56,
    info: { Title: `Warranty certificate ${unit.serial}` },
  });
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  doc.fontSize(22).font("Helvetica-Bold").text("Warranty certificate");
  doc
    .moveDown(0.3)
    .fontSize(11)
    .font("Helvetica")
    .fillColor("#555555")
    .text(`Fieldpiece ${unit.modelCode} · ${unit.modelName}`);
  doc.moveDown(1).fillColor("#000000");

  const row = (label: string, value: string) => {
    doc.font("Helvetica-Bold").text(`${label}: `, { continued: true }).font("Helvetica").text(value);
  };
  row("Serial number", unit.serial);
  row("Batch number", unit.batchNumber ?? "-");
  row("Product", `${unit.modelCode}, ${unit.modelDescription}`);
  row("Owner", unit.customerName ?? "-");
  row(
    "Purchased",
    `${longDate(unit.purchaseDate)}${unit.dealerName ? ` from ${unit.dealerName}` : unit.placeOfPurchase ? ` from ${unit.placeOfPurchase}` : ""}`,
  );
  row("Warranty", `${longDate(unit.warrantyStart)} to ${longDate(unit.warrantyEnd)}`);
  if (unit.replacesSerial) row("Replaces", unit.replacesSerial);
  if (unit.replacedBySerial) row("Status", `Replaced by ${unit.replacedBySerial}`);
  if (unit.void) row("Status", `VOID (${unit.void.reason.replace(/_/g, " ").toLowerCase()})`);

  doc.moveDown(1.5);
  doc
    .fontSize(9)
    .fillColor("#555555")
    .text(
      "This product is covered against defects in materials and workmanship from the purchase date until the end " +
        "date above, inclusive. The warranty is void after misuse, alteration or repair by anyone other than an " +
        "authorized service center. A replacement product carries the rest of the original warranty.",
      { width: 480 },
    );
  doc.end();
  return done;
}

import PDFDocument from "pdfkit";
import type { UnitView } from "@wms/domain";
import { FIELDPIECE_LOGO_HEIGHT, FIELDPIECE_LOGO_PNG, FIELDPIECE_LOGO_WIDTH } from "./brand-logo";

// Warranty certificate PDF (A05, DL05, CU03), generated from the product's current data on every download, so it
// always shows a void or a replacement. Readable on a phone. Branded with the Fieldpiece wordmark and brand
// yellow (frontend/src/styles/tokens.css --brand-500), so it matches the app the customer just downloaded it from.

// Brand values, same source as frontend/src/styles/tokens.css. [CONFIRM] pending Fieldpiece's own style guide.
const BRAND_YELLOW = "#F8BC35";
const INK = "#12130D";
const INK_MUTED = "#555555";
const PAGE_MARGIN = 56;

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
    margin: 0,
    info: { Title: `Warranty certificate ${unit.serial}`, Author: "Fieldpiece Instruments" },
  });
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const pageWidth = doc.page.width;
  const contentWidth = pageWidth - PAGE_MARGIN * 2;

  // Brand header band: yellow band across the top, the wordmark inside it, same treatment as the app header.
  const headerHeight = 88;
  doc.rect(0, 0, pageWidth, headerHeight).fill(BRAND_YELLOW);
  const logoHeight = 30;
  const logoWidth = (FIELDPIECE_LOGO_WIDTH / FIELDPIECE_LOGO_HEIGHT) * logoHeight;
  doc.image(FIELDPIECE_LOGO_PNG, PAGE_MARGIN, (headerHeight - logoHeight) / 2, {
    width: logoWidth,
    height: logoHeight,
  });
  doc
    .fillColor(INK)
    .font("Helvetica-Bold")
    .fontSize(11)
    .text("WARRANTY CERTIFICATE", PAGE_MARGIN, (headerHeight - logoHeight) / 2 + 3, {
      width: contentWidth,
      align: "right",
    });

  doc.y = headerHeight + 28;
  doc.x = PAGE_MARGIN;

  doc.fontSize(20).font("Helvetica-Bold").fillColor(INK).text(`${unit.modelCode} — ${unit.modelName}`);
  doc.moveDown(0.2).fontSize(11).font("Helvetica").fillColor(INK_MUTED).text(unit.modelDescription);
  doc.moveDown(1);

  // Thin brand rule under the intro, before the facts.
  doc
    .moveTo(PAGE_MARGIN, doc.y)
    .lineTo(pageWidth - PAGE_MARGIN, doc.y)
    .lineWidth(2)
    .strokeColor(BRAND_YELLOW)
    .stroke();
  doc.moveDown(1);

  doc.fillColor(INK);
  const row = (label: string, value: string) => {
    doc.font("Helvetica-Bold").fontSize(11).text(`${label}: `, { continued: true }).font("Helvetica").text(value);
    doc.moveDown(0.4);
  };
  row("Serial number", unit.serial);
  row("Batch number", unit.batchNumber ?? "-");
  row("Owner", unit.customerName ?? "-");
  row(
    "Purchased",
    `${longDate(unit.purchaseDate)}${unit.dealerName ? ` from ${unit.dealerName}` : unit.placeOfPurchase ? ` from ${unit.placeOfPurchase}` : ""}`,
  );
  row("Warranty", `${longDate(unit.warrantyStart)} to ${longDate(unit.warrantyEnd)}`);
  const extendedMonths = (unit.extensions ?? []).reduce((n, e) => n + e.months, 0);
  if (extendedMonths) row("Extended warranty", `+${extendedMonths} months (to ${longDate(unit.warrantyEnd)})`);
  if (unit.replacesSerial) row("Replaces", unit.replacesSerial);
  if (unit.replacedBySerial) row("Status", `Replaced by ${unit.replacedBySerial}`);
  if (unit.void) row("Status", `VOID (${unit.void.reason.replace(/_/g, " ").toLowerCase()})`);

  doc.moveDown(1);
  doc
    .fontSize(9)
    .fillColor(INK_MUTED)
    .text(
      "This product is covered against defects in materials and workmanship from the purchase date until the end " +
        "date above, inclusive. The warranty is void after misuse, alteration or repair by anyone other than an " +
        "authorized service center. A replacement product carries the rest of the original warranty.",
      { width: contentWidth },
    );

  // Footer rule + brand line, pinned to the bottom of the page.
  const footerY = doc.page.height - PAGE_MARGIN - 18;
  doc
    .moveTo(PAGE_MARGIN, footerY)
    .lineTo(pageWidth - PAGE_MARGIN, footerY)
    .lineWidth(1)
    .strokeColor(BRAND_YELLOW)
    .stroke();
  doc
    .fontSize(8)
    .fillColor(INK_MUTED)
    .text("Fieldpiece Instruments · Warranty Management", PAGE_MARGIN, footerY + 6, {
      width: contentWidth,
      align: "center",
    });

  doc.end();
  return done;
}

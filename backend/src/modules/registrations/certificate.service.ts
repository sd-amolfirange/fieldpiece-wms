import { Injectable, Logger } from "@nestjs/common";
import PDFDocument from "pdfkit";
import { formatIsoDate } from "../../common/time/utc-date";
import { BlobStorage } from "../../infra/storage/blob-storage";
import { RegistrationsService } from "./registrations.service";

/** Builds the warranty certificate PDF in the worker (pdfkit never runs on the request path, Section 9.4). */
@Injectable()
export class CertificateService {
  private readonly logger = new Logger(CertificateService.name);

  constructor(
    private readonly registrations: RegistrationsService,
    private readonly storage: BlobStorage,
  ) {}

  /** Idempotent: skips registrations that already have a certificate. */
  async generate(registrationId: string): Promise<void> {
    const reg = await this.registrations.findForDocument(registrationId);
    if (!reg || reg.certificateKey) return;

    const pdf = await render({
      registrationId: reg.id,
      serialNumber: reg.serialNumber,
      product: `${reg.product.name} (${reg.product.sku})`,
      owner: reg.customer.companyName ?? reg.customer.contactName,
      purchaseDate: formatIsoDate(reg.purchaseDate),
      warrantyEnd: formatIsoDate(reg.warrantyEnd),
    });
    const key = `certificates/${reg.id}.pdf`;
    await this.storage.put(key, pdf, "application/pdf");
    await this.registrations.setCertificateKey(reg.id, key);
    this.logger.log({ registrationId }, "Certificate generated");
  }
}

interface CertificateData {
  registrationId: string;
  serialNumber: string;
  product: string;
  owner: string;
  purchaseDate: string;
  warrantyEnd: string;
}

/** pdfkit writes text as data, so user input can't inject markup. Black on white (print-friendly). */
function render(data: CertificateData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "LETTER", margin: 60, info: { Title: "Warranty certificate" } });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    // TODO: replace the text wordmark with the official logo SVG once supplied. [CONFIRM]
    doc.font("Helvetica-BoldOblique").fontSize(28).text("Fieldpiece", { continued: true });
    doc.font("Helvetica").fontSize(18).text("  |  Warranty");
    doc.moveDown(2);
    doc.font("Helvetica-Bold").fontSize(22).text("Certificate of warranty registration");
    doc.moveDown();

    const row = (label: string, value: string, mono = false) => {
      doc.font("Helvetica-Bold").fontSize(11).text(label.toUpperCase());
      doc
        .font(mono ? "Courier" : "Helvetica")
        .fontSize(14)
        .text(value);
      doc.moveDown(0.6);
    };
    row("Product", data.product);
    row("Serial number", data.serialNumber, true);
    row("Registered to", data.owner);
    row("Purchase date", data.purchaseDate);
    row("Covered until", data.warrantyEnd);
    row("Registration ID", data.registrationId, true);

    doc.moveDown(2);
    doc
      .font("Helvetica")
      .fontSize(9)
      .fillColor("#444444")
      .text("Coverage is subject to the Fieldpiece warranty terms in effect on the purchase date.");
    doc.end();
  });
}

// A minimal one-page PDF (title + "label: value" lines), written by hand so the core needs no PDF library and runs in
// the browser too. Used for the simulated emailed invoice (as the backend does) and the test adapter's certificate.

export function simplePdf(title: string, lines: [string, string][]): string {
  // PDF string literals escape (, ) and \; anything outside printable ASCII becomes "?".
  const pdfText = (value: string) => value.replace(/[^\x20-\x7e]/g, "?").replace(/[()\\]/g, (c) => `\\${c}`);
  const body = lines
    .map(([k, v], i) => `BT /F1 12 Tf 72 ${700 - i * 22} Td (${pdfText(`${k}: ${v}`)}) Tj ET`)
    .join("\n");
  const stream = `BT /F1 20 Tf 72 740 Td (${pdfText(title)}) Tj ET\n${body}`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  // Every character is ASCII, so string length equals byte length for the offsets.
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((obj, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return pdf;
}

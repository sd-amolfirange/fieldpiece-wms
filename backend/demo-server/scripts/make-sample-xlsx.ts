import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";

// Writes demo-assets/coolair_sales_week38.xlsx: CoolAir Traders' sales for week 38 (14-19 Sep 2026).
// 25 rows with 3 deliberate errors (docs/Demo workflows.md, W1):
//   row 7  - unknown model code (AER-SPL20 isn't in the product master)
//   row 15 - duplicate serial (AER-SPL15-250301 is already registered to S. Deshpande)
//   row 22 - missing install date
// Customer names and phone numbers are fictional. The first data row belongs to the demo customer R. Kulkarni.

export const SAMPLE_HEADERS = [
  "Serial number",
  "Model code",
  "Customer name",
  "Customer phone",
  "Customer email",
  "City",
  "Install date",
  "Invoice number",
] as const;

const FIRST_NAMES = [
  "A.",
  "B.",
  "C.",
  "D.",
  "G.",
  "J.",
  "K.",
  "L.",
  "M.",
  "N.",
  "P.",
  "R.",
  "S.",
];
const SURNAMES = [
  "Bhosale",
  "Chavan",
  "Deshmukh",
  "Gaikwad",
  "Jadhav",
  "Kadam",
  "Mane",
  "Naik",
  "Sawant",
  "Shinde",
  "Thakur",
  "Wagh",
  "Yadav",
];
const CITIES = ["Pune", "Pune", "Pune", "Pimpri", "Hinjewadi", "Kharadi"];

export interface SampleRow {
  serial: string;
  modelCode: string;
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  city: string;
  installDate: string | null;
  invoiceNumber: string;
}

export function sampleRows(): SampleRow[] {
  return Array.from({ length: 25 }, (_, i) => {
    const n = i + 1;
    const spl18 = n % 4 === 0;
    const day = 14 + (i % 6); // Mon 14 - Sat 19 Sep 2026
    const row: SampleRow = {
      serial: `${spl18 ? "AER-SPL18" : "AER-SPL15"}-2609${String(n).padStart(2, "0")}`,
      modelCode: spl18 ? "AER-SPL18" : "AER-SPL15",
      customerName: `${FIRST_NAMES[i % FIRST_NAMES.length]} ${SURNAMES[(i * 5) % SURNAMES.length]}`,
      customerPhone: `+91 90000 002${String(n).padStart(2, "0")}`,
      customerEmail: n % 3 === 0 ? `customer${n}@example.com` : "",
      city: CITIES[i % CITIES.length] ?? "Pune",
      installDate: `2026-09-${String(day).padStart(2, "0")}`,
      invoiceNumber: `CA-INV-38${String(n).padStart(3, "0")}`,
    };
    // Row 2 in the sheet is R. Kulkarni (matched by phone), so W1 step 9 shows the new unit in her app.
    if (n === 1)
      Object.assign(row, {
        customerName: "R. Kulkarni",
        customerPhone: "+91 90000 00101",
        city: "Pune",
      });
    if (n === 7) row.modelCode = "AER-SPL20";
    if (n === 15) row.serial = "AER-SPL15-250301";
    if (n === 22) row.installDate = null;
    return row;
  });
}

async function main() {
  const out = join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "..",
    "demo-assets",
    "coolair_sales_week38.xlsx",
  );
  mkdirSync(dirname(out), { recursive: true });

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "CoolAir Traders";
  const sheet = workbook.addWorksheet("Sales week 38");
  sheet.columns = SAMPLE_HEADERS.map((header) => ({
    header,
    width: header === "Customer email" ? 26 : 18,
  }));
  sheet.getRow(1).font = { bold: true };

  for (const r of sampleRows()) {
    sheet.addRow([
      r.serial,
      r.modelCode,
      r.customerName,
      r.customerPhone,
      r.customerEmail,
      r.city,
      r.installDate ? new Date(`${r.installDate}T00:00:00Z`) : null,
      r.invoiceNumber,
    ]);
  }
  sheet.getColumn(7).numFmt = "yyyy-mm-dd";

  await workbook.xlsx.writeFile(out);

  // Read it back to prove the file is valid.
  const check = new ExcelJS.Workbook();
  await check.xlsx.readFile(out);
  const rows = check.worksheets[0]?.actualRowCount ?? 0;
  console.log(`Wrote ${out} (${rows - 1} data rows)`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  void main();
}

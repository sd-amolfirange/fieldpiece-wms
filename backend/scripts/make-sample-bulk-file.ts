import ExcelJS from "exceljs";
import { join } from "node:path";
import { TEMPLATE_HEADERS } from "../src/modules/registrations/sheets";

// Writes demo-assets/lonestar_sales_week38.xlsx: a week of Lone Star Refrigeration Supply's Fieldpiece sales for the
// bulk import walkthrough (W1). 25 rows, 3 deliberate errors: an unknown model (row 8), a serial that's already
// registered (row 14, a seeded MG44), a missing purchase date (row 20). Names are fictional; phones use 555-01xx.
// Purchase dates are relative to when this script runs (a week ending a few days ago), never a fixed calendar
// date, so the sample file never drifts into the future and starts failing every row's date validation.
// Run: npx tsx scripts/make-sample-bulk-file.ts

const MODELS = [
  "SC680",
  "SC480",
  "SC260",
  "SM482V",
  "SM382V",
  "JL3KH6",
  "VP87",
  "MR45",
  "MG44",
  "DR82",
  "SRS1",
  "STA2",
];
const PEOPLE: [string, string, string, string][] = [
  ["Adam Rhodes", "Houston", "TX", "77002"],
  ["Bianca Flores", "Pasadena", "TX", "77502"],
  ["Carl Jenkins", "Pearland", "TX", "77581"],
  ["Dana Scott", "Spring", "TX", "77373"],
  ["Eric Lawson", "The Woodlands", "TX", "77380"],
  ["Fatima Khan", "Katy", "TX", "77450"],
  ["Greg Holloway", "Baytown", "TX", "77520"],
  ["Hannah Price", "League City", "TX", "77573"],
  ["Ivan Soto", "Conroe", "TX", "77301"],
  ["Julia Bennett", "Humble", "TX", "77338"],
  ["Kevin Tran", "Missouri City", "TX", "77459"],
  ["Laura Chen", "Friendswood", "TX", "77546"],
  ["Mike Delgado", "Tomball", "TX", "77375"],
];

async function main() {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Registrations");
  sheet.columns = TEMPLATE_HEADERS.map((header) => ({ header, width: 18 }));
  sheet.getRow(1).font = { bold: true };
  for (const column of [1, 10]) sheet.getColumn(column).numFmt = "@";
  sheet.getColumn(4).numFmt = "yyyy-mm-dd";

  // A 5-day sales week ending 11 days ago (today - 11 .. today - 7), so it's always in the past and the demo
  // ("this week's sales") stays believable no matter when the script is run.
  const today = new Date();
  const weekStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - 11));

  for (let i = 0; i < 25; i += 1) {
    const rowNumber = i + 2;
    const [name, city, state, zip] = PEOPLE[i % PEOPLE.length]!;
    // Serials are written MODEL-NUMBER, as stored. Row 14 is the seeded MG44 (already registered). Row 8 (unknown
    // model) has just the label number, as a sheet typed from the label would, so fixing its model inline is enough.
    const model = rowNumber === 8 ? "SC690" : rowNumber === 14 ? "MG44" : MODELS[i % MODELS.length]!;
    const number = rowNumber === 14 ? "252811902" : `2635${String(10101 + i * 7).padStart(5, "0")}`;
    const serial = rowNumber === 8 ? number : `${model}-${number}`;
    const purchased =
      rowNumber === 20
        ? null
        : new Date(Date.UTC(weekStart.getUTCFullYear(), weekStart.getUTCMonth(), weekStart.getUTCDate() + (i % 5)));
    sheet.addRow([
      serial,
      `2635-L0${(i % 3) + 1}`,
      model,
      purchased,
      name,
      `(713) 555-01${String(20 + i).padStart(2, "0")}`,
      i % 4 === 0 ? `${name.split(" ")[0]!.toLowerCase()}@example.com` : "",
      city,
      state,
      zip,
      `LS-38-${String(1001 + i)}`,
    ]);
  }
  const out = join(__dirname, "..", "..", "demo-assets", "lonestar_sales_week38.xlsx");
  await workbook.xlsx.writeFile(out);
  process.stdout.write(`Wrote ${out}\n`);
}

void main();

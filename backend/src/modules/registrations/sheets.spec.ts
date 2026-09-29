import { readFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeSheetDate, parseCsv, readSheet, rowsFromMatrix, templateCsv, templateXlsx } from "./sheets";

describe("bulk sheets", () => {
  it("parses quoted CSV with CRLF and a BOM", () => {
    expect(parseCsv('﻿a,"b, c","say ""hi"""\r\n1,2,3')).toEqual([
      ["a", "b, c", 'say "hi"'],
      ["1", "2", "3"],
    ]);
  });

  it("matches columns by header name in any order and skips blank rows", () => {
    expect(
      rowsFromMatrix([
        ["Purchase date", "Serial number", "Unknown", "Model", "Lot number"],
        ["2026-09-01", " SC680-251406233 ", "x", "SC680", "2514-L01"],
        ["", "", "", "", ""],
      ]),
    ).toEqual([
      { purchaseDate: "2026-09-01", serial: "SC680-251406233", modelCode: "SC680", batchNumber: "2514-L01" },
    ]);
  });

  it("reads back its own templates", async () => {
    const fromCsv = rowsFromMatrix(await readSheet("t.csv", Buffer.from(templateCsv())));
    const fromXlsx = rowsFromMatrix(await readSheet("t.xlsx", await templateXlsx()));
    expect(fromCsv).toEqual(fromXlsx);
    expect(fromCsv[0]).toMatchObject({
      serial: "SC680-243500101",
      batchNumber: "2435-L02",
      modelCode: "SC680",
      purchaseDate: "2026-09-15",
      state: "TX",
      zip: "77002",
      customerEmail: "",
    });
  });

  it("accepts a US-format purchase date (M/D/YYYY or MM-DD-YYYY) and converts it to ISO", () => {
    expect(normalizeSheetDate("9/15/2026")).toBe("2026-09-15");
    expect(normalizeSheetDate("09/15/2026")).toBe("2026-09-15");
    expect(normalizeSheetDate("09-15-2026")).toBe("2026-09-15");
    expect(normalizeSheetDate("1/1/2026")).toBe("2026-01-01");
  });

  it("leaves an already-ISO date, and an unrecognised or invalid date, unchanged", () => {
    expect(normalizeSheetDate("2026-09-15")).toBe("2026-09-15");
    expect(normalizeSheetDate("")).toBe("");
    expect(normalizeSheetDate("not a date")).toBe("not a date");
    // Feb 30 doesn't exist, and 13 isn't a month: never silently accepted.
    expect(normalizeSheetDate("02/30/2026")).toBe("02/30/2026");
    expect(normalizeSheetDate("13/01/2026")).toBe("13/01/2026");
  });

  it("normalises Purchase date in a row the same way", () => {
    expect(
      rowsFromMatrix([
        ["Serial number", "Model", "Purchase date"],
        ["SC680-251406233", "SC680", "9/15/2026"],
      ]),
    ).toEqual([{ serial: "SC680-251406233", modelCode: "SC680", purchaseDate: "2026-09-15" }]);
  });

  it("reads the W1 sample file: 25 rows, one without a purchase date", async () => {
    const file = join(__dirname, "../../../../demo-assets/lonestar_sales_week38.xlsx");
    const rows = rowsFromMatrix(await readSheet("lonestar_sales_week38.xlsx", readFileSync(file)));
    expect(rows).toHaveLength(25);
    expect(rows.filter((r) => !r.purchaseDate)).toHaveLength(1);
    expect(rows.every((r) => /^\d{4}-L0\d$/.test(r.batchNumber ?? ""))).toBe(true);
  });
});

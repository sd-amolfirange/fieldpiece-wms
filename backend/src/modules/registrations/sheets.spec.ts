import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseCsv, readSheet, rowsFromMatrix, templateCsv, templateXlsx } from "./sheets";

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
        ["2026-09-01", " 251406233 ", "x", "SC680", "2514-L01"],
        ["", "", "", "", ""],
      ]),
    ).toEqual([
      { purchaseDate: "2026-09-01", serial: "251406233", modelCode: "SC680", batchNumber: "2514-L01" },
    ]);
  });

  it("reads back its own templates", async () => {
    const fromCsv = rowsFromMatrix(await readSheet("t.csv", Buffer.from(templateCsv())));
    const fromXlsx = rowsFromMatrix(await readSheet("t.xlsx", await templateXlsx()));
    expect(fromCsv).toEqual(fromXlsx);
    expect(fromCsv[0]).toMatchObject({
      serial: "243500101",
      batchNumber: "2435-L02",
      modelCode: "SC680",
      purchaseDate: "2026-09-15",
      state: "TX",
      zip: "77002",
      customerEmail: "",
    });
  });

  it("reads the W1 sample file: 25 rows, one without a purchase date", async () => {
    const file = join(__dirname, "../../../../demo-assets/lonestar_sales_week38.xlsx");
    const rows = rowsFromMatrix(await readSheet("lonestar_sales_week38.xlsx", readFileSync(file)));
    expect(rows).toHaveLength(25);
    expect(rows.filter((r) => !r.purchaseDate)).toHaveLength(1);
    expect(rows.every((r) => /^\d{4}-L0\d$/.test(r.batchNumber ?? ""))).toBe(true);
  });
});

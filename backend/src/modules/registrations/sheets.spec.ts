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
        ["Install date", "Serial number", "Unknown", "Model code"],
        ["2026-09-01", " AER-1 ", "x", "AER-SPL15"],
        ["", "", "", ""],
      ]),
    ).toEqual([{ installDate: "2026-09-01", serial: "AER-1", modelCode: "AER-SPL15" }]);
  });

  it("reads back its own templates", async () => {
    const fromCsv = rowsFromMatrix(await readSheet("t.csv", Buffer.from(templateCsv())));
    const fromXlsx = rowsFromMatrix(await readSheet("t.xlsx", await templateXlsx()));
    expect(fromCsv).toEqual(fromXlsx);
    expect(fromCsv[0]).toMatchObject({ serial: "AER-SPL15-260999", installDate: "2026-09-15", customerEmail: "" });
  });

  it("reads the W1 demo file: 25 rows", async () => {
    const file = join(__dirname, "../../../../demo-assets/coolair_sales_week38.xlsx");
    const rows = rowsFromMatrix(await readSheet("coolair_sales_week38.xlsx", readFileSync(file)));
    expect(rows).toHaveLength(25);
    expect(rows.filter((r) => !r.installDate)).toHaveLength(1);
  });
});

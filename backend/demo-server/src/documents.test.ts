import { readFileSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";
import {
  createSeed,
  createSessionStore,
  DEMO_PASSWORD,
  dispatch,
  rowsFromMatrix,
  type DemoDb,
} from "./core/index";
import { readSheet, templateXlsx } from "./documents";

// Reading bulk sheets (the server's part of DL02), with the walkthrough file from demo-assets (W1): 25 rows, an
// unknown model, a serial that's already registered and a missing purchase date.

const TODAY = "2026-09-28";

describe("bulk sheets", () => {
  it("W1: imports the Lone Star sample sheet like the backend does", async () => {
    const file = readFileSync(
      fileURLToPath(new URL("../../../demo-assets/lonestar_sales_week38.xlsx", import.meta.url)),
    );
    const sheet = await readSheet("lonestar_sales_week38.xlsx", file);
    const db: DemoDb = { state: createSeed(TODAY), today: () => TODAY };
    const sessions = createSessionStore();
    const login = dispatch(db, sessions, {
      method: "POST",
      path: "/auth/login",
      query: {},
      body: { email: "dealer.lonestar@wms.local", password: DEMO_PASSWORD },
    });
    const res = dispatch(db, sessions, {
      method: "POST",
      path: "/bulk-imports",
      query: {},
      body: { name: "lonestar_sales_week38.xlsx" },
      file: { name: "lonestar_sales_week38.xlsx", mime: "application/octet-stream", size: file.length },
      sheet,
      accessToken: (login.body as { accessToken: string }).accessToken,
    });
    expect(res.status).toBe(201);
    expect((res.body as { counts: unknown }).counts).toEqual({
      total: 25,
      registered: 22,
      errors: 2,
      review: 1,
    });
  });

  it("writes a template the reader understands", async () => {
    const rows = rowsFromMatrix(await readSheet("template.xlsx", await templateXlsx()));
    expect(rows).toEqual([
      {
        serial: "243500101",
        batchNumber: "2435-L02",
        modelCode: "SC680",
        purchaseDate: "2026-09-15",
        customerName: "Alex Rivera",
        customerPhone: "(713) 555-0100",
        customerEmail: "",
        city: "Houston",
        state: "TX",
        zip: "77002",
        invoiceNumber: "INV-10001",
      },
    ]);
  });
});

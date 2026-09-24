import zxing from "@zxing/library";
import { readFileSync } from "node:fs";
import { appUrl, expect, isoDay, present, resetDemoData, rolePage, shownDate, test } from "./fixtures";

// CommonJS package: take the classes from the default export.
const { BinaryBitmap, HybridBinarizer, QRCodeReader, RGBLuminanceSource } = zxing;

// W2 – Customer self-registration by QR (docs/demo-workflows.md). Logins: customer R. Kulkarni (phone), admin.
// The QR label is decoded exactly as a phone camera would read it; the real camera is a manual check.

const SERIAL = "AER-SPL15-240917";

/** Reads the QR label SVG that A05 renders (black rects on white) and returns the encoded text. */
function decodeQrSvg(dataUrl: string): string {
  const svg = decodeURIComponent(present(dataUrl.split(",")[1], "QR image data"));
  const size = Number(present(/width="(\d+)"/.exec(svg), "QR size")[1]);
  const lum = new Uint8ClampedArray(size * size).fill(255);
  for (const m of svg.matchAll(/<rect ([^>]*)\/?>/g)) {
    const a = Object.fromEntries([...(m[1] ?? "").matchAll(/(\w+)="([^"]*)"/g)].map((x) => [x[1], x[2]]));
    if (a.fill && /^#?(fff|ffffff|white)$/i.test(a.fill)) continue;
    const [x, y, w, h] = ["x", "y", "width", "height"].map((k) => Math.round(Number(a[k] ?? 0))) as [
      number,
      number,
      number,
      number,
    ];
    for (let yy = y; yy < y + h && yy < size; yy += 1)
      for (let xx = x; xx < x + w && xx < size; xx += 1) lum[yy * size + xx] = 0;
  }
  const bitmap = new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(lum, size, size)));
  return new QRCodeReader().decode(bitmap).getText();
}

test("W2: customer self-registration by QR", async ({ browser, baseURL }) => {
  await resetDemoData(browser, appUrl(baseURL));
  const admin = await rolePage(browser, "admin", appUrl(baseURL));
  const customer = await rolePage(browser, "customer", appUrl(baseURL));
  const purchase = isoDay(-4);

  await test.step("1. CU01: scan the QR on the unit; serial and model filled in", async () => {
    await admin.goto(`/units/${SERIAL}`);
    const img = admin.getByRole("img", { name: `QR code for ${SERIAL}` });
    const url = new URL(decodeQrSvg(present(await img.getAttribute("src"), "QR image")));
    await customer.goto(`${url.pathname}${url.search}`);
    await expect(customer.getByText("Details read from the QR label on your unit.")).toBeVisible();
    await expect(customer.getByText(SERIAL)).toBeVisible();
    await expect(customer.getByText("Aeris Split 1.5 TR (AER-SPL15)")).toBeVisible();
  });

  await test.step("2. CU01: purchase date, invoice photo, submit: Pending approval", async () => {
    await customer.getByLabel("Purchase date").fill(purchase);
    const photo = await admin.screenshot({ type: "jpeg", clip: { x: 0, y: 0, width: 600, height: 800 } });
    await customer
      .locator('input[type="file"]')
      .setInputFiles({ name: "invoice.jpg", mimeType: "image/jpeg", buffer: photo });
    await customer.getByRole("button", { name: "Register product" }).click();
    await expect(customer.getByRole("heading", { name: "Registration sent" })).toBeVisible();
    await expect(customer.getByText("Pending", { exact: true })).toBeVisible();
  });

  let reviewLink = "";
  await test.step("3. A02: the registration is in the inbox with a Portal badge", async () => {
    await admin.goto("/registrations");
    const row = admin.getByRole("table").locator("tbody tr", { hasText: SERIAL }).first();
    await expect(row).toContainText(/Portal/i);
    await expect(row).toContainText(/Pending/i);
    reviewLink = present(await row.getByRole("link").first().getAttribute("href"), "review link");
  });

  await test.step("4. A03: the invoice image next to the data; approve", async () => {
    await admin.goto(reviewLink);
    await expect(admin.getByRole("heading", { name: "Invoice" })).toBeVisible();
    const file = await admin.request.get(
      present(await admin.locator("object").getAttribute("data"), "invoice URL"),
    );
    expect(file.headers()["content-type"]).toMatch(/^image\/jpeg/);
    await admin.getByRole("button", { name: "Approve" }).click();
    await expect(admin.getByRole("link", { name: "Open unit" })).toBeVisible();
  });

  await test.step("5. A05: unit 1 year, compressor 10 years, PCB 5 years; QR and certificate", async () => {
    await admin.goto(`/units/${SERIAL}`);
    const rows = admin.getByRole("table").locator("tbody tr");
    const year = Number(purchase.slice(0, 4));
    for (const [part, years] of [
      ["Unit", 1],
      ["Compressor", 10],
      ["PCB", 5],
    ] as const) {
      await expect(rows.filter({ hasText: part }).first()).toContainText(
        shownDate(`${year + years}${purchase.slice(4)}`),
      );
    }
    await expect(admin.getByRole("heading", { name: "QR label" })).toBeVisible();
    const [download] = await Promise.all([
      admin.waitForEvent("download"),
      admin.getByRole("button", { name: "Warranty certificate (PDF)" }).click(),
    ]);
    expect(
      readFileSync(present(await download.path(), "download"))
        .subarray(0, 4)
        .toString(),
    ).toBe("%PDF");
  });

  await test.step("6. A06: part warranty periods come from the model template", async () => {
    await admin.goto("/models");
    await admin.getByRole("link", { name: "Aeris Split 1.5 TR (AER-SPL15)" }).click();
    const table = admin.getByRole("table");
    await expect(table.getByText("10 years")).toBeVisible();
    await expect(table.getByText("5 years")).toBeVisible();
    await expect(table.getByText("1 year")).toBeVisible();
  });

  await test.step("7. CU03: on the phone, open the unit and download the certificate", async () => {
    await customer.goto(`/units/${SERIAL}`);
    await expect(customer.locator("main ul li", { hasText: "Compressor" }).first()).toBeVisible();
    const [download] = await Promise.all([
      customer.waitForEvent("download"),
      customer.getByRole("button", { name: "Warranty certificate (PDF)" }).click(),
    ]);
    expect(
      readFileSync(present(await download.path(), "download"))
        .subarray(0, 4)
        .toString(),
    ).toBe("%PDF");
  });
});

import zxing from "@zxing/library";
import { readFileSync } from "node:fs";
import {
  appUrl,
  expect,
  isoDay,
  present,
  receiptPhoto,
  resetDemoData,
  rolePage,
  shownDate,
  test,
  warrantyEnd,
} from "./fixtures";

// CommonJS package: take the classes from the default export.
const { BinaryBitmap, HybridBinarizer, QRCodeReader, RGBLuminanceSource } = zxing;

// W2 – Customer self-registration by QR (docs/demo-workflows.md). Logins: customer Marcus Reed (phone), admin.
// The QR label is decoded exactly as a phone camera would read it; the real camera is a manual check.

const SERIAL = "261804517";
const BATCH = "2618-L02";
const MODEL = "SMAN Wireless 4-Port Digital Manifold (SM482V)";

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

  await test.step("1. CU01: scan the QR on the product; serial, model and batch filled in", async () => {
    await admin.goto(`/units/${SERIAL}`);
    const img = admin.getByRole("img", { name: `QR code for ${SERIAL}` });
    const url = new URL(decodeQrSvg(present(await img.getAttribute("src"), "QR image")));
    expect(url.searchParams.get("batch")).toBe(BATCH);
    await customer.goto(`${url.pathname}${url.search}`);
    await expect(customer.getByText("Details read from the QR label on your product.")).toBeVisible();
    await expect(customer.getByText(SERIAL)).toBeVisible();
    await expect(customer.getByText(BATCH)).toBeVisible();
    await expect(customer.getByText(MODEL)).toBeVisible();
  });

  await test.step("2. CU01: purchase date, receipt photo, submit: Pending approval", async () => {
    await customer.getByLabel("Purchase date").fill(purchase);
    await customer.locator('input[type="file"]').setInputFiles(await receiptPhoto(admin));
    await customer.getByRole("button", { name: "Register product" }).click();
    await expect(customer.getByRole("heading", { name: "Registration sent" })).toBeVisible();
    await expect(customer.getByText("Pending", { exact: true })).toBeVisible();
  });

  let reviewLink = "";
  await test.step("3. A02: the registration is in the inbox with a Customer portal badge", async () => {
    await admin.goto("/registrations");
    const row = admin.getByRole("table").locator("tbody tr", { hasText: SERIAL }).first();
    await expect(row).toContainText("Customer portal");
    await expect(row).toContainText(/Pending/i);
    await expect(row).toContainText(BATCH);
    reviewLink = present(await row.getByRole("link").first().getAttribute("href"), "review link");
  });

  await test.step("4. A03: the receipt image next to the data; approve", async () => {
    await admin.goto(reviewLink);
    await expect(admin.getByRole("heading", { name: "Receipt or invoice" })).toBeVisible();
    const file = await admin.request.get(
      present(await admin.locator("object").getAttribute("data"), "receipt URL"),
    );
    expect(file.headers()["content-type"]).toMatch(/^image\/jpeg/);
    await admin.getByRole("button", { name: "Approve" }).click();
    await expect(admin.getByRole("link", { name: "Open product" })).toBeVisible();
  });

  await test.step("5. A05: 1-year warranty from the purchase date; QR label and certificate", async () => {
    await admin.goto(`/units/${SERIAL}`);
    const warranty = admin.getByRole("tabpanel");
    await expect(warranty).toContainText(shownDate(purchase));
    await expect(warranty).toContainText(shownDate(warrantyEnd(purchase)));
    await expect(warranty).toContainText("Active");
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

  await test.step("6. A06: the warranty term comes from the product catalog", async () => {
    await admin.goto("/models");
    await admin.getByRole("link", { name: MODEL }).click();
    await expect(admin).toHaveURL(/\/models\/m-sm482v$/);
    await expect(admin.getByText("12-month warranty")).toBeVisible();
    await expect(admin.getByText("On the date of purchase")).toBeVisible();
  });

  await test.step("7. CU03: on the phone, open the product and download the certificate", async () => {
    await customer.goto(`/units/${SERIAL}`);
    await expect(customer.getByText(/In warranty for \d+ more days/)).toBeVisible();
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

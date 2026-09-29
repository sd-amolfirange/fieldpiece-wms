import { appUrl, expect, isoDay, resetDemoData, rolePage, test } from "./fixtures";

// W1 – Dealer bulk registration (docs/demo-workflows.md). Logins: dealer Lone Star Refrigeration Supply, admin.
// The sheet has 25 rows: an unknown model (row 8), a serial that's already registered (row 14) and a missing
// purchase date (row 20).

const XLSX = "../demo-assets/lonestar_sales_week38.xlsx";

test("W1: dealer bulk registration", async ({ browser, baseURL }) => {
  await resetDemoData(browser, appUrl(baseURL));
  const admin = await rolePage(browser, "admin", appUrl(baseURL));
  const dealer = await rolePage(browser, "dealer", appUrl(baseURL));

  const dealerBar = async () => {
    await admin.goto("/");
    const card = admin.locator("section", {
      has: admin.getByRole("heading", { name: "Registrations by channel" }),
    });
    await card.getByRole("button", { name: "View data" }).click();
    return Number((await card.locator("tr", { hasText: "Dealer" }).locator("td").last().innerText()).trim());
  };
  const dealerBefore = await dealerBar();

  await test.step("1. DL01 Dealer home: Lone Star sees only its own data", async () => {
    await expect(dealer.getByText("Registrations this month")).toBeVisible();
    await expect(dealer.getByText("Open claims")).toBeVisible();
    const nav = dealer.getByRole("navigation", { name: "Main navigation" });
    await expect(nav.getByRole("link", { name: "Sold products" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Registration channels" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Product catalog" })).toHaveCount(0);
  });

  await test.step("2. DL02: download the template, upload the sheet: 22 registered, 3 flagged", async () => {
    await dealer.goto("/registrations/bulk");
    expect((await dealer.request.get("/api/bulk-imports/template.csv")).ok()).toBe(true);
    expect((await dealer.request.get("/api/bulk-imports/template.xlsx")).ok()).toBe(true);
    await dealer.locator('input[type="file"]').setInputFiles(XLSX);
    await expect(
      dealer.getByText(/25 rows checked: 22 registered, 2 need fixing, 1 sent to the warranty desk/),
    ).toBeVisible();
  });

  await test.step("3. DL02: fix the model and the purchase date inline and resubmit, no re-upload", async () => {
    await dealer.getByLabel("Model, row 8").first().selectOption("SC680");
    await dealer.getByLabel("Purchase date, row 20").first().fill(isoDay(-6));
    await dealer.getByRole("button", { name: "Resubmit 2 fixed rows" }).click();
    await expect(
      dealer.getByText(/25 rows checked: 24 registered, 0 need fixing, 1 sent to the warranty desk/),
    ).toBeVisible();
  });

  await test.step("4. DL04 Sold products: the new products are Active with serial and batch", async () => {
    await dealer.goto("/units?q=2635&pageSize=50");
    const table = dealer.getByRole("table");
    await expect(table.getByText("263510101")).toBeVisible();
    await expect(table.locator("tbody tr", { hasText: "Active" })).toHaveCount(24);
    await expect(table.locator("tbody tr", { hasText: "263510101" })).toContainText("2635-L01");
    await dealer.goto("/units/SC680-263510101");
    await expect(dealer.getByText("1 year from the date of purchase")).toBeVisible();
  });

  await test.step("5. A02 Registration inbox, Duplicates: only the known serial needs a human", async () => {
    await admin.goto("/registrations");
    await admin.getByLabel("Filter by exception").selectOption("DUPLICATE");
    await expect(admin.getByRole("table").getByText("MG44-252811902")).toBeVisible();
    await expect(admin.getByRole("table").locator("tbody tr")).toHaveCount(1);
  });

  await test.step("6. A03: compare with the existing record and reject with a reason", async () => {
    await admin.getByRole("table").getByRole("link", { name: "MG44-252811902" }).click();
    const existing = admin.locator("section", {
      has: admin.getByRole("heading", { name: "Existing record" }),
    });
    await expect(existing.getByText("James Nguyen")).toBeVisible();
    await admin.getByRole("button", { name: "Reject" }).first().click();
    await admin.getByRole("dialog").getByRole("button", { name: "Reject" }).click();
    await expect(admin.getByText(/^Rejected: /)).toBeVisible();
  });

  await test.step("7. A04 Registered products filtered by dealer Lone Star", async () => {
    await admin.goto("/units");
    await admin.getByLabel("Filter by dealer").selectOption({ label: "Lone Star Refrigeration Supply" });
    await expect(admin).toHaveURL(/dealerId=d-lonestar/);
    await expect(admin.getByText("31 results")).toBeVisible();
  });

  await test.step("8. A01: Registrations by channel, Dealer bar +24", async () => {
    expect(await dealerBar()).toBe(dealerBefore + 24);
  });

  await test.step("9. The dealer gets a notification with the result of the upload", async () => {
    await dealer.goto("/");
    await dealer.getByRole("button", { name: /^Notifications/ }).click();
    await expect(
      dealer.getByText("lonestar_sales_week38.xlsx: 22 registered, 2 to fix, 1 sent to the warranty desk."),
    ).toBeVisible();
  });
});

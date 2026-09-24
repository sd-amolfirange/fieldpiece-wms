import { appUrl, expect, isoDay, resetDemoData, rolePage, test } from "./fixtures";

// W1 – Dealer bulk registration (docs/Demo workflows.md). Logins: dealer CoolAir Traders, admin, customer R. Kulkarni.

const XLSX = "../demo-assets/coolair_sales_week38.xlsx";

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

  await test.step("1. DL01 Dealer home: CoolAir sees only its own data", async () => {
    await expect(dealer.getByText("Registrations this month")).toBeVisible();
    await expect(dealer.getByText("Claims in progress")).toBeVisible();
    const nav = dealer.getByRole("navigation", { name: "Main navigation" });
    await expect(nav.getByRole("link", { name: "My sold units" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Models & parts" })).toHaveCount(0);
  });

  await test.step("2. DL02: download the template, upload the sheet: 22 valid, 3 flagged", async () => {
    await dealer.goto("/registrations/bulk");
    expect((await dealer.request.get("/api/bulk-imports/template.csv")).ok()).toBe(true);
    expect((await dealer.request.get("/api/bulk-imports/template.xlsx")).ok()).toBe(true);
    await dealer.locator('input[type="file"]').setInputFiles(XLSX);
    await expect(
      dealer.getByText(/25 rows checked: 22 registered, 2 need fixing, 1 sent to admin review/),
    ).toBeVisible();
  });

  await test.step("3. DL02: fix the date and the model code inline and resubmit, no re-upload", async () => {
    await dealer.getByLabel("Model code, row 8").first().selectOption("AER-SPL15");
    await dealer.getByLabel("Install date, row 23").first().fill(isoDay(-6));
    await dealer.getByRole("button", { name: "Resubmit 2 fixed rows" }).click();
    await expect(
      dealer.getByText(/25 rows checked: 24 registered, 0 need fixing, 1 sent to admin review/),
    ).toBeVisible();
  });

  await test.step("4. DL04 My sold units: new units Active with their parts", async () => {
    await dealer.goto("/units?q=2609&pageSize=50");
    const table = dealer.getByRole("table");
    await expect(table.getByText("AER-SPL15-260901")).toBeVisible();
    await expect(table.locator("tbody tr", { hasText: "Active" })).toHaveCount(24);
    await dealer.goto("/units/AER-SPL15-260901");
    await expect(dealer.getByRole("table").getByText("Compressor")).toBeVisible();
  });

  await test.step("5. A02 Registration inbox, Exceptions: only the duplicate needs a human", async () => {
    await admin.goto("/registrations");
    await admin.getByLabel("Filter by exception").selectOption("EXCEPTION");
    await expect(admin.getByRole("table").getByText("AER-SPL15-250301")).toBeVisible();
    await expect(admin.getByRole("table").locator("tbody tr")).toHaveCount(1);
  });

  await test.step("6. A03: compare with the existing record and reject with a reason", async () => {
    await admin.getByRole("table").getByRole("link", { name: "AER-SPL15-250301" }).click();
    const existing = admin.locator("section", {
      has: admin.getByRole("heading", { name: "Existing record" }),
    });
    await expect(existing.getByText("S. Deshpande")).toBeVisible();
    await admin.getByRole("button", { name: "Reject" }).first().click();
    await admin.getByRole("dialog").getByRole("button", { name: "Reject" }).click();
    await expect(admin.getByText(/^Rejected: /)).toBeVisible();
  });

  await test.step("7. A04 Units filtered by dealer CoolAir Traders", async () => {
    await admin.goto("/units");
    await admin.getByLabel("Filter by dealer").selectOption({ label: "CoolAir Traders" });
    await expect(admin).toHaveURL(/dealerId=d-coolair/);
    await expect(admin.getByText("31 results")).toBeVisible();
  });

  await test.step("8. A01: Registrations by channel, Dealer bar +24", async () => {
    expect(await dealerBar()).toBe(dealerBefore + 24);
  });

  await test.step("9. CU02: the customer sees the new unit, with a notification", async () => {
    const customer = await rolePage(browser, "customer", appUrl(baseURL));
    await expect(customer.getByText("AER-SPL15-260901")).toBeVisible();
    await customer.getByRole("button", { name: /^Notifications/ }).click();
    await expect(customer.getByText("AER-SPL15-260901 is registered and under warranty.")).toBeVisible();
  });
});

import { appUrl, expect, resetDemoData, rolePage, test } from "./fixtures";

// W7 – Distributor oversight (docs/demo-workflows.md). Logins: admin, distributor Gulf States HVAC Distribution.

test("W7: distributor oversight", async ({ browser, baseURL }) => {
  await resetDemoData(browser, appUrl(baseURL));
  const admin = await rolePage(browser, "admin", appUrl(baseURL));
  const distributor = await rolePage(browser, "distributor", appUrl(baseURL));
  const cells = async (row: ReturnType<typeof distributor.locator>) =>
    (await row.locator("td").allInnerTexts()).map((c) => c.trim());

  await test.step("1. A11: Gulf States with its two dealers", async () => {
    await admin.goto("/admin/dealers");
    const card = admin
      .locator("section", { has: admin.getByRole("heading", { name: "Gulf States HVAC Distribution" }) })
      .last();
    await expect(card.getByRole("listitem")).toHaveCount(2);
    await expect(card).toContainText("Lone Star Refrigeration Supply");
    await expect(card).toContainText("Bayou Air Parts");
  });

  const comparison = distributor.locator("section", {
    has: distributor.getByRole("heading", { name: "Dealer comparison" }),
  });

  await test.step("2. DL01: totals for both dealers", async () => {
    await distributor.goto("/");
    await expect(comparison.locator("tbody tr")).toHaveCount(2);
    const lonestar = await cells(comparison.locator("tbody tr", { hasText: "Lone Star" }));
    const bayou = await cells(comparison.locator("tbody tr", { hasText: "Bayou Air Parts" }));
    const total = Number(lonestar[1]) + Number(bayou[1]);
    await expect(
      distributor.getByRole("link", { name: `Registrations this month: ${total}. Open the list` }),
    ).toBeVisible();
  });

  await test.step("3. DL01: filter by dealer; compare registrations and open claims", async () => {
    const bayou = await cells(comparison.locator("tbody tr", { hasText: "Bayou Air Parts" }));
    await distributor.getByLabel("Show").selectOption({ label: "Bayou Air Parts" });
    await expect(
      distributor.getByRole("link", { name: `Registrations this month: ${bayou[1]}. Open the list` }),
    ).toBeVisible();
    await expect(
      distributor.getByRole("link", { name: `Open claims: ${bayou[3]}. Open the list` }),
    ).toBeVisible();
  });

  await test.step("4. DL04: Sold products filtered to Bayou Air Parts", async () => {
    await distributor.goto("/units");
    await expect(distributor.locator("table tbody tr").first()).toBeVisible();
    await distributor.locator("#units-dealer").selectOption({ label: "Bayou Air Parts" });
    await expect(distributor).toHaveURL(/dealerId=d-bayou/);
    const rows = distributor.locator("table tbody tr");
    await expect(rows.first()).toContainText("Bayou Air Parts");
    await expect(rows.filter({ hasText: "Lone Star" })).toHaveCount(0);
  });

  await test.step("5. DL07: claims on its dealers' products only, read-only", async () => {
    await distributor.goto("/claims");
    const rows = distributor.locator("table tbody tr");
    await expect(rows.first()).toBeVisible();
    await expect(rows.filter({ hasText: "Desert Peak" })).toHaveCount(0);
    await rows.first().getByRole("link").first().click();
    await expect(distributor.getByText("Progress").first()).toBeVisible();
    await expect(
      distributor.getByRole("button", { name: /Start review|Approve|Reject|Close claim/ }),
    ).toHaveCount(0);
  });
});

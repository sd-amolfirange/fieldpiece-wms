import { appUrl, expect, resetDemoData, rolePage, test } from "./fixtures";

// W7 – Distributor oversight (docs/demo-workflows.md). Logins: admin, distributor NorthStar Distribution.

test("W7: distributor oversight", async ({ browser, baseURL }) => {
  await resetDemoData(browser, appUrl(baseURL));
  const admin = await rolePage(browser, "admin", appUrl(baseURL));
  const distributor = await rolePage(browser, "distributor", appUrl(baseURL));
  const cells = async (row: ReturnType<typeof distributor.locator>) =>
    (await row.locator("td").allInnerTexts()).map((c) => c.trim());

  await test.step("1. A11: NorthStar with its two dealers", async () => {
    await admin.goto("/admin/dealers");
    const card = admin
      .locator("section", { has: admin.getByRole("heading", { name: "NorthStar Distribution" }) })
      .last();
    await expect(card.getByRole("listitem")).toHaveCount(2);
    await expect(card).toContainText("CoolAir Traders");
    await expect(card).toContainText("Breeze Point");
  });

  const comparison = distributor.locator("section", {
    has: distributor.getByRole("heading", { name: "Dealer comparison" }),
  });

  await test.step("2. DL01: totals for both dealers", async () => {
    await distributor.goto("/");
    await expect(comparison.locator("tbody tr")).toHaveCount(2);
    const coolair = await cells(comparison.locator("tbody tr", { hasText: "CoolAir Traders" }));
    const breeze = await cells(comparison.locator("tbody tr", { hasText: "Breeze Point" }));
    const total = Number(coolair[1]) + Number(breeze[1]);
    await expect(
      distributor.getByRole("link", { name: `Registrations this month: ${total}. Open the list` }),
    ).toBeVisible();
  });

  await test.step("3. DL01: filter by dealer; compare registrations and open complaints", async () => {
    const breeze = await cells(comparison.locator("tbody tr", { hasText: "Breeze Point" }));
    await distributor.getByLabel("Show").selectOption({ label: "Breeze Point" });
    await expect(
      distributor.getByRole("link", { name: `Registrations this month: ${breeze[1]}. Open the list` }),
    ).toBeVisible();
    await expect(
      distributor.getByRole("link", { name: `Open complaints: ${breeze[3]}. Open the list` }),
    ).toBeVisible();
  });

  await test.step("4. DL04: My sold units filtered to Breeze Point", async () => {
    await distributor.goto("/units");
    await expect(distributor.locator("table tbody tr").first()).toBeVisible();
    await distributor.locator("#units-dealer").selectOption({ label: "Breeze Point" });
    await expect(distributor).toHaveURL(/dealerId=d-breeze/);
    const rows = distributor.locator("table tbody tr");
    await expect(rows.first()).toContainText("Breeze Point");
    await expect(rows.filter({ hasText: "CoolAir Traders" })).toHaveCount(0);
  });
});

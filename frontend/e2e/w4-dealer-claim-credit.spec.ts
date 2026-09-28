import { appUrl, expect, present, resetDemoData, rolePage, test } from "./fixtures";

// W4 – Dealer files a claim for a customer, settled by credit (docs/demo-workflows.md). Logins: dealer Lone Star
// (tablet), admin. The credit is posted to Finance when the claim is closed.

const UNIT = "252811902";

test("W4: dealer claim settled by credit", async ({ browser, baseURL }) => {
  await resetDemoData(browser, appUrl(baseURL));
  const admin = await rolePage(browser, "admin", appUrl(baseURL));
  const dealer = await rolePage(browser, "dealer", appUrl(baseURL));
  let claimId = "";

  await test.step("1. DL06: the dealer files a claim for its customer", async () => {
    await dealer.goto(`/units/${UNIT}`);
    await dealer.getByRole("link", { name: "File a claim" }).click();
    await expect(dealer.getByText(`Warranty coverage for ${UNIT}`)).toBeVisible();
    await dealer.getByLabel("What's wrong").selectOption({ label: "Bluetooth / Job Link connection" });
    await dealer
      .getByLabel(/Description/)
      .fill("Gauge drops the Job Link connection every few minutes; replaced batteries, same result.");
    await dealer.getByRole("button", { name: "Submit claim" }).click();
    await expect(dealer.getByText("Progress").first()).toBeVisible();
    claimId = present(dealer.url().split("/claims/")[1], "claim id");
  });

  await test.step("2. DL07: the dealer follows the claim but can't decide it", async () => {
    await dealer.goto("/claims");
    const row = dealer.locator("table tbody tr", { hasText: claimId });
    await expect(row.getByRole("list", { name: "Claim progress" })).toBeVisible();
    await dealer.goto(`/claims/${claimId}`);
    await expect(dealer.getByRole("button", { name: /Start review|Approve|Reject|Close claim/ })).toHaveCount(
      0,
    );
  });

  await test.step("3. A10: start review and approve a credit in US dollars", async () => {
    await admin.goto(`/claims/${claimId}`);
    await admin.getByRole("button", { name: "Start review" }).click();
    await expect(admin.getByText("Review started").first()).toBeVisible();
    await admin.getByRole("button", { name: "Approve" }).click();
    const dialog = admin.getByRole("dialog");
    await dialog.getByLabel(/Resolution/).selectOption({ label: "Credit" });
    await dialog.getByLabel(/Credit amount \(USD\)/).fill("89.50");
    await dialog.getByRole("button", { name: "Approve" }).click();
    await expect(admin.getByText("Approved for a credit of $89.50.")).toBeVisible();
  });

  await test.step("4. A10: close the claim; the credit is issued", async () => {
    await admin.getByRole("button", { name: "Close claim" }).click();
    await admin.getByRole("dialog").getByRole("button", { name: "Close claim" }).click();
    await expect(admin.getByText("Credit of $89.50 issued.")).toBeVisible();
  });

  await test.step("5. A12: an outbound credit memo to Finance with the claim", async () => {
    await admin.goto("/admin/integrations");
    const memo = admin.locator("table tbody tr", { hasText: "Credit memo" }).first();
    await expect(memo).toContainText("Finance");
    await expect(memo).toContainText(/Outbound/i);
    await memo.getByRole("button", { name: "View payload" }).click();
    await expect(admin.locator("pre")).toContainText(claimId);
    await admin.keyboard.press("Escape");
  });

  await test.step("6. DL07: the dealer sees the claim closed with the credit", async () => {
    await dealer.goto("/claims");
    const row = dealer.locator("table tbody tr", { hasText: claimId });
    await expect(row).toContainText("Credit");
    await expect(row).toContainText("$89.50");
  });
});

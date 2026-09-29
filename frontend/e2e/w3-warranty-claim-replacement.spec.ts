import { appUrl, expect, present, receiptPhoto, resetDemoData, rolePage, test } from "./fixtures";

// W3 – Warranty claim settled by replacement (docs/demo-workflows.md). Logins: customer Marcus Reed (phone), admin.
// The customer files a claim on an in-warranty clamp meter; the warranty desk reviews, approves a replacement and
// closes the claim with the new serial, which is registered to the customer with the rest of the warranty.

const UNIT = "SC680-251406233";
const REPLACEMENT = "SC680-263899901";

test("W3: warranty claim settled by replacement", async ({ browser, baseURL }) => {
  await resetDemoData(browser, appUrl(baseURL));
  const admin = await rolePage(browser, "admin", appUrl(baseURL));
  const customer = await rolePage(browser, "customer", appUrl(baseURL));
  let claimId = "";

  await test.step("1. CU04: pick the product, see the coverage, describe the problem, add a photo", async () => {
    await customer.goto("/claims/new");
    await customer.getByLabel("Product").selectOption({ value: UNIT });
    await expect(customer.getByText(/In warranty until .+\. The claim is covered\./)).toBeVisible();
    await customer.getByLabel("What's wrong").selectOption({ label: "Display problem" });
    await customer
      .getByLabel(/Description/)
      .fill("The display goes blank when the head swivels past 90 degrees.");
    await customer.locator('input[type="file"]').setInputFiles(await receiptPhoto(admin));
    await customer.getByRole("button", { name: "Submit claim" }).click();
    await expect(customer.getByText("Progress").first()).toBeVisible();
    claimId = present(customer.url().split("/claims/")[1], "claim id");
    await expect(customer.getByText("Submitted").first()).toBeVisible();
  });

  await test.step("2. A09: the new claim is counted and listed", async () => {
    await admin.goto("/claims");
    await expect(admin.getByRole("link", { name: /^Submitted: \d+ claims/ })).toBeVisible();
    const row = admin.locator("table tbody tr", { hasText: claimId });
    await expect(row).toContainText(UNIT);
    await expect(row).toContainText("Display problem");
    await expect(row).toContainText("Customer");
  });

  await test.step("3. A10: coverage when filed, the photo; start review and approve a replacement", async () => {
    await admin.goto(`/claims/${claimId}`);
    await expect(admin.getByRole("heading", { name: "Coverage when filed" })).toBeVisible();
    await expect(admin.getByText(/The claim is covered\./)).toBeVisible();
    await expect(admin.getByRole("link", { name: /^Open receipt\.jpg/ })).toBeVisible();
    await admin.getByRole("button", { name: "Start review" }).click();
    await expect(admin.getByText("Review started").first()).toBeVisible();
    await admin.getByRole("button", { name: "Approve" }).click();
    const dialog = admin.getByRole("dialog");
    await dialog.getByLabel(/Resolution/).selectOption({ label: "Replace" });
    await dialog.getByRole("button", { name: "Approve" }).click();
    await expect(admin.getByText("Approved for replacement under warranty.")).toBeVisible();
  });

  await test.step("4. A10: close with the replacement's serial and batch", async () => {
    await admin.getByRole("button", { name: "Close claim" }).click();
    const dialog = admin.getByRole("dialog");
    await dialog.getByLabel(/Replacement serial number/).fill(REPLACEMENT);
    await dialog.getByLabel(/Replacement batch number/).fill("2638-L01");
    await dialog.getByRole("button", { name: "Close claim" }).click();
    await expect(admin.getByText(`Replaced under warranty with ${REPLACEMENT}.`)).toBeVisible();
  });

  await test.step("5. A05: the original is marked replaced; the new product carries the warranty", async () => {
    await admin.goto(`/units/${UNIT}`);
    await expect(admin.getByText(`Replaced under warranty by ${REPLACEMENT}`)).toBeVisible();
    await admin.goto(`/units/${REPLACEMENT}`);
    await expect(admin.getByText("Marcus Reed").first()).toBeVisible();
    await expect(admin.getByText("2638-L01").first()).toBeVisible();
    await expect(admin.getByRole("link", { name: UNIT })).toBeVisible();
  });

  await test.step("6. CU05: the customer sees the claim closed, the outcome and the new product", async () => {
    await customer.goto(`/claims/${claimId}`);
    await expect(customer.getByText(`Replaced under warranty with ${REPLACEMENT}.`)).toBeVisible();
    await expect(customer.getByText("Closed").first()).toBeVisible();
    await customer.goto("/");
    await expect(customer.getByText(REPLACEMENT, { exact: true })).toBeVisible();
    await customer.getByRole("button", { name: /^Notifications/ }).click();
    await expect(customer.getByText(`Warranty claim ${claimId} is closed.`)).toBeVisible();
  });
});

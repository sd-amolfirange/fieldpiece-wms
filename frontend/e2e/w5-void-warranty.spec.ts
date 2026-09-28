import { appUrl, expect, present, resetDemoData, rolePage, test } from "./fixtures";

// W5 – Void warranty (docs/demo-workflows.md). Logins: admin, customer Marcus Reed (phone). A third-party repair
// shop opened the leak detector; the warranty desk voids the warranty, and a later claim isn't covered.

const UNIT = "252207119";

test("W5: void warranty", async ({ browser, baseURL }) => {
  await resetDemoData(browser, appUrl(baseURL));
  const admin = await rolePage(browser, "admin", appUrl(baseURL));
  const customer = await rolePage(browser, "customer", appUrl(baseURL));
  let claimId = "";

  await test.step("1. A05: Void warranty, 'Unauthorized repair' and a note; reason, user and date recorded", async () => {
    await admin.goto(`/units/${UNIT}`);
    await admin.getByRole("button", { name: "Void warranty" }).click();
    const dialog = admin.getByRole("dialog");
    await dialog.getByLabel(/Reason/).selectOption({ label: "Unauthorized repair" });
    await dialog.getByLabel(/Note/).fill("Sensor housing opened by a third-party shop; tamper label broken.");
    await dialog.getByRole("button", { name: "Void warranty" }).click();
    const banner = admin.getByRole("alert").filter({ hasText: "Warranty void" });
    await expect(banner).toContainText("unauthorized repair");
    await expect(banner).toContainText(/Voided by Warranty Desk on/);
    await admin.getByRole("tab", { name: "History" }).click();
    await expect(admin.getByText("voided the warranty: unauthorized repair")).toBeVisible();
  });

  await test.step("2. CU03: the customer sees the product marked Void with the reason", async () => {
    await customer.goto(`/units/${UNIT}`);
    await expect(customer.getByRole("alert").filter({ hasText: "Warranty void" })).toContainText(
      "unauthorized repair",
    );
    await expect(customer.getByText("Void", { exact: true }).first()).toBeVisible();
  });

  await test.step("3. CU04: the claim form shows the product isn't covered", async () => {
    await customer.goto(`/claims/new?serial=${UNIT}`);
    await expect(customer.getByText(/warranty on this product is void/)).toBeVisible();
    await customer.getByLabel("What's wrong").selectOption({ label: "Inaccurate reading" });
    await customer.getByLabel(/Description/).fill("No longer alarms on a known R-410A leak.");
    await customer.getByRole("button", { name: "Submit claim" }).click();
    await expect(customer.getByText("Progress").first()).toBeVisible();
    claimId = present(customer.url().split("/claims/")[1], "claim id");
  });

  await test.step("4. A10: the warranty desk sees the void coverage and rejects with a reason", async () => {
    await admin.goto(`/claims/${claimId}`);
    await expect(admin.getByText(/warranty on this product is void/)).toBeVisible();
    await admin.getByRole("button", { name: "Reject" }).click();
    await admin
      .getByRole("dialog")
      .getByLabel(/Reason/)
      .fill("The warranty was voided after an unauthorized repair.");
    await admin.getByRole("dialog").getByRole("button", { name: "Reject" }).click();
    await expect(admin.getByText(/^Rejected by the warranty desk: /)).toBeVisible();
  });

  await test.step("5. CU05: the customer sees the decision", async () => {
    await customer.goto(`/claims/${claimId}`);
    await expect(customer.getByText(/^Rejected by the warranty desk: /)).toBeVisible();
  });
});

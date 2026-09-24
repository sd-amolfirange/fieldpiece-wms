import { appUrl, expect, present, resetDemoData, rolePage, test } from "./fixtures";

// W3 – Customer complaint, service hand-off and manufacturer claim (docs/demo-workflows.md).
// Logins: customer R. Kulkarni (phone), admin; the simulator steps use A13 as the admin.

const SERIAL = "AER-SPL15-210311";

test("W3: customer complaint to manufacturer claim", async ({ browser, baseURL }) => {
  await resetDemoData(browser, appUrl(baseURL));
  const admin = await rolePage(browser, "admin", appUrl(baseURL));
  const customer = await rolePage(browser, "customer", appUrl(baseURL));
  const header = (page: typeof admin) => page.locator("main").first();
  let complaintId = "";
  let claimId = "";

  await test.step("1. CU03: unit warranty expired, but the compressor is still covered", async () => {
    await customer.goto(`/units/${SERIAL}`);
    await expect(customer.getByText(/Compressor covered until .*20\d\d/).first()).toBeVisible();
    await expect(customer.getByText(/expired/i).first()).toBeVisible();
  });

  await test.step("2. CU04: 'no cooling' with a photo; cover shown before submitting", async () => {
    await customer.getByRole("link", { name: "Raise complaint" }).click();
    await expect(customer.getByText(`What's covered for ${SERIAL}`)).toBeVisible();
    await expect(customer.getByText("Covered: Compressor.")).toBeVisible();
    await expect(customer.getByText("Labour is chargeable.")).toBeVisible();
    await customer.getByLabel(/What's wrong/).fill("No cooling");
    const photo = await admin.screenshot({ type: "jpeg", clip: { x: 0, y: 0, width: 800, height: 600 } });
    await customer
      .locator('input[type="file"]')
      .setInputFiles({ name: "fault.jpg", mimeType: "image/jpeg", buffer: photo });
    await customer.getByRole("button", { name: "Raise complaint" }).click();
    await expect(customer.getByText("Progress")).toBeVisible();
    complaintId = present(customer.url().split("/complaints/")[1], "complaint id");
  });

  await test.step("3. A07: the new complaint is on top with source Customer", async () => {
    await admin.goto("/complaints");
    const first = admin.locator("table tbody tr").first();
    await expect(first).toContainText(complaintId);
    await expect(first).toContainText(SERIAL);
    await expect(first).toContainText(/Customer/i);
  });

  await test.step("4. A08: entitlement panel; Send to service system", async () => {
    await admin.locator("table tbody tr").first().getByRole("link", { name: complaintId }).click();
    await expect(admin.getByRole("heading", { name: "What's covered" })).toBeVisible();
    await admin.getByRole("button", { name: "Send to service system" }).click();
    await expect(header(admin).getByText("With service").first()).toBeVisible();
  });

  await test.step("5. A12: outbound service request with unit, part serials and entitlement", async () => {
    await admin.goto("/admin/integrations");
    const row = admin.locator("table tbody tr", { hasText: complaintId }).first();
    await expect(row).toContainText("Service request");
    await expect(row).toContainText(/Outbound/i);
    await row.getByRole("button", { name: "View payload" }).click();
    const payload = admin.locator("pre");
    await expect(payload).toContainText(SERIAL);
    await expect(payload).toContainText("CP-");
    await expect(payload).toContainText(/entitlement/i);
    await admin.keyboard.press("Escape");
  });

  await test.step("6. A13: the service system returns the job result", async () => {
    await admin.goto("/admin/simulate");
    const option = admin.locator("option", { hasText: complaintId });
    await option.waitFor({ state: "attached" });
    await admin
      .getByLabel("Complaint with service")
      .selectOption({ label: present(await option.textContent(), "option text").trim() });
    await admin.getByLabel("Part replaced").selectOption("COMPRESSOR");
    await admin.getByRole("button", { name: "Send job result" }).click();
    const toast = admin.getByText(/Draft claim CLM-[\w-]+ created/).first();
    await expect(toast).toBeVisible();
    claimId = present(/CLM-[\w-]+/.exec(present(await toast.textContent(), "toast")), "claim id")[0];
  });

  await test.step("7. A08: compressor replaced, old and new serials, photos, sign-off; new warranty from today", async () => {
    await admin.goto(`/complaints/${complaintId}`);
    await expect(admin.getByRole("heading", { name: "Job result" })).toBeVisible();
    await expect(admin.locator("table tbody tr", { hasText: "Compressor" }).first()).toContainText("CP-");
    await expect(admin.getByText(/^Signed by /)).toBeVisible();
    await expect(admin.getByText(/is under warranty until/).first()).toBeVisible();
    expect(await admin.locator("main img").count()).toBeGreaterThanOrEqual(2);
  });

  await test.step("8. A05: part history shows the replacement; claim link added", async () => {
    await admin.goto(`/units/${SERIAL}`);
    await expect(admin.getByText(/Replaced on/).first()).toBeVisible();
    await admin.getByRole("tab", { name: "Service & claim history" }).click();
    await expect(admin.getByText("replaced a part").first()).toBeVisible();
    await expect(admin.getByRole("link", { name: `created claim ${claimId}` })).toBeVisible();
  });

  await test.step("9. A09: the new claim is on top, status Draft", async () => {
    await admin.goto("/claims");
    const first = admin.locator("table tbody tr").first();
    await expect(first).toContainText(claimId);
    await expect(first).toContainText(/Draft/i);
  });

  await test.step("10. A10: evidence from the job result; add RMA number and submit", async () => {
    await admin.locator("table tbody tr").first().getByRole("link", { name: claimId }).click();
    await expect(admin.getByRole("heading", { name: "Evidence from the job result" })).toBeVisible();
    await admin.getByRole("button", { name: "Submit to manufacturer" }).click();
    const dialog = admin.getByRole("dialog");
    await dialog.getByLabel(/RMA number/).fill("RMA-AER-7781");
    await dialog.getByLabel(/Amount claimed/).fill("8500");
    await dialog.getByRole("button", { name: "Submit to manufacturer" }).click();
    await expect(header(admin).getByText("Submitted").first()).toBeVisible();
  });

  await test.step("11. A13: the OEM approves the claim", async () => {
    await admin.goto("/admin/simulate");
    const option = admin.locator("option", { hasText: claimId });
    await option.waitFor({ state: "attached" });
    await admin
      .getByLabel("Submitted claim")
      .selectOption({ label: present(await option.textContent(), "option text").trim() });
    await admin.getByRole("button", { name: "Approve claim" }).click();
    await expect(admin.getByText("The manufacturer approved the claim").first()).toBeVisible();
  });

  await test.step("12. A10: approved -> paid; settlement posted to Finance and logged", async () => {
    await admin.goto(`/claims/${claimId}`);
    await expect(header(admin).getByText("Approved").first()).toBeVisible();
    await admin.getByRole("button", { name: "Mark paid" }).click();
    await expect(header(admin).getByText("Posted to Finance").first()).toBeVisible();
    await admin.goto("/admin/integrations?system=FINANCE");
    await expect(admin.locator("table tbody tr", { hasText: claimId }).first()).toContainText(
      "Finance posting",
    );
  });

  await test.step("13. CU05: the timeline shows Resolved with the new part warranty", async () => {
    await customer.goto(`/complaints/${complaintId}`);
    await expect(customer.getByText(/is under warranty until/).first()).toBeVisible();
    await expect(customer.locator("main section ol li")).toHaveCount(3);
    await expect(customer.locator("main section ol li", { hasText: "Waiting" })).toHaveCount(0);
  });
});

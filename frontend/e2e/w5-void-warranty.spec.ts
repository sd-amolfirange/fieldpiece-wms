import { appUrl, expect, present, resetDemoData, rolePage, test } from "./fixtures";

// W5 – Void warranty and chargeable repair (docs/Demo workflows.md). Logins: admin, customer R. Kulkarni (phone).

const UNIT = "AER-SPL18-230502";

test("W5: void warranty and chargeable repair", async ({ browser, baseURL }) => {
  await resetDemoData(browser, appUrl(baseURL));
  const admin = await rolePage(browser, "admin", appUrl(baseURL));
  const customer = await rolePage(browser, "customer", appUrl(baseURL));
  let complaintId = "";

  await test.step("1. A05: Void warranty, 'Unauthorised repair' and a note; reason, user and date recorded", async () => {
    await admin.goto(`/units/${UNIT}`);
    await admin.getByRole("button", { name: "Void warranty" }).click();
    const dialog = admin.getByRole("dialog");
    await dialog.getByLabel(/Reason/).selectOption({ label: "Unauthorised repair" });
    await dialog.getByLabel(/Note/).fill("PCB cover opened by a local technician, warranty seal broken.");
    await dialog.getByRole("button", { name: "Void warranty" }).click();
    const banner = admin.getByRole("alert").filter({ hasText: "Warranty void" });
    await expect(banner).toContainText("unauthorised repair");
    await expect(banner).toContainText(/Voided by WMS office admin on/);
    await admin.getByRole("tab", { name: "Service & claim history" }).click();
    await expect(admin.getByText("voided the warranty: unauthorised repair")).toBeVisible();
  });

  await test.step("2. CU03: the customer sees the unit marked Void with the reason", async () => {
    await customer.goto(`/units/${UNIT}`);
    await expect(customer.getByRole("alert").filter({ hasText: "Warranty void" })).toContainText(
      "unauthorised repair",
    );
    await expect(customer.getByText("Void", { exact: true }).first()).toBeVisible();
  });

  await test.step("3. CU04: the form shows the visit is chargeable", async () => {
    await customer.goto(`/complaints/new?serial=${UNIT}`);
    await expect(customer.getByText(/warranty on this unit is void/)).toBeVisible();
    await expect(customer.getByText("Chargeable", { exact: true })).toHaveCount(2);
    await customer.getByLabel(/What's wrong/).fill("Not cooling at night");
    await customer.getByRole("button", { name: "Raise complaint" }).click();
    await expect(customer.getByText("Progress").first()).toBeVisible();
    complaintId = present(customer.url().split("/complaints/")[1], "complaint id");
  });

  await test.step("4. A08: entitlement Chargeable; send to service; no claim is created", async () => {
    await admin.goto(`/complaints/${complaintId}`);
    await expect(admin.getByText("Nothing to claim from the manufacturer for this job.")).toBeVisible();
    await admin.getByRole("button", { name: "Send to service system" }).click();
    await expect(admin.getByText("Sent to the service system").first()).toBeVisible();
    // Finish the job in the simulator: still no claim.
    await admin.goto("/admin/simulate");
    const option = admin.locator("option", { hasText: complaintId });
    await option.waitFor({ state: "attached" });
    await admin
      .getByLabel("Complaint with service")
      .selectOption({ label: present(await option.textContent(), "option text").trim() });
    await admin.getByLabel("Part replaced").selectOption("PCB");
    await admin.getByRole("button", { name: "Send job result" }).click();
    await expect(admin.getByText("Job result received").first()).toBeVisible();
    await admin.goto(`/complaints/${complaintId}`);
    await expect(admin.getByRole("heading", { name: "Job result" })).toBeVisible();
    await expect(admin.getByRole("heading", { name: "Manufacturer claim" })).toHaveCount(0);
  });
});

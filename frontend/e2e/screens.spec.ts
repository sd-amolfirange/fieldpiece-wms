import type { Page } from "@playwright/test";
import { appUrl, expect, resetDemoData, rolePage, test } from "./fixtures";

// Every screen's "must contain" list (docs/Demo workflows.md, 25 screens), checked on fresh seed data with the login
// that uses the screen. One step per screen; each assertion is one item of its list.

test("screens: every must-contain item is present", async ({ browser, baseURL }) => {
  test.setTimeout(300_000);
  await resetDemoData(browser, appUrl(baseURL));
  const admin = await rolePage(browser, "admin", appUrl(baseURL));
  const dealer = await rolePage(browser, "dealer", appUrl(baseURL));
  const distributor = await rolePage(browser, "distributor", appUrl(baseURL));
  const customer = await rolePage(browser, "customer", appUrl(baseURL));
  const heading = (page: Page, name: string) => page.getByRole("heading", { name, exact: true });

  await test.step("A01 Admin dashboard", async () => {
    await admin.goto("/");
    for (const card of ["Units", "Active warranties", "Expiring within 30 days", "Expired", "Open claims"]) {
      await expect(admin.getByRole("link", { name: new RegExp(`^${card}: \\d+`) })).toBeVisible();
    }
    await expect(heading(admin, "Registrations by channel")).toBeVisible();
    await expect(heading(admin, "Claims by brand")).toBeVisible();
    await expect(heading(admin, "Expiring soon")).toBeVisible();
    await expect(heading(admin, "Recent activity")).toBeVisible();
  });

  // Two Portal registrations for A02 / A03: a clean one (can be approved) and one that is both a duplicate and a
  // model mismatch (can only be rejected or merged).
  for (const [serial, model] of [
    ["AER-SPL15-240917", "AER-SPL15"],
    ["AER-SPL15-210311", "AER-SPL18"],
  ]) {
    await customer.goto(`/register?serial=${serial}&model=${model}`);
    await customer.getByLabel("Purchase date").fill("2024-01-10");
    await customer.locator('input[type="file"]').setInputFiles({
      name: "invoice.jpg",
      mimeType: "image/jpeg",
      buffer: await admin.screenshot({ type: "jpeg" }),
    });
    await customer.getByRole("button", { name: "Register product" }).click();
    await expect(customer.getByRole("heading", { name: "Registration sent" })).toBeVisible();
  }

  await test.step("A02 Registration inbox", async () => {
    await admin.goto("/registrations");
    await expect(admin.locator("table tbody tr").first()).toBeVisible();
    await expect(admin.getByLabel("Filter by source")).toBeVisible();
    await expect(admin.getByLabel("Filter by status")).toBeVisible();
    const flags = admin.getByLabel("Filter by exception");
    for (const f of ["Exceptions", "Duplicates"])
      await expect(flags.locator("option", { hasText: f })).toHaveCount(1);
    await expect(admin.locator("table tbody tr").first()).toContainText(/Portal|Dealer|Email|ERP/i);
    await admin.getByLabel("Filter by status").selectOption("PENDING");
    await admin.locator("table tbody tr input[type=checkbox]").first().check();
    await expect(admin.getByRole("button", { name: /^Approve 1 selected$/ })).toBeVisible();
  });

  await test.step("A03 Registration review", async () => {
    await admin.goto("/registrations?flag=DUPLICATE");
    await admin.locator("table tbody tr").first().getByRole("link").first().click();
    await expect(heading(admin, "Submitted data")).toBeVisible();
    await expect(heading(admin, "Invoice")).toBeVisible();
    await expect(admin.getByText(/is already registered/).first()).toBeVisible();
    await expect(admin.getByText(/doesn't match the model in our records/)).toBeVisible();
    await expect(admin.getByRole("button", { name: "Reject" }).first()).toBeVisible();
    await expect(admin.getByRole("button", { name: "Merge into existing record" })).toBeVisible();
    // A clean registration can be approved.
    await admin.goto("/registrations?status=PENDING&q=AER-SPL15-240917");
    await admin.locator("table tbody tr").first().getByRole("link").first().click();
    await expect(admin.getByRole("button", { name: "Approve" })).toBeVisible();
  });

  await test.step("A04 Units", async () => {
    await admin.goto("/units");
    await expect(admin.getByPlaceholder("Search serial, customer or dealer")).toBeVisible();
    await expect(admin.locator("table tbody tr").first()).toContainText(
      /Active|Expiring soon|Expired|Void|Pending/i,
    );
    await expect(admin.getByRole("link", { name: "Add unit" })).toBeVisible();
    await expect(admin.getByRole("link", { name: "Bulk upload" })).toBeVisible();
  });

  await test.step("A05 Unit detail", async () => {
    await admin.goto("/units/AER-SPL18-230502");
    const parts = admin.getByRole("table");
    await expect(parts.getByText("Compressor")).toBeVisible();
    await expect(parts.locator("tbody tr").first()).toContainText(/Active|Expiring soon|Expired/i);
    await expect(heading(admin, "QR label")).toBeVisible();
    await expect(admin.getByRole("button", { name: "Warranty certificate (PDF)" })).toBeVisible();
    await expect(admin.getByRole("tab", { name: "Service & claim history" })).toBeVisible();
    await admin.getByRole("button", { name: "Void warranty" }).click();
    await expect(admin.getByRole("dialog").getByLabel(/Reason/)).toBeVisible();
    await admin.keyboard.press("Escape");
  });

  await test.step("A06 Models & parts", async () => {
    await admin.goto("/models");
    await expect(admin.getByText("Aeris").first()).toBeVisible();
    await admin.getByRole("link", { name: "Aeris Split 1.5 TR (AER-SPL15)" }).click();
    await expect(heading(admin, "Model template")).toBeVisible();
    const template = admin.getByRole("table");
    await expect(template.getByText("Compressor")).toBeVisible();
    await expect(template.getByText("10 years")).toBeVisible();
    await expect(template.getByText(/Parts and labour|Parts only/).first()).toBeVisible();
  });

  await test.step("A07 Complaints", async () => {
    await admin.goto("/complaints");
    await expect(admin.getByLabel("Source")).toBeVisible();
    const status = admin.getByLabel("Status");
    for (const s of ["New", "With service", "Resolved"])
      await expect(status.locator("option", { hasText: s })).toHaveCount(1);
    await expect(admin.locator("table tbody tr").first()).toContainText(/Customer|Dealer|Admin/i);
  });

  await test.step("A08 Complaint detail", async () => {
    await admin.goto("/complaints/CMP-1001");
    await expect(heading(admin, "What's covered")).toBeVisible();
    await expect(admin.getByText(/Parts are chargeable|Covered: /).first()).toBeVisible();
    await expect(heading(admin, "Job result")).toBeVisible();
    await expect(admin.getByText(/^Signed by /)).toBeVisible();
    await admin.goto("/complaints?status=NEW");
    await admin.locator("table tbody tr").first().getByRole("link").first().click();
    await admin.getByRole("button", { name: "Send to service system" }).click();
    await expect(admin.getByText("Sent to the service system").first()).toBeVisible();
  });

  await test.step("A09 Claims", async () => {
    await admin.goto("/claims");
    for (const s of ["Submitted", "Approved", "Paid", "Rejected"]) {
      await expect(admin.getByRole("link", { name: new RegExp(`^${s}: \\d+ claims`) })).toBeVisible();
    }
    await expect(admin.getByLabel("Brand")).toBeVisible();
    await expect(admin.getByLabel("Status")).toBeVisible();
  });

  await test.step("A10 Claim detail", async () => {
    // The seed has no Draft claim: the job result for the complaint sent in A08 creates one (as in W3).
    await admin.goto("/admin/simulate");
    await admin.getByRole("button", { name: "Send job result" }).click();
    await expect(admin.getByText(/Draft claim CLM-/).first()).toBeVisible();
    await admin.goto("/claims?status=DRAFT");
    await admin.locator("table tbody tr").first().getByRole("link").first().click();
    await expect(heading(admin, "Evidence from the job result")).toBeVisible();
    await expect(admin.getByText("RMA number").first()).toBeVisible();
    await expect(admin.getByText("Amount claimed").first()).toBeVisible();
    await expect(admin.getByRole("button", { name: "Submit to manufacturer" })).toBeVisible();
    await expect(heading(admin, "Finance posting")).toBeVisible();
    await admin.goto("/claims?status=SUBMITTED");
    await admin.locator("table tbody tr").first().getByRole("link").first().click();
    await expect(admin.getByRole("button", { name: "Approve" })).toBeVisible();
    await expect(admin.getByRole("button", { name: "Reject" })).toBeVisible();
    await admin.goto("/claims?status=APPROVED");
    await admin.locator("table tbody tr").first().getByRole("link").first().click();
    await expect(admin.getByRole("button", { name: "Mark paid" })).toBeVisible();
  });

  await test.step("A11 Dealers & users", async () => {
    await admin.goto("/admin/dealers");
    await expect(heading(admin, "Distributors and their dealers")).toBeVisible();
    await expect(heading(admin, "NorthStar Distribution")).toBeVisible();
    await expect(admin.getByText("dealer.coolair@demo.wms").first()).toBeVisible();
  });

  await test.step("A12 Integration log", async () => {
    await admin.goto("/admin/integrations");
    const systems = admin.getByLabel("System");
    for (const s of ["CRM", "ERP", "Finance", "Service system", "Manufacturer (OEM)"]) {
      await expect(systems.locator("option", { hasText: s })).toHaveCount(1);
    }
    await expect(admin.getByLabel("Direction")).toBeVisible();
    await expect(admin.getByLabel("Status")).toBeVisible();
    await expect(admin.getByRole("button", { name: "Retry" }).first()).toBeVisible();
    await admin.getByRole("button", { name: "View payload" }).first().click();
    await expect(admin.locator("pre")).toBeVisible();
    await admin.keyboard.press("Escape");
  });

  await test.step("A13 Simulate panel", async () => {
    await admin.goto("/admin/simulate");
    for (const b of [
      "ERP sales invoice (3 serials)",
      "Registration email with invoice",
      "Send job result",
      "Approve claim",
      "Reset demo data",
    ]) {
      await expect(admin.getByRole("button", { name: b })).toBeVisible();
    }
  });

  await test.step("DL01 Dealer home (dealer and distributor)", async () => {
    await dealer.goto("/");
    for (const t of [
      "Registrations this month",
      "Pending",
      "Rejected",
      "Open complaints",
      "Claims in progress",
    ]) {
      await expect(dealer.getByText(t, { exact: true })).toBeVisible();
    }
    await distributor.goto("/");
    await expect(distributor.getByLabel("Show")).toBeVisible();
    await expect(heading(distributor, "Dealer comparison")).toBeVisible();
  });

  await test.step("DL02 Bulk import", async () => {
    await dealer.goto("/registrations/bulk");
    await expect(dealer.getByRole("link", { name: "Excel template" })).toBeVisible();
    await expect(dealer.getByRole("link", { name: "CSV template" })).toBeVisible();
    await dealer.locator('input[type="file"]').setInputFiles("../demo-assets/coolair_sales_week38.xlsx");
    await expect(dealer.getByText(/25 rows checked/)).toBeVisible();
    await expect(dealer.getByLabel("Show rows")).toBeVisible();
    await expect(dealer.getByRole("button", { name: /Resubmit/ })).toBeVisible();
    await expect(heading(dealer, "Upload history")).toBeVisible();
  });

  await test.step("DL03 Register a unit", async () => {
    await dealer.goto("/registrations/new");
    await expect(dealer.getByRole("button", { name: "Scan QR label" })).toBeVisible();
    await expect(dealer.getByText("Model").first()).toBeVisible();
    for (const step of ["Unit", "Installation and invoice", "Customer and review"]) {
      await expect(dealer.getByText(step, { exact: true }).first()).toBeVisible();
    }
  });

  await test.step("DL04 My sold units (dealer; distributor sees all its dealers)", async () => {
    await dealer.goto("/units");
    await expect(dealer.locator("main").getByRole("searchbox")).toBeVisible();
    await expect(dealer.locator("table tbody tr").first()).toContainText(
      /Active|Expiring soon|Expired|Void|Pending/i,
    );
    await distributor.goto("/units");
    await expect(distributor.locator("#units-dealer")).toBeVisible();
  });

  await test.step("DL05 Unit detail (read-only)", async () => {
    await dealer.goto("/units/AER-SPL18-251120");
    await expect(dealer.getByRole("table").getByText("Compressor")).toBeVisible();
    await expect(dealer.getByRole("button", { name: "Warranty certificate (PDF)" })).toBeVisible();
    await expect(dealer.getByRole("button", { name: "Void warranty" })).toHaveCount(0);
  });

  await test.step("DL06 Raise complaint", async () => {
    await dealer.goto("/complaints/new?serial=AER-SPL18-251120");
    await expect(dealer.getByText("What's covered for AER-SPL18-251120")).toBeVisible();
    await expect(dealer.locator('input[type="file"]')).toBeAttached();
    await expect(dealer.getByLabel(/What's wrong/)).toBeVisible();
  });

  await test.step("DL07 Complaints & claims", async () => {
    await dealer.goto("/complaints");
    await expect(dealer.getByRole("list", { name: "Progress" }).first()).toBeVisible();
    await dealer.getByRole("tab", { name: "Claims" }).click();
    await expect(dealer.getByText(/you can follow their status here/)).toBeVisible();
    await expect(
      dealer.getByRole("tabpanel").getByRole("button", { name: /Approve|Mark paid|Submit/ }),
    ).toHaveCount(0);
  });

  await test.step("CU01 Register a product", async () => {
    await customer.goto("/register?serial=AER-SPL15-240917&model=AER-SPL15");
    await expect(customer.getByText("Details read from the QR label on your unit.")).toBeVisible();
    await expect(customer.getByLabel("Purchase date")).toBeVisible();
    await expect(customer.getByText("Invoice photo")).toBeVisible();
  });

  await test.step("CU02 My units", async () => {
    await customer.goto("/");
    await expect(customer.getByText("AER-SPL15-210311").first()).toBeVisible();
    await expect(customer.getByText(/Covered for \d+ more days?|covered until/i).first()).toBeVisible();
  });

  await test.step("CU03 Unit detail", async () => {
    await customer.goto("/units/AER-SPL15-210311");
    for (const part of ["Unit", "Compressor", "PCB"]) {
      await expect(customer.locator("main ul li", { hasText: part }).first()).toBeVisible();
    }
    await expect(customer.getByRole("button", { name: "Warranty certificate (PDF)" })).toBeVisible();
    await expect(customer.getByRole("tab", { name: "Service & claim history" })).toBeVisible();
  });

  await test.step("CU04 Raise complaint", async () => {
    await customer.goto("/complaints/new");
    await expect(customer.getByLabel("Unit")).toBeVisible();
    await expect(customer.getByLabel(/What's wrong/)).toBeVisible();
    await expect(customer.locator('input[type="file"]')).toBeAttached();
    await customer.getByLabel("Unit").selectOption({ index: 1 });
    await expect(customer.getByText(/What's covered for /)).toBeVisible();
    await customer.getByLabel(/What's wrong/).fill("No cooling");
    await customer.getByRole("button", { name: "Raise complaint" }).click();
  });

  await test.step("CU05 Complaint tracking (the new part warranty after repair is checked in the W3 spec)", async () => {
    await customer.goto("/complaints");
    await customer.getByRole("link", { name: /^CMP-/ }).first().click();
    const steps = customer.locator("main section ol li");
    await expect(steps).toHaveCount(3);
    await expect(steps.nth(0)).toContainText("Raised");
    await expect(steps.nth(1)).toContainText("With service");
    await expect(steps.nth(2)).toContainText("Resolved");
  });
});

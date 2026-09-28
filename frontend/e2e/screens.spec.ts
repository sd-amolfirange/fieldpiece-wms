import type { Page } from "@playwright/test";
import { appUrl, expect, receiptPhoto, resetDemoData, rolePage, test } from "./fixtures";

// Every screen's "must contain" list (docs/demo-workflows.md), checked on fresh seed data with the login that uses
// the screen. One step per screen; each assertion is one item of its list.

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
    for (const card of [
      "Registered products",
      "Active warranties",
      "Ending within 30 days",
      "Expired",
      "Open claims",
    ]) {
      await expect(admin.getByRole("link", { name: new RegExp(`^${card}: \\d+`) })).toBeVisible();
    }
    for (const h of [
      "Registrations by channel",
      "Claims by status",
      "Claims by product category",
      "Warranties ending soon",
      "Recent activity",
    ])
      await expect(heading(admin, h)).toBeVisible();
  });

  // Two portal registrations for A02 / A03: a clean one (the product from the ERP invoice, can be approved) and a
  // duplicate of a registered product with another model (can only be rejected or merged).
  for (const [serial, model] of [
    ["261804517", "SM482V"],
    ["251406233", "SC480"],
  ]) {
    await customer.goto(`/register?serial=${serial}&model=${model}`);
    await customer.getByLabel("Purchase date").fill("2026-01-10");
    await customer.locator('input[type="file"]').setInputFiles(await receiptPhoto(admin));
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
    const sources = admin.getByLabel("Filter by source");
    for (const c of ["Web form", "Email", "Partner API", "Marketplace", "Distributor ERP"])
      await expect(sources.locator("option", { hasText: c })).toHaveCount(1);
    await admin.getByLabel("Filter by status").selectOption("PENDING");
    await admin.locator("table tbody tr input[type=checkbox]").first().check();
    await expect(admin.getByRole("button", { name: /^Approve 1 selected$/ })).toBeVisible();
  });

  await test.step("A03 Registration review", async () => {
    await admin.goto("/registrations?flag=DUPLICATE");
    await admin.locator("table tbody tr").first().getByRole("link").first().click();
    await expect(heading(admin, "Submitted data")).toBeVisible();
    await expect(heading(admin, "Receipt or invoice")).toBeVisible();
    await expect(admin.getByText(/is already registered/).first()).toBeVisible();
    await expect(admin.getByText(/doesn't match the model in our records/)).toBeVisible();
    await expect(admin.getByRole("button", { name: "Reject" }).first()).toBeVisible();
    await expect(admin.getByRole("button", { name: "Merge into existing record" })).toBeVisible();
    // A clean registration can be approved.
    await admin.goto("/registrations?status=PENDING&q=261804517");
    await admin.locator("table tbody tr").first().getByRole("link").first().click();
    await expect(admin.getByRole("button", { name: "Approve" })).toBeVisible();
  });

  await test.step("A04 Registered products", async () => {
    await admin.goto("/units");
    await expect(admin.getByPlaceholder("Search serial, batch, model, customer or dealer")).toBeVisible();
    await expect(admin.locator("table tbody tr").first()).toContainText(
      /Active|Expiring soon|Expired|Void|Pending/i,
    );
    await expect(admin.getByRole("columnheader", { name: /Batch/ })).toBeVisible();
    await expect(admin.getByRole("link", { name: "Add product" })).toBeVisible();
    await expect(admin.getByRole("link", { name: "Bulk upload" })).toBeVisible();
  });

  await test.step("A05 Product detail", async () => {
    await admin.goto("/units/252207119");
    await expect(admin.getByText("1 year from the date of purchase")).toBeVisible();
    await expect(admin.getByText("2522-L01").first()).toBeVisible();
    await expect(heading(admin, "QR label")).toBeVisible();
    await expect(admin.getByRole("button", { name: "Warranty certificate (PDF)" })).toBeVisible();
    await expect(admin.getByRole("tab", { name: "Claims" })).toBeVisible();
    await expect(admin.getByRole("tab", { name: "History" })).toBeVisible();
    await admin.getByRole("button", { name: "Void warranty" }).click();
    await expect(admin.getByRole("dialog").getByLabel(/Reason/)).toBeVisible();
    await admin.keyboard.press("Escape");
  });

  await test.step("A06 Product catalog", async () => {
    await admin.goto("/models");
    for (const c of ["Clamp meters", "Digital manifolds", "Vacuum and recovery"])
      await expect(heading(admin, c)).toBeVisible();
    await admin.getByRole("link", { name: "Swivel Head Wireless Clamp Meter (SC680)" }).click();
    await expect(heading(admin, "Warranty")).toBeVisible();
    await expect(admin.getByText("12-month warranty")).toBeVisible();
    await expect(heading(admin, "Label format")).toBeVisible();
  });

  await test.step("A09 Warranty claims", async () => {
    await admin.goto("/claims");
    for (const s of ["Submitted", "In review", "Approved", "Closed", "Rejected"]) {
      await expect(admin.getByRole("link", { name: new RegExp(`^${s}: \\d+ claims`) })).toBeVisible();
    }
    await expect(admin.getByLabel("Filter by status")).toBeVisible();
    await expect(admin.getByLabel("Filter by issue")).toBeVisible();
    await expect(admin.getByLabel("Filter by who filed it")).toBeVisible();
    await expect(admin.getByRole("link", { name: "File a claim" })).toBeVisible();
  });

  await test.step("A10 Claim detail", async () => {
    await admin.goto("/claims?status=SUBMITTED");
    await admin.locator("table tbody tr").first().getByRole("link").first().click();
    await expect(heading(admin, "Coverage when filed")).toBeVisible();
    await expect(heading(admin, "Product")).toBeVisible();
    await expect(heading(admin, "Progress")).toBeVisible();
    await expect(admin.getByRole("button", { name: "Start review" })).toBeVisible();
    await expect(admin.getByRole("button", { name: "Reject" })).toBeVisible();
    await admin.goto("/claims?status=IN_REVIEW");
    await admin.locator("table tbody tr").first().getByRole("link").first().click();
    await expect(admin.getByRole("button", { name: "Approve" })).toBeVisible();
    await admin.goto("/claims?status=APPROVED");
    await admin.locator("table tbody tr").first().getByRole("link").first().click();
    await expect(admin.getByRole("button", { name: "Close claim" })).toBeVisible();
    await admin.goto("/claims?status=CLOSED&issueType=DISPLAY");
    await admin.locator("table tbody tr").first().getByRole("link").first().click();
    await expect(admin.getByText("Credit of $139.00 issued.")).toBeVisible();
  });

  await test.step("A11 Dealers & users", async () => {
    await admin.goto("/admin/dealers");
    await expect(heading(admin, "Distributors and their dealers")).toBeVisible();
    await expect(heading(admin, "Gulf States HVAC Distribution")).toBeVisible();
    await expect(admin.getByText(/^dealer\.lonestar@/).first()).toBeVisible();
  });

  await test.step("A12 Integration log", async () => {
    await admin.goto("/admin/integrations");
    const systems = admin.getByLabel("System");
    for (const s of ["CRM", "Distributor ERP", "Finance", "Partner API", "Email"]) {
      await expect(systems.locator("option", { hasText: s })).toHaveCount(1);
    }
    await expect(admin.getByLabel("Direction")).toBeVisible();
    await expect(admin.getByLabel("Status")).toBeVisible();
    await expect(admin.getByRole("button", { name: "Retry" }).first()).toBeVisible();
    await admin.getByRole("button", { name: "View payload" }).first().click();
    await expect(admin.locator("pre")).toBeVisible();
    await admin.keyboard.press("Escape");
  });

  await test.step("A13 System events", async () => {
    await admin.goto("/admin/simulate");
    for (const b of [
      "Distributor ERP invoice (3 serials)",
      "Registration email with receipt",
      "Marketplace orders (2 serials)",
      "Reset data",
    ]) {
      await expect(admin.getByRole("button", { name: b })).toBeVisible();
    }
  });

  await test.step("Registration channels (admin: with partner keys)", async () => {
    await admin.goto("/registrations/channels");
    for (const h of [
      "At the counter",
      "Bulk upload",
      "Website form",
      "By email",
      "Customer portal",
      "Partner API",
    ])
      await expect(admin.getByRole("heading", { name: h })).toBeVisible();
    await expect(heading(admin, "Partner systems")).toBeVisible();
    await dealer.goto("/registrations/channels");
    await expect(dealer.getByRole("heading", { name: "Website form" })).toBeVisible();
    await expect(heading(dealer, "Partner systems")).toHaveCount(0);
  });

  await test.step("DL01 Dealer home (dealer and distributor)", async () => {
    await dealer.goto("/");
    for (const t of ["Registrations this month", "Pending", "Rejected", "Open claims"]) {
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
    await dealer.locator('input[type="file"]').setInputFiles("../demo-assets/lonestar_sales_week38.xlsx");
    await expect(dealer.getByText(/25 rows checked/)).toBeVisible();
    await expect(dealer.getByLabel("Show rows")).toBeVisible();
    await expect(dealer.getByRole("button", { name: /Resubmit/ })).toBeVisible();
    await expect(heading(dealer, "Upload history")).toBeVisible();
  });

  await test.step("DL03 Register a product", async () => {
    await dealer.goto("/registrations/new");
    await expect(dealer.getByRole("button", { name: "Scan QR label" })).toBeVisible();
    await expect(dealer.getByLabel(/Batch number/)).toBeVisible();
    for (const step of ["Product", "Purchase and invoice", "Customer and review"]) {
      await expect(dealer.getByText(step, { exact: true }).first()).toBeVisible();
    }
  });

  await test.step("DL04 Products I sold (dealer; distributor sees all its dealers)", async () => {
    await dealer.goto("/units");
    await expect(dealer.locator("main").getByRole("searchbox")).toBeVisible();
    await expect(dealer.locator("table tbody tr").first()).toContainText(
      /Active|Expiring soon|Expired|Void|Pending/i,
    );
    await distributor.goto("/units");
    await expect(distributor.locator("#units-dealer")).toBeVisible();
  });

  await test.step("DL05 Product detail (read-only)", async () => {
    await dealer.goto("/units/252811902");
    await expect(dealer.getByText("1 year from the date of purchase")).toBeVisible();
    await expect(dealer.getByRole("button", { name: "Warranty certificate (PDF)" })).toBeVisible();
    await expect(dealer.getByRole("button", { name: "Void warranty" })).toHaveCount(0);
  });

  await test.step("DL06 File a claim", async () => {
    await dealer.goto("/claims/new?serial=252811902");
    await expect(dealer.getByText("Warranty coverage for 252811902")).toBeVisible();
    await expect(dealer.locator('input[type="file"]')).toBeAttached();
    await expect(dealer.getByLabel("What's wrong")).toBeVisible();
  });

  await test.step("DL07 Warranty claims", async () => {
    await dealer.goto("/claims");
    await expect(dealer.getByRole("list", { name: "Claim progress" }).first()).toBeVisible();
    await expect(dealer.getByRole("button", { name: /Approve|Close claim|Start review/ })).toHaveCount(0);
  });

  await test.step("CU01 Register a product", async () => {
    await customer.goto("/register?serial=261804517&model=SM482V&batch=2618-L02");
    await expect(customer.getByText("Details read from the QR label on your product.")).toBeVisible();
    await expect(customer.getByLabel("Purchase date")).toBeVisible();
    await expect(customer.getByText("Receipt or invoice (photo or PDF)")).toBeVisible();
  });

  await test.step("CU02 My products", async () => {
    await customer.goto("/");
    await expect(customer.getByText("251406233").first()).toBeVisible();
    await expect(customer.getByText(/In warranty for \d+ more days?/).first()).toBeVisible();
    await expect(customer.getByText(/Warranty ended on /).first()).toBeVisible();
  });

  await test.step("CU03 Product detail", async () => {
    await customer.goto("/units/251406233");
    await expect(customer.getByText("1 year from the date of purchase")).toBeVisible();
    await expect(customer.getByRole("button", { name: "Warranty certificate (PDF)" })).toBeVisible();
    await expect(customer.getByRole("link", { name: "File a claim" })).toBeVisible();
  });

  await test.step("CU04 File a claim", async () => {
    await customer.goto("/claims/new");
    await expect(customer.getByLabel("Product")).toBeVisible();
    await expect(customer.getByLabel("What's wrong")).toBeVisible();
    await expect(customer.locator('input[type="file"]')).toBeAttached();
    await customer.getByLabel("Product").selectOption({ value: "251406233" });
    await expect(customer.getByText(/Warranty coverage for 251406233/)).toBeVisible();
  });

  await test.step("CU05 Claim tracking", async () => {
    // Marcus has no claim in the seed: file one, then follow it.
    await customer.getByLabel("What's wrong").selectOption({ label: "Won't power on" });
    await customer.getByLabel(/Description/).fill("Meter shuts off a second after power on.");
    await customer.getByRole("button", { name: "Submit claim" }).click();
    const steps = customer.locator("main section ol li");
    await expect(steps).toHaveCount(4);
    await expect(steps.nth(0)).toContainText("Submitted");
    await expect(steps.nth(1)).toContainText("In review");
    await expect(steps.nth(2)).toContainText("Approved");
    await expect(steps.nth(3)).toContainText("Closed");
  });

  await test.step("Website registration form (no account)", async () => {
    const context = await browser.newContext({ baseURL: appUrl(baseURL) });
    const visitor = await context.newPage();
    await visitor.goto("/register-product");
    await expect(visitor.getByRole("heading", { name: "Register your Fieldpiece product" })).toBeVisible();
    await expect(visitor.getByRole("button", { name: "Scan QR label" })).toBeVisible();
    for (const label of ["Model", "Serial number", "Batch number", "Purchase date", "Customer email"])
      await expect(visitor.getByLabel(new RegExp(label)).first()).toBeVisible();
    await context.close();
  });
});

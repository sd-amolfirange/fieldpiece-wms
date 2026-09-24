import { appUrl, expect, resetDemoData, rolePage, test } from "./fixtures";

// W6 – Multi-channel intake and integrations (docs/Demo workflows.md). Login: admin (the simulator is A13).

test("W6: multi-channel intake and integrations", async ({ browser, baseURL }) => {
  await resetDemoData(browser, appUrl(baseURL));
  const admin = await rolePage(browser, "admin", appUrl(baseURL));
  const channelCount = async (label: string) => {
    await admin.goto("/");
    const card = admin.locator("section", {
      has: admin.getByRole("heading", { name: "Registrations by channel" }),
    });
    await card.getByRole("button", { name: "View data" }).click();
    return Number((await card.locator("tr", { hasText: label }).locator("td").last().innerText()).trim());
  };
  const emailBefore = await channelCount("Email");
  let erpSerials: string[] = [];
  let emailSerial = "";

  await test.step("1. A13: ERP sales invoice with 3 serials, and a registration email with an invoice", async () => {
    await admin.goto("/admin/simulate");
    await admin.getByRole("button", { name: "ERP sales invoice (3 serials)" }).click();
    await expect(admin.getByText("3 registrations received from ERP").first()).toBeVisible();
    erpSerials = (
      await admin
        .getByText(/^[A-Z]{3}-SPL\d{2}-\d{6}, /)
        .first()
        .innerText()
    )
      .split(", ")
      .map((s) => s.trim());
    await admin.getByRole("button", { name: "Registration email with invoice" }).click();
    await expect(admin.getByText("Registration email received").first()).toBeVisible();
    emailSerial = (
      await admin
        .getByText(/^POL-SPL12-\d{6}$/)
        .first()
        .innerText()
    ).trim();
    expect(erpSerials).toHaveLength(3);
  });

  await test.step("2. A02: new items with ERP and Email badges", async () => {
    await admin.goto("/registrations?status=PENDING");
    await expect(admin.locator("table tbody tr", { hasText: emailSerial })).toContainText(/Email/i);
    for (const serial of erpSerials) {
      await expect(admin.locator("table tbody tr", { hasText: serial })).toContainText("ERP");
    }
  });

  await test.step("3. A03: approve the emailed registration", async () => {
    await admin.locator("table tbody tr", { hasText: emailSerial }).getByRole("link").first().click();
    const invoice = admin.locator("section", {
      has: admin.getByRole("heading", { name: "Invoice", exact: true }),
    });
    await expect(invoice.getByRole("link", { name: /Open full size/ })).toBeVisible();
    await admin.getByRole("button", { name: "Approve" }).click();
    await expect(admin.getByRole("link", { name: "Open unit" })).toBeVisible();
  });

  await test.step("4. A12: inbound ERP and email, outbound CRM update", async () => {
    await admin.goto("/admin/integrations");
    const rows = admin.locator("table tbody tr");
    await expect(rows.filter({ hasText: "ERP sales invoice" }).first()).toContainText(/Inbound/i);
    await expect(rows.filter({ hasText: "Registration email" }).first()).toContainText(/Inbound/i);
    const crm = rows.filter({ hasText: "CRM update" }).first();
    await expect(crm).toContainText(/Outbound/i);
    await crm.getByRole("button", { name: "View payload" }).click();
    await expect(admin.locator("pre")).toContainText(emailSerial);
    await admin.keyboard.press("Escape");
    // The seeded failed message can be retried.
    await expect(admin.getByRole("button", { name: "Retry" }).first()).toBeVisible();
  });

  await test.step("5. A01: the channel chart is updated", async () => {
    expect(await channelCount("Email")).toBe(emailBefore + 1);
  });
});

import { appUrl, expect, isoDay, present, receiptPhoto, resetDemoData, rolePage, test } from "./fixtures";

// W6 – Registration channels (docs/demo-workflows.md). Logins: admin (System events and Integrations, where
// partner API keys are managed), and a visitor without an account (the website form). Registrations arrive from
// a distributor ERP, the registration mailbox, an online marketplace, the website form and a partner system with
// its own API key.

const WEB_SERIAL = "SC260-263899911";
const API_SERIAL = "SC680-263899921";

test("W6: registrations from every channel", async ({ browser, baseURL }) => {
  await resetDemoData(browser, appUrl(baseURL));
  const admin = await rolePage(browser, "admin", appUrl(baseURL));
  const channelCount = async (label: string) => {
    await admin.goto("/");
    const card = admin.locator("section", {
      has: admin.getByRole("heading", { name: "Registrations by channel" }),
    });
    await card.getByRole("button", { name: "View data" }).click();
    const row = card.locator("tr", { hasText: label });
    return (await row.count()) ? Number((await row.locator("td").last().innerText()).trim()) : 0;
  };
  const emailBefore = await channelCount("Email");
  const marketplaceBefore = await channelCount("Marketplace");
  let erpSerials: string[] = [];
  let emailSerial = "";

  await test.step("1. A13: ERP invoice (3 serials), registration email, marketplace orders (2 serials)", async () => {
    await admin.goto("/admin/simulate");
    await admin.getByRole("button", { name: "Distributor ERP invoice (3 serials)" }).click();
    await expect(admin.getByText("3 registrations received from the ERP").first()).toBeVisible();
    erpSerials = (
      await admin
        .getByText(/^[A-Z0-9]+-\d{9}, [A-Z0-9]+-\d{9}, [A-Z0-9]+-\d{9}$/)
        .first()
        .innerText()
    )
      .split(", ")
      .map((s) => s.trim());
    await admin.getByRole("button", { name: "Registration email with receipt" }).click();
    await expect(admin.getByText("Registration email received").first()).toBeVisible();
    emailSerial = (
      await admin
        .getByText(/^[A-Z0-9]+-\d{9}$/)
        .first()
        .innerText()
    ).trim();
    await admin.getByRole("button", { name: "Marketplace orders (2 serials)" }).click();
    await expect(admin.getByText("2 marketplace registrations received").first()).toBeVisible();
    expect(erpSerials).toHaveLength(3);
  });

  await test.step("2. Website form: a buyer registers without an account", async () => {
    const context = await browser.newContext({ baseURL: appUrl(baseURL) });
    const visitor = await context.newPage();
    await visitor.goto(`/register-product?serial=${WEB_SERIAL}&model=SC260&batch=2638-L02`);
    await expect(visitor.getByRole("heading", { name: "Register your Fieldpiece product" })).toBeVisible();
    await visitor.getByLabel("Purchase date").fill(isoDay(-2));
    await visitor.getByLabel(/Where did you buy it/).fill("Lone Star Refrigeration Supply");
    await visitor.locator('input[type="file"]').setInputFiles(await receiptPhoto(admin));
    await visitor.getByLabel("Customer name").fill("Jordan Lee");
    await visitor.getByLabel("Customer email").fill("jordan.lee@example.com");
    await visitor.getByLabel("State").fill("TX");
    await visitor.getByLabel("ZIP code").fill("77002");
    await visitor.getByRole("button", { name: "Register product" }).click();
    await expect(visitor.getByRole("heading", { name: "Thanks, your registration is in" })).toBeVisible();
    await context.close();
  });

  await test.step("3. A02: one inbox for every channel", async () => {
    await admin.goto("/registrations?status=PENDING");
    await expect(admin.locator("table tbody tr", { hasText: emailSerial })).toContainText("Email");
    await expect(admin.locator("table tbody tr", { hasText: WEB_SERIAL })).toContainText("Web form");
    for (const serial of erpSerials) {
      await expect(admin.locator("table tbody tr", { hasText: serial })).toContainText("Distributor ERP");
    }
    await admin.goto("/registrations?channel=RETAIL");
    await expect(admin.locator("table tbody tr", { hasText: "Marketplace" }).first()).toContainText(
      "Approved",
    );
  });

  await test.step("4. A03: approve the emailed registration with its receipt", async () => {
    await admin.goto("/registrations?status=PENDING");
    await admin.locator("table tbody tr", { hasText: emailSerial }).getByRole("link").first().click();
    const receipt = admin.locator("section", {
      has: admin.getByRole("heading", { name: "Receipt or invoice", exact: true }),
    });
    await expect(receipt.getByRole("link", { name: /Open full size/ })).toBeVisible();
    await admin.getByRole("button", { name: "Approve" }).click();
    await expect(admin.getByRole("link", { name: "Open product" })).toBeVisible();
  });

  await test.step("5. Integrations: add a partner system and send a registration with its key", async () => {
    await admin.goto("/admin/integrations");
    const partners = admin.locator("section", {
      has: admin.getByRole("heading", { name: "Partner systems" }),
    });
    await expect(partners.getByRole("cell", { name: "Online marketplace" })).toBeVisible();
    await partners.getByRole("button", { name: "Add partner" }).click();
    const dialog = admin.getByRole("dialog");
    await dialog.getByLabel(/Name/).fill("Bayou Air Parts point of sale");
    await dialog.getByLabel(/Dealer/).selectOption({ label: "Bayou Air Parts" });
    await dialog.getByRole("button", { name: "Create API key" }).click();
    const apiKey = (await dialog.locator("pre").innerText()).trim();
    expect(apiKey).toMatch(/^fpk_/);
    await dialog.getByRole("button", { name: "Close" }).first().click();

    const res = await admin.request.post("/api/partner/v1/registrations", {
      headers: { "X-Api-Key": apiKey },
      data: {
        serial: API_SERIAL,
        batchNumber: "2638-L01",
        modelCode: "SC680",
        purchaseDate: isoDay(-1),
        invoiceNumber: "BAP-7001",
        customer: { name: "Kyle Fontenot", phone: "(225) 555-0161", state: "LA", zip: "70802" },
      },
    });
    expect(res.ok()).toBe(true);
    const body = (await res.json()) as { results: { status: string }[] };
    expect(present(body.results[0], "result").status).toBe("REGISTERED");
    const refused = await admin.request.post("/api/partner/v1/registrations", {
      headers: { "X-Api-Key": "fpk_not_a_real_key" },
      data: { serial: API_SERIAL },
    });
    expect(refused.status()).toBe(401);
    await admin.goto(`/units/${API_SERIAL}`);
    await expect(admin.getByText("Bayou Air Parts").first()).toBeVisible();
  });

  await test.step("6. A12: inbound ERP, email and partner messages; outbound CRM update", async () => {
    await admin.goto("/admin/integrations");
    const rows = admin.locator("table tbody tr");
    await expect(rows.filter({ hasText: "ERP sales invoice" }).first()).toContainText(/Inbound/i);
    await expect(rows.filter({ hasText: "Registration email" }).first()).toContainText(/Inbound/i);
    await expect(rows.filter({ hasText: "Partner registration" }).first()).toContainText(/Inbound/i);
    const crm = rows.filter({ hasText: "CRM update" }).first();
    await expect(crm).toContainText(/Outbound/i);
    await crm.getByRole("button", { name: "View payload" }).click();
    await expect(admin.locator("pre")).toContainText(emailSerial);
    await admin.keyboard.press("Escape");
    // The seeded failed message can be retried.
    await expect(admin.getByRole("button", { name: "Retry" }).first()).toBeVisible();
  });

  await test.step("7. A01: the channel chart is updated", async () => {
    expect(await channelCount("Email")).toBe(emailBefore + 1);
    expect(await channelCount("Marketplace")).toBe(marketplaceBefore + 2);
  });
});

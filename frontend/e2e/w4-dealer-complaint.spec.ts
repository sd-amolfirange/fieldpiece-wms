import { appUrl, expect, present, resetDemoData, rolePage, test } from "./fixtures";

// W4 – Dealer complaint on behalf of a customer (docs/demo-workflows.md). Logins: dealer CoolAir Traders (tablet),
// admin. Runs exactly as written: no extra simulation; the claims tab shows the seeded CoolAir claim.

const UNIT = "AER-SPL18-251120";

test("W4: dealer complaint on behalf of a customer", async ({ browser, baseURL }) => {
  await resetDemoData(browser, appUrl(baseURL));
  const admin = await rolePage(browser, "admin", appUrl(baseURL));
  const dealer = await rolePage(browser, "dealer", appUrl(baseURL));
  let complaintId = "";

  await test.step("1. DL04: search the customer's serial; the dealer finds only units it sold", async () => {
    await dealer.goto("/units");
    const search = dealer.locator("main").getByRole("searchbox");
    await search.fill(UNIT);
    await search.press("Enter");
    await expect(dealer.locator("table tbody tr", { hasText: UNIT })).toBeVisible();
    await search.fill("KEL-CAS30-240220"); // sold by Breeze Point
    await search.press("Enter");
    await expect(dealer.getByText(/No units match/)).toBeVisible();
  });

  await test.step("2. DL05: part-wise status visible, read-only", async () => {
    await dealer.goto(`/units/${UNIT}`);
    await expect(dealer.getByRole("table").getByText("Compressor")).toBeVisible();
    await expect(dealer.getByRole("button", { name: "Void warranty" })).toHaveCount(0);
  });

  await test.step("3. DL06: raise on the customer's behalf with a photo; same entitlement preview as the admin", async () => {
    await dealer.getByRole("link", { name: "Raise complaint" }).click();
    await expect(dealer.getByText(`What's covered for ${UNIT}`)).toBeVisible();
    const panel = (page: typeof dealer) => page.locator("section", { hasText: "What's covered" }).last();
    const dealerView = await panel(dealer).innerText();
    await admin.goto(`/complaints/new?serial=${UNIT}`);
    await expect(admin.getByText(`What's covered for ${UNIT}`)).toBeVisible();
    expect(await panel(admin).innerText()).toBe(dealerView);
    await dealer.getByLabel(/What's wrong/).fill("Water leaking from indoor unit");
    const photo = await admin.screenshot({ type: "jpeg", clip: { x: 0, y: 0, width: 800, height: 600 } });
    await dealer
      .locator('input[type="file"]')
      .setInputFiles({ name: "leak.jpg", mimeType: "image/jpeg", buffer: photo });
    await dealer.getByRole("button", { name: "Raise complaint" }).click();
    await expect(dealer.getByText("Progress").first()).toBeVisible();
    complaintId = present(dealer.url().split("/complaints/")[1], "complaint id");
  });

  await test.step("4. A07: source Dealer, CoolAir Traders; the admin hands it to the service system", async () => {
    await admin.goto("/complaints");
    const row = admin.locator("table tbody tr").first();
    await expect(row).toContainText(complaintId);
    await expect(row).toContainText(/Dealer\s*CoolAir Traders/i);
    await row.getByRole("link", { name: complaintId }).click();
    await admin.getByRole("button", { name: "Send to service system" }).click();
    await expect(admin.getByText("Sent to the service system").first()).toBeVisible();
    await dealer.goto(`/complaints/${complaintId}`);
    await expect(dealer.getByText("Progress").first()).toBeVisible();
    await expect(dealer.getByRole("button", { name: "Send to service system" })).toHaveCount(0);
  });

  await test.step("5. DL07: track the complaint and the claim status; the dealer can't change the claim", async () => {
    await dealer.goto("/complaints");
    const row = dealer.locator("table tbody tr", { hasText: complaintId });
    await expect(row.getByRole("list", { name: "Progress" })).toBeVisible();
    await expect(row.locator("[aria-current=step]")).toHaveText(/With service/);
    await dealer.getByRole("tab", { name: "Claims" }).click();
    const panel = dealer.getByRole("tabpanel");
    await expect(panel.getByText(/you can follow their status here/)).toBeVisible();
    await expect(panel.locator("table tbody tr").first()).toBeVisible();
    await expect(panel.getByRole("button", { name: /Submit|Approve|Reject|Mark paid/ })).toHaveCount(0);
    await expect(panel.locator("a[href^='/claims/']")).toHaveCount(0);
  });
});

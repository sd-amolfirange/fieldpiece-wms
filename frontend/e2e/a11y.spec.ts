import type { Page } from "@playwright/test";
import { appUrl, expectNoA11yViolations, resetDemoData, rolePage, test } from "./fixtures";

// WCAG 2.2 AA (axe) on every screen, with the login and viewport that uses it.

const SCREENS: Record<"admin" | "dealer" | "distributor" | "customer", string[]> = {
  admin: [
    "/",
    "/?view=finance",
    "/registrations",
    "/registrations/REG-1001",
    "/units",
    "/units/SC680-251406233",
    "/models",
    "/models/m-sc680",
    "/claims",
    "/claims/CLM-1001",
    "/claims/new",
    "/admin/dealers",
    "/admin/integrations",
    "/admin/simulate",
  ],
  dealer: [
    "/",
    "/?view=finance",
    "/registrations/new",
    "/registrations/bulk",
    "/registrations/channels",
    "/units",
    "/units/MG44-252811902",
    "/claims",
    "/claims/new",
  ],
  distributor: ["/", "/units", "/claims"],
  customer: ["/", "/register", "/units/SC680-251406233", "/claims", "/claims/new"],
};

test("a11y: no WCAG 2.2 AA violations on any screen", async ({ browser, baseURL }) => {
  // One test walks ~30 screens (with the finance views and the 72-model catalog): more than the default budget.
  test.setTimeout(300_000);
  await resetDemoData(browser, appUrl(baseURL));
  for (const [account, paths] of Object.entries(SCREENS)) {
    const page: Page = await rolePage(browser, account as keyof typeof SCREENS, appUrl(baseURL));
    for (const path of paths) {
      await test.step(`${account} ${path}`, async () => {
        await page.goto(path);
        await page.waitForLoadState("networkidle");
        await expectNoA11yViolations(page);
      });
    }
    await page.context().close();
  }
  await test.step("visitor /register-product", async () => {
    const context = await browser.newContext({ baseURL: appUrl(baseURL) });
    const page = await context.newPage();
    await page.goto("/register-product");
    await page.waitForLoadState("networkidle");
    await expectNoA11yViolations(page);
    await context.close();
  });
});

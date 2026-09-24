import type { Page } from "@playwright/test";
import { appUrl, expectNoA11yViolations, resetDemoData, rolePage, test } from "./fixtures";

// WCAG 2.2 AA (axe) on every demo screen, with the login and viewport that uses it.

const SCREENS: Record<"admin" | "dealer" | "distributor" | "customer", string[]> = {
  admin: [
    "/",
    "/registrations",
    "/registrations/REG-1001",
    "/units",
    "/units/AER-SPL15-210311",
    "/models",
    "/complaints",
    "/complaints/CMP-1001",
    "/claims",
    "/claims/CLM-1001",
    "/admin/dealers",
    "/admin/integrations",
    "/admin/simulate",
  ],
  dealer: [
    "/",
    "/registrations/new",
    "/registrations/bulk",
    "/units",
    "/units/AER-SPL18-251120",
    "/complaints",
    "/complaints/new",
  ],
  distributor: ["/", "/units"],
  customer: [
    "/",
    "/register",
    "/units/AER-SPL15-210311",
    "/complaints",
    "/complaints/new",
    "/complaints/CMP-1001",
  ],
};

test("a11y: no WCAG 2.2 AA violations on any demo screen", async ({ browser, baseURL }) => {
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
});

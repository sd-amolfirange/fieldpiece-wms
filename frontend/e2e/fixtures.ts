import AxeBuilder from "@axe-core/playwright";
import {
  expect,
  test as base,
  devices,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";

// Shared helpers for the workflow specs (docs/Demo workflows.md). Chromium only.

export const ACCOUNTS = {
  admin: "Admin: WMS office admin",
  dealer: "Dealer: CoolAir Traders, Pune",
  breeze: "Dealer: Breeze Point, Nashik",
  distributor: "Distributor: NorthStar Distribution",
  customer: "Customer: R. Kulkarni",
} as const;
export type Account = keyof typeof ACCOUNTS;

/** Viewports from the docs: customer on the phone, dealer on a tablet, admin and distributor on desktop. */
const VIEWPORT: Record<Account, { width: number; height: number }> = {
  admin: { width: 1440, height: 900 },
  distributor: { width: 1440, height: 900 },
  dealer: { width: 1024, height: 768 },
  breeze: { width: 1024, height: 768 },
  customer: { width: 390, height: 844 },
};

export async function signIn(page: Page, account: Account) {
  const label = ACCOUNTS[account];
  await page.goto("/login");
  await page.getByRole("option", { name: label }).waitFor({ state: "attached" });
  await page.getByLabel("Sign in as").selectOption({ label });
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText(/Welcome back/)).toBeVisible();
}

/** A signed-in page for one role, in its own browser context (like its own Chrome profile). */
export async function rolePage(browser: Browser, account: Account, baseURL: string): Promise<Page> {
  const context: BrowserContext = await browser.newContext({
    ...(account === "customer" ? devices["Pixel 7"] : {}),
    viewport: VIEWPORT[account],
    baseURL,
    acceptDownloads: true,
  });
  const page = await context.newPage();
  await signIn(page, account);
  return page;
}

/** Pre-demo checklist step 1: Admin -> Simulate -> Reset demo data. */
export async function resetDemoData(browser: Browser, baseURL: string) {
  const admin = await rolePage(browser, "admin", baseURL);
  await admin.goto("/admin/simulate");
  await admin.getByRole("button", { name: "Reset demo data" }).click();
  await admin.getByRole("dialog").getByRole("button", { name: "Reset demo data" }).click();
  await expect(admin.getByText("Demo data reset").first()).toBeVisible();
  await admin.context().close();
}

/** Today plus `days`, as yyyy-mm-dd (local time, like the date inputs). */
export function isoDay(days = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** An ISO date as the app shows it ("20 Sep 2027"), tolerant of "Sept". */
export function shownDate(iso: string): RegExp {
  const [y = 0, m = 1, d = 1] = iso.split("-").map(Number);
  const month = new Date(y, m - 1, d).toLocaleString("en-GB", { month: "short" }).slice(0, 3);
  return new RegExp(`${d} ${month}t? ${y}`);
}

/** WCAG 2.2 AA scan of the current page (axe). */
export async function expectNoA11yViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
}

/** The configured base URL (always set in playwright.config.ts). */
export function appUrl(baseURL: string | undefined): string {
  if (!baseURL) throw new Error("baseURL is not configured");
  return baseURL;
}

/** Fails the test with a clear message when something the step relies on is missing. */
export function present<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) throw new Error(`Missing ${what}`);
  return value;
}

export const test = base;
export { expect };

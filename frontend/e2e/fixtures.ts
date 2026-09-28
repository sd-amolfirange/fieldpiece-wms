import AxeBuilder from "@axe-core/playwright";
import {
  expect,
  test as base,
  devices,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";

// Shared helpers for the workflow specs (docs/demo-workflows.md). Chromium only.

export const ACCOUNTS = {
  admin: "Admin: Fieldpiece warranty desk",
  dealer: "Dealer: Lone Star Refrigeration Supply, Houston TX",
  bayou: "Dealer: Bayou Air Parts, Baton Rouge LA",
  distributor: "Distributor: Gulf States HVAC Distribution",
  customer: "Customer: Marcus Reed",
} as const;
export type Account = keyof typeof ACCOUNTS;

/** Viewports from the docs: customer on the phone, dealer on a tablet, admin and distributor on desktop. */
const VIEWPORT: Record<Account, { width: number; height: number }> = {
  admin: { width: 1440, height: 900 },
  distributor: { width: 1440, height: 900 },
  dealer: { width: 1024, height: 768 },
  bayou: { width: 1024, height: 768 },
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

/** Pre-demo checklist step 1: Admin -> System events -> Reset data. */
export async function resetDemoData(browser: Browser, baseURL: string) {
  const admin = await rolePage(browser, "admin", baseURL);
  await admin.goto("/admin/simulate");
  await admin.getByRole("button", { name: "Reset data" }).click();
  await admin.getByRole("dialog").getByRole("button", { name: "Reset data" }).click();
  await expect(admin.getByText("Data has been reset").first()).toBeVisible();
  await admin.context().close();
}

/** Today plus `days`, as yyyy-mm-dd (local time, like the date inputs). */
export function isoDay(days = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** An ISO date as the app shows it, US style ("Sep 20, 2027"). */
export function shownDate(iso: string): RegExp {
  const [y = 0, m = 1, d = 1] = iso.split("-").map(Number);
  const month = new Date(y, m - 1, d).toLocaleString("en-US", { month: "short" });
  return new RegExp(`${month} ${d}, ${y}`);
}

/** The last day of a warranty that starts on `iso` and runs `months` (end = start + months - 1 day). */
export function warrantyEnd(iso: string, months = 12): string {
  const [y = 0, m = 1, d = 1] = iso.split("-").map(Number);
  const end = new Date(y, m - 1 + months, d - 1);
  return `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, "0")}-${String(end.getDate()).padStart(2, "0")}`;
}

/** A small JPEG to stand in for a receipt photo. */
export async function receiptPhoto(page: Page) {
  return {
    name: "receipt.jpg",
    mimeType: "image/jpeg",
    buffer: await page.screenshot({ type: "jpeg", clip: { x: 0, y: 0, width: 400, height: 500 } }),
  };
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

import { defineConfig, devices } from "@playwright/test";

// E2E: one spec per demo workflow (docs/Demo workflows.md, W1-W7), on Chromium only (the demo runs on Chrome).
// Runs its own demo server (port 4100, throwaway data folder) and Vite dev server (port 5174), so it never touches
// the data of a demo server you have running on 4000. (No dot in the data folder name: the server won't serve
// files from dot-folders.) Specs share that server, so they run one at a time; each
// spec resets the demo data first.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: "http://localhost:5174",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
  ],
  webServer: [
    {
      command: "npm --prefix ../backend/demo-server run dev",
      url: "http://localhost:4100/api/auth/demo-accounts",
      env: { PORT: "4100", DEMO_DATA_DIR: "../../frontend/e2e/demo-data" },
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: "npm run dev -- --port 5174 --strictPort",
      url: "http://localhost:5174",
      env: { DEMO_API_URL: "http://localhost:4100" },
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});

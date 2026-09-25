// The frontend's own Playwright specs (frontend/e2e, unchanged), run against this real API instead of the mock
// server: migrated and seeded Postgres test database, real sessions, real uploads. Run with `npm run test:ui`
// (it starts from ../frontend so the specs and their fixtures resolve exactly as in the frontend's own config).
//
// Deliberately imports nothing: @playwright/test must resolve from frontend/node_modules only (one copy).
// Needs `docker compose up -d postgres` and a built API (`npm run build`).

import { join } from "node:path";

const backend = join(__dirname, "..", "..");
const frontend = join(backend, "..", "frontend");
const API_PORT = 4100;
const WEB_PORT = 5174;

const apiEnv = {
  NODE_ENV: "test",
  PORT: String(API_PORT),
  DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgresql://wms_app:localdev@localhost:5433/wms_hvac_test",
  DATABASE_MIGRATION_URL: process.env.TEST_DATABASE_OWNER_URL ?? "postgresql://wms_owner:localdev@localhost:5433/wms_hvac_test",
  REDIS_URL: process.env.TEST_REDIS_URL ?? "redis://localhost:6379/2",
  STORAGE_DRIVER: "local",
  STORAGE_LOCAL_DIR: "var/storage-ui-tests",
  DEMO_FEATURES_ENABLED: "true",
  AUTH_JWT_SECRET: "ui-tests-only-secret-0123456789abcdefghijklmnop",
  AUTH_LOGIN_LIMIT_PER_MINUTE: "1000",
  LOG_LEVEL: "warn",
  SWAGGER_ENABLED: "false",
};

export default {
  testDir: join(frontend, "e2e"),
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  retries: 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never", outputFolder: join(backend, "test-results", "ui-report") }]] : "list",
  outputDir: join(backend, "test-results", "ui"),
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        browserName: "chromium",
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 1,
        isMobile: false,
        hasTouch: false,
      },
    },
  ],
  webServer: [
    {
      // Fresh schema and seed for every run, then the built API.
      command: "npx prisma migrate deploy && npm run db:seed && node dist/main.js",
      cwd: backend,
      url: `http://localhost:${API_PORT}/api/auth/demo-accounts`,
      env: apiEnv,
      reuseExistingServer: false,
      timeout: 180_000,
    },
    {
      command: `npm run dev -- --port ${WEB_PORT} --strictPort`,
      cwd: frontend,
      url: `http://localhost:${WEB_PORT}`,
      env: { DEMO_API_URL: `http://localhost:${API_PORT}` },
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
};

import { type Env, EnvSchema } from "../../src/config/env";

// The e2e suite uses its own database (wms_hvac_e2e) and Redis DB 3, so it never touches dev data or the
// browser tests' database. Override with TEST_E2E_DATABASE_URL / TEST_E2E_DATABASE_OWNER_URL in CI.

export const E2E_DB_APP_URL =
  process.env.TEST_E2E_DATABASE_URL ?? "postgresql://wms_app:localdev@localhost:5433/wms_hvac_e2e";
export const E2E_DB_OWNER_URL =
  process.env.TEST_E2E_DATABASE_OWNER_URL ?? "postgresql://wms_owner:localdev@localhost:5433/wms_hvac_e2e";

export function testEnv(overrides: Partial<Record<string, string>> = {}): Env {
  return EnvSchema.parse({
    NODE_ENV: "test",
    DATABASE_URL: E2E_DB_APP_URL,
    AUTH_JWT_SECRET: "e2e-tests-only-secret-0123456789abcdefghijklmnop",
    STORAGE_DRIVER: "local",
    STORAGE_LOCAL_DIR: "var/storage-e2e",
    DEMO_FEATURES_ENABLED: "true",
    AUTH_LOGIN_LIMIT_PER_MINUTE: "1000",
    LOG_LEVEL: "error",
    ...overrides,
  });
}

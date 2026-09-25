import { type Env, EnvSchema } from "../../src/config/env";

// e2e runs against a separate database (wms_test) and Redis DB 1, so it never touches dev data.
// Override with TEST_DATABASE_URL / TEST_DATABASE_OWNER_URL / TEST_REDIS_URL in CI.

export const TEST_DB_APP_URL =
  process.env.TEST_DATABASE_URL ?? "postgresql://wms_app:localdev@localhost:5433/wms_test";
export const TEST_DB_OWNER_URL =
  process.env.TEST_DATABASE_OWNER_URL ?? "postgresql://wms_owner:localdev@localhost:5433/wms_test";
export const TEST_REDIS_URL = process.env.TEST_REDIS_URL ?? "redis://localhost:6379/1";

export function testEnv(overrides: Partial<Record<string, string>> = {}): Env {
  return EnvSchema.parse({
    NODE_ENV: "test",
    CORS_ORIGINS: "http://localhost:5173",
    DATABASE_URL: TEST_DB_APP_URL,
    REDIS_URL: TEST_REDIS_URL,
    OIDC_ISSUER: "http://localhost:3000/dev-idp",
    OIDC_AUDIENCE: "fieldpiece-wms-api",
    OIDC_JWKS_URI: "http://localhost:3000/dev-idp/.well-known/jwks.json",
    DEV_IDP_ENABLED: "true",
    DEV_IDP_KEY_FILE: "", // in-memory key per test run
    STORAGE_DRIVER: "minio",
    STORAGE_BUCKET: "wms-attachments-test",
    STORAGE_ENDPOINT: "http://localhost:9000",
    STORAGE_ACCESS_KEY: "minio",
    STORAGE_SECRET_KEY: "localdev123",
    SWAGGER_ENABLED: "false",
    LOG_LEVEL: "error",
    REQUIRE_PROOF_OF_PURCHASE: "false",
    ...overrides,
  });
}

import { execSync } from "node:child_process";
import { E2E_DB_APP_URL, E2E_DB_OWNER_URL } from "./test-env";

/** Applies migrations to the e2e database once per run, as the owner role (like the real migration job). */
export default function globalSetup(): void {
  execSync("npx prisma migrate deploy", {
    stdio: "pipe",
    env: { ...process.env, DATABASE_URL: E2E_DB_APP_URL, DATABASE_MIGRATION_URL: E2E_DB_OWNER_URL },
  });
}

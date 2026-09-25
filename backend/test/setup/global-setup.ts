import { execSync } from "node:child_process";
import { TEST_DB_APP_URL, TEST_DB_OWNER_URL } from "./test-env";

/** Applies migrations to the test database once per run (as the owner role, like the real migrations job). */
export default function globalSetup(): void {
  execSync("npx prisma migrate deploy", {
    stdio: "pipe",
    env: { ...process.env, DATABASE_URL: TEST_DB_APP_URL, DATABASE_MIGRATION_URL: TEST_DB_OWNER_URL },
  });
}

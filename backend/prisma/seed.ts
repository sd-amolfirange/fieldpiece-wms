import { PrismaClient } from "@prisma/client";
import { isoDateIn } from "../src/common/time/business-date";
import { loadDotEnv, loadEnv } from "../src/config/env";
import { hashPassword } from "../src/modules/auth";
import { writeSeed } from "../src/modules/demo";

// `npm run db:seed`: loads the demo data set (frontend/docs/demo-workflows.md), replacing all business records.
// Safe to re-run. Refuses to run in production unless --force is given.

async function main(): Promise<void> {
  loadDotEnv();
  const env = loadEnv();
  if (env.NODE_ENV === "production" && !process.argv.includes("--force")) {
    throw new Error("Refusing to replace production data with the demo seed. Pass --force if you really mean it.");
  }
  const db = new PrismaClient({ datasourceUrl: env.DATABASE_URL });
  try {
    const now = new Date();
    const today = isoDateIn(env.APP_TIMEZONE, now);
    await writeSeed(db, { today, now, passwordHash: await hashPassword(env.DEMO_PASSWORD) });
    process.stdout.write(`Seeded the demo data (dated from ${today}). Demo accounts use DEMO_PASSWORD.\n`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});

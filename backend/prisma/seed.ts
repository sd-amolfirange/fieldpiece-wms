import { PrismaClient } from "@prisma/client";
import { isoDateIn } from "../src/common/time/business-date";
import { loadDotEnv, loadEnv } from "../src/config/env";
import { hashPassword } from "../src/modules/auth";
import { writeSeed } from "../src/modules/demo";

// `npm run db:seed`: loads the starting data set (frontend/docs/demo-workflows.md), replacing all business records.
// Safe to re-run. Refuses to run in production unless --force is given.
// `--if-empty`: only seeds a database that has no users yet (first start of a deployment); otherwise does nothing.

async function main(): Promise<void> {
  loadDotEnv();
  const env = loadEnv();
  const ifEmpty = process.argv.includes("--if-empty");
  if (env.NODE_ENV === "production" && !ifEmpty && !process.argv.includes("--force")) {
    throw new Error("Refusing to replace production data with the demo seed. Pass --force if you really mean it.");
  }
  const db = new PrismaClient({ datasourceUrl: env.DATABASE_URL });
  try {
    if (ifEmpty && (await db.user.count()) > 0) {
      process.stdout.write("The database already has data; nothing seeded.\n");
      return;
    }
    const now = new Date();
    const today = isoDateIn(env.APP_TIMEZONE, now);
    await writeSeed(db, { today, now, passwordHash: await hashPassword(env.DEMO_PASSWORD) });
    process.stdout.write(`Loaded the starting data (dated from ${today}). Demo accounts use DEMO_PASSWORD.\n`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});

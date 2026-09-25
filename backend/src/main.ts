import "reflect-metadata";
import { createApp } from "./app.factory";
import { loadDotEnv, loadEnv } from "./config/env";

async function bootstrap(): Promise<void> {
  // The server clock is UTC; business dates use APP_TIMEZONE explicitly (common/time/business-date.ts).
  process.env.TZ = "UTC";
  loadDotEnv();
  const env = loadEnv();
  const app = await createApp(env);
  await app.listen(env.PORT, "0.0.0.0");
}

bootstrap().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
  process.exit(1);
});

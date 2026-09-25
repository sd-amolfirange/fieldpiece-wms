import "reflect-metadata";
import { createApp } from "./app.factory";
import { loadDotEnv, loadEnv } from "./config/env";

// HTTP entry point. The worker (worker.ts) ships in the same image with a different command (Section 1.1).

async function bootstrap(): Promise<void> {
  process.env.TZ = "UTC"; // the server clock is always UTC (Section 15)
  loadDotEnv();
  const env = loadEnv();
  const app = await createApp(env);
  await app.listen(env.PORT, "0.0.0.0");
}

bootstrap().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});

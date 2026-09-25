import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { Logger } from "nestjs-pino";
import { loadDotEnv, loadEnv } from "./config/env";
import { WorkerModule } from "./worker/worker.module";

// Worker entry point: outbox relay, queue consumers and scheduled jobs. Same image as the API (Section 1.1).

async function bootstrap(): Promise<void> {
  process.env.TZ = "UTC";
  loadDotEnv();
  const env = loadEnv();
  const app = await NestFactory.createApplicationContext(WorkerModule.forRoot(env), { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();
}

bootstrap().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
  process.exit(1);
});

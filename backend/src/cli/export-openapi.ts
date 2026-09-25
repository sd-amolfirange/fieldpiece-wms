import "reflect-metadata";
import { writeFileSync } from "node:fs";
import { createApp } from "../app.factory";
import { loadDotEnv, loadEnv } from "../config/env";

// Exports openapi.json (Section 6.6): CI lints it with Spectral and diffs it with oasdiff; the frontend
// generates types from it with openapi-typescript.

async function main(): Promise<void> {
  loadDotEnv();
  const env = loadEnv({ ...process.env, SWAGGER_ENABLED: "true", LOG_LEVEL: "error" });
  const app = await createApp(env, { logs: false });
  await app.init();
  const res = await app.inject({ method: "GET", url: "/docs-json" });
  writeFileSync("openapi.json", `${JSON.stringify(JSON.parse(res.body), null, 2)}\n`);
  await app.close();
  process.stdout.write("Wrote openapi.json\n");
}

void main();

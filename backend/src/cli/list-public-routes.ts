import "reflect-metadata";
import { PATH_METADATA, METHOD_METADATA } from "@nestjs/common/constants";
import { RequestMethod } from "@nestjs/common";
import { ModulesContainer } from "@nestjs/core";
import { createApp } from "../app.factory";
import { IS_PUBLIC } from "../common/auth/decorators";
import { loadDotEnv, loadEnv } from "../config/env";

// Lists every @Public() route (Section 11.3) so reviewers see the unauthenticated surface in each PR.

async function main(): Promise<void> {
  loadDotEnv();
  const env = loadEnv({ ...process.env, LOG_LEVEL: "error" });
  const app = await createApp(env, { logs: false });
  const routes: string[] = [];

  for (const module of app.get(ModulesContainer).values()) {
    for (const wrapper of module.controllers.values()) {
      const controller = wrapper.metatype as (new (...args: never[]) => object) | undefined;
      if (!controller) continue;
      const base = String(Reflect.getMetadata(PATH_METADATA, controller) ?? "");
      const classPublic = Reflect.getMetadata(IS_PUBLIC, controller) === true;
      for (const name of Object.getOwnPropertyNames(controller.prototype)) {
        const handler = (controller.prototype as Record<string, unknown>)[name];
        if (typeof handler !== "function" || name === "constructor") continue;
        const method = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod | undefined;
        if (method === undefined) continue;
        if (classPublic || Reflect.getMetadata(IS_PUBLIC, handler) === true) {
          const path = String(Reflect.getMetadata(PATH_METADATA, handler) ?? "");
          const full = `/${[base, path].join("/")}`.replace(/\/{2,}/g, "/");
          routes.push(`${RequestMethod[method].padEnd(6)} ${full}`);
        }
      }
    }
  }
  process.stdout.write(
    `Public routes (${routes.length}):\n${routes
      .sort()
      .map((r) => `  ${r}`)
      .join("\n")}\n`,
  );
  await app.close();
}

void main();

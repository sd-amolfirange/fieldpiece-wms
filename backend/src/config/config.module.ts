import { type DynamicModule, Global, Module } from "@nestjs/common";
import { Clock, SystemClock } from "../common/time/clock";
import type { Env } from "./env";

/** Injection token for the validated environment. */
export const ENV = Symbol("ENV");

/**
 * Global config. The env is parsed once in main.ts / worker.ts (or built by tests) and passed in, so the
 * module graph can depend on it (e.g. only mounting the dev IdP when enabled).
 */
@Global()
@Module({})
export class ConfigModule {
  static forRoot(env: Env, clock: Clock = new SystemClock()): DynamicModule {
    return {
      module: ConfigModule,
      providers: [
        { provide: ENV, useValue: env },
        { provide: Clock, useValue: clock },
      ],
      exports: [ENV, Clock],
    };
  }
}

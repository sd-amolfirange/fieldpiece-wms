import { Inject, Injectable, Logger, type OnModuleDestroy } from "@nestjs/common";
import { Redis } from "ioredis";
import { ENV } from "../../config/config.module";
import type { Env } from "../../config/env";

/**
 * Optional Redis connection, used for rate-limit counters shared across API instances. Null when REDIS_URL isn't
 * set. Fails fast (500 ms) instead of queueing commands, so an outage degrades rate limiting to per-process
 * counters rather than hanging requests.
 */
@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  readonly client: Redis | null;

  constructor(@Inject(ENV) env: Env) {
    this.client = env.REDIS_URL
      ? new Redis(env.REDIS_URL, {
          lazyConnect: false,
          enableOfflineQueue: false,
          maxRetriesPerRequest: 1,
          commandTimeout: 500,
          connectTimeout: 2000,
          retryStrategy: (times) => Math.min(times * 500, 5000),
        })
      : null;
    this.client?.on("error", (err: Error) => this.logger.warn({ err: err.message }, "Redis error"));
  }

  /** True when Redis answers, or when it isn't configured (nothing to be unhealthy). */
  async isHealthy(): Promise<boolean> {
    if (!this.client) return true;
    try {
      return (await this.client.ping()) === "PONG";
    } catch {
      return false;
    }
  }

  onModuleDestroy(): void {
    this.client?.disconnect();
  }
}

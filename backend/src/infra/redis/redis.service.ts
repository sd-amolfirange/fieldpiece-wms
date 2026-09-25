import { Inject, Injectable, Logger, type OnModuleDestroy } from "@nestjs/common";
import { Redis } from "ioredis";
import { ENV } from "../../config/config.module";
import type { Env } from "../../config/env";

/**
 * Shared Redis connection for cache and rate limiting. Fails fast (500 ms) instead of queueing commands,
 * so a Redis outage degrades features rather than hanging requests (Section 10).
 */
@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  readonly client: Redis;

  constructor(@Inject(ENV) env: Env) {
    this.client = new Redis(env.REDIS_URL, {
      lazyConnect: false,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      commandTimeout: 500,
      connectTimeout: 2000,
      retryStrategy: (times) => Math.min(times * 500, 5000),
    });
    this.client.on("error", (err: Error) => this.logger.warn({ err: err.message }, "Redis error"));
  }

  async isHealthy(): Promise<boolean> {
    try {
      return (await this.client.ping()) === "PONG";
    } catch {
      return false;
    }
  }

  onModuleDestroy(): void {
    this.client.disconnect();
  }
}

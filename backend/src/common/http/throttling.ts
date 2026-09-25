import { ThrottlerStorageRedisService } from "@nest-lab/throttler-storage-redis";
import { type ExecutionContext, Injectable, Logger } from "@nestjs/common";
import {
  ThrottlerGuard,
  type ThrottlerModuleOptions,
  type ThrottlerStorage,
  ThrottlerStorageService,
} from "@nestjs/throttler";
import type { FastifyRequest } from "fastify";
import type { Redis } from "ioredis";
import { IS_PUBLIC } from "../auth/decorators";

/** Per-user tracking when authenticated, per-IP otherwise (Section 11.4). */
@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  protected override getTracker(req: Record<string, unknown>): Promise<string> {
    const user = req.user as { id?: string } | undefined;
    return Promise.resolve(user?.id ? `user:${user.id}` : `ip:${String(req.ip)}`);
  }
}

/**
 * Redis-backed counters, falling back to an in-process limiter when Redis is down (Section 10),
 * so an outage degrades rate limiting instead of failing requests.
 */
export class FallbackThrottlerStorage implements ThrottlerStorage {
  private readonly logger = new Logger(FallbackThrottlerStorage.name);
  private readonly memory = new ThrottlerStorageService();

  constructor(private readonly redis: ThrottlerStorageRedisService) {}

  async increment(...args: Parameters<ThrottlerStorage["increment"]>) {
    try {
      return await this.redis.increment(...args);
    } catch (err) {
      this.logger.debug({ err: (err as Error).message }, "Redis throttler unavailable; using memory");
      return this.memory.increment(...args);
    }
  }
}

const WRITE_METHODS = new Set(["POST", "PATCH", "PUT", "DELETE"]);
const isWrite = (ctx: ExecutionContext) =>
  WRITE_METHODS.has(ctx.switchToHttp().getRequest<FastifyRequest>().method);
const isPublicRoute = (ctx: ExecutionContext) => Reflect.getMetadata(IS_PUBLIC, ctx.getHandler()) === true;

/** Section 11.4 limits. Route-specific tighter limits use @Throttle() on the handler. */
export function throttlerOptions(redis: Redis): ThrottlerModuleOptions {
  return {
    throttlers: [
      { name: "default", ttl: 60_000, limit: 300 },
      { name: "writes", ttl: 60_000, limit: 60, skipIf: (ctx) => !isWrite(ctx) },
      { name: "publicDaily", ttl: 86_400_000, limit: 500, skipIf: (ctx) => !isPublicRoute(ctx) },
    ],
    storage: new FallbackThrottlerStorage(new ThrottlerStorageRedisService(redis)),
  };
}

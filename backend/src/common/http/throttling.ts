import { ThrottlerStorageRedisService } from "@nest-lab/throttler-storage-redis";
import { type ExecutionContext, Injectable, Logger, SetMetadata } from "@nestjs/common";
import {
  ThrottlerGuard,
  type ThrottlerModuleOptions,
  type ThrottlerStorage,
  ThrottlerStorageService,
} from "@nestjs/throttler";
import type { FastifyRequest } from "fastify";
import type { Redis } from "ioredis";
import type { Env } from "../../config/env";

const SIGN_IN_ROUTE = "throttle:signIn";

/** Marks the password check, which gets its own, tighter per-IP limit. */
export const SignInRateLimit = () => SetMetadata(SIGN_IN_ROUTE, true);

/** Per user when signed in, per IP otherwise. */
@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  protected override getTracker(req: Record<string, unknown>): Promise<string> {
    const user = req.user as { id?: string } | undefined;
    return Promise.resolve(user?.id ? `user:${user.id}` : `ip:${String(req.ip)}`);
  }
}

/** Redis counters, falling back to in-process counters when Redis is down, so an outage never fails requests. */
class FallbackThrottlerStorage implements ThrottlerStorage {
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
const isSignIn = (ctx: ExecutionContext) => Reflect.getMetadata(SIGN_IN_ROUTE, ctx.getHandler()) === true;

/**
 * Limits: 600 requests a minute per user (the UI polls lists every 5 s in several tabs), 120 writes a minute, and
 * AUTH_LOGIN_LIMIT_PER_MINUTE password attempts per IP. Clients get 429 with Retry-After.
 */
export function throttlerOptions(env: Env, redis: Redis | null): ThrottlerModuleOptions {
  return {
    throttlers: [
      { name: "default", ttl: 60_000, limit: 600 },
      { name: "writes", ttl: 60_000, limit: 120, skipIf: (ctx) => !isWrite(ctx) },
      { name: "signIn", ttl: 60_000, limit: env.AUTH_LOGIN_LIMIT_PER_MINUTE, skipIf: (ctx) => !isSignIn(ctx) },
    ],
    storage: redis ? new FallbackThrottlerStorage(new ThrottlerStorageRedisService(redis)) : undefined,
  };
}

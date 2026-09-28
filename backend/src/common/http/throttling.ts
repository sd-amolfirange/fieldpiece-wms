import { ThrottlerStorageRedisService } from "@nest-lab/throttler-storage-redis";
import { type ExecutionContext, Global, Injectable, Logger, Module, SetMetadata } from "@nestjs/common";
import {
  ThrottlerGuard,
  type ThrottlerModuleOptions,
  type ThrottlerStorage,
  ThrottlerStorageService,
} from "@nestjs/throttler";
import { createHash } from "node:crypto";
import type { FastifyRequest } from "fastify";
import type { Redis } from "ioredis";
import type { Env } from "../../config/env";

const SIGN_IN_ROUTE = "throttle:signIn";
const PUBLIC_FORM_ROUTE = "throttle:publicForm";
const PARTNER_ROUTE = "throttle:partner";

/** Marks the password check, which gets its own, tighter per-IP limit. */
export const SignInRateLimit = () => SetMetadata(SIGN_IN_ROUTE, true);

/** Marks an unauthenticated form (public registration): per-IP hourly limit. */
export const PublicFormRateLimit = () => SetMetadata(PUBLIC_FORM_ROUTE, true);

/** Marks the partner API: per-caller limit per minute. */
export const PartnerRateLimit = () => SetMetadata(PARTNER_ROUTE, true);

/** Per user when signed in, per API key for partner systems (several can share one IP), per IP otherwise. */
@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  protected override getTracker(req: Record<string, unknown>): Promise<string> {
    const user = req.user as { id?: string } | undefined;
    if (user?.id) return Promise.resolve(`user:${user.id}`);
    const apiKey = (req.headers as Record<string, unknown> | undefined)?.["x-api-key"];
    if (typeof apiKey === "string" && apiKey)
      return Promise.resolve(`key:${createHash("sha256").update(apiKey).digest("hex").slice(0, 24)}`);
    return Promise.resolve(`ip:${String(req.ip)}`);
  }
}

/** Redis counters, falling back to in-process counters when Redis is down, so an outage never fails requests. */
class FallbackThrottlerStorage implements ThrottlerStorage {
  private readonly logger = new Logger(FallbackThrottlerStorage.name);

  constructor(
    private readonly redis: ThrottlerStorageRedisService,
    private readonly memory: ThrottlerStorage,
  ) {}

  async increment(...args: Parameters<ThrottlerStorage["increment"]>) {
    try {
      return await this.redis.increment(...args);
    } catch (err) {
      this.logger.debug({ err: (err as Error).message }, "Redis throttler unavailable; using memory");
      return this.memory.increment(...args);
    }
  }
}

/**
 * In-process counters as a Nest provider, so closing the app clears their expiry timers (created inside the
 * throttler options, they would keep the process alive for the longest window, an hour).
 */
@Injectable()
export class InMemoryThrottlerStorage extends ThrottlerStorageService {}

@Global()
@Module({ providers: [InMemoryThrottlerStorage], exports: [InMemoryThrottlerStorage] })
export class ThrottlerStorageModule {}

const WRITE_METHODS = new Set(["POST", "PATCH", "PUT", "DELETE"]);
const isWrite = (ctx: ExecutionContext) =>
  WRITE_METHODS.has(ctx.switchToHttp().getRequest<FastifyRequest>().method);
const flagged = (key: string) => (ctx: ExecutionContext) =>
  Reflect.getMetadata(key, ctx.getHandler()) === true;
const isSignIn = flagged(SIGN_IN_ROUTE);
const isPublicForm = flagged(PUBLIC_FORM_ROUTE);
const isPartner = flagged(PARTNER_ROUTE);

/**
 * Limits: 600 requests a minute per user (the UI polls lists every 5 s in several tabs), 120 writes a minute,
 * AUTH_LOGIN_LIMIT_PER_MINUTE password attempts per IP, PUBLIC_FORM_LIMIT_PER_HOUR public registrations per IP and
 * PARTNER_API_LIMIT_PER_MINUTE partner calls. Clients get 429 with Retry-After.
 */
export function throttlerOptions(
  env: Env,
  redis: Redis | null,
  memory: InMemoryThrottlerStorage,
): ThrottlerModuleOptions {
  return {
    throttlers: [
      { name: "default", ttl: 60_000, limit: 600 },
      { name: "writes", ttl: 60_000, limit: 120, skipIf: (ctx) => !isWrite(ctx) },
      {
        name: "signIn",
        ttl: 60_000,
        limit: env.AUTH_LOGIN_LIMIT_PER_MINUTE,
        skipIf: (ctx) => !isSignIn(ctx),
      },
      {
        name: "publicForm",
        ttl: 3_600_000,
        limit: env.PUBLIC_FORM_LIMIT_PER_HOUR,
        skipIf: (ctx) => !isPublicForm(ctx),
      },
      {
        name: "partner",
        ttl: 60_000,
        limit: env.PARTNER_API_LIMIT_PER_MINUTE,
        skipIf: (ctx) => !isPartner(ctx),
      },
    ],
    storage: redis ? new FallbackThrottlerStorage(new ThrottlerStorageRedisService(redis), memory) : memory,
  };
}

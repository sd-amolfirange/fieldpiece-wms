import { Injectable, Logger } from "@nestjs/common";
import { RedisService } from "./redis.service";

const LOCK_TTL_MS = 3000;
const LOCK_WAIT_MS = 75;

/**
 * Cache-aside with a short SET NX lock against stampedes (Section 9.3). If Redis is down every call
 * falls through to the loader, so the API keeps serving from the DB.
 *
 * Never cache scoped data under a key that doesn't include the user or org.
 */
@Injectable()
export class CacheService {
  private readonly logger = new Logger(CacheService.name);

  constructor(private readonly redis: RedisService) {}

  async getOrSet<T>(key: string, ttlSeconds: number, loader: () => Promise<T>): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached !== undefined) return cached;

    const locked = await this.tryLock(key);
    if (!locked) {
      // Someone else is filling this key; give them a moment, then read or load ourselves.
      await new Promise((resolve) => setTimeout(resolve, LOCK_WAIT_MS));
      const filled = await this.get<T>(key);
      if (filled !== undefined) return filled;
    }

    try {
      const value = await loader();
      await this.set(key, value, ttlSeconds);
      return value;
    } finally {
      if (locked) await this.safe(() => this.redis.client.del(`${key}:lock`));
    }
  }

  async get<T>(key: string): Promise<T | undefined> {
    const raw = await this.safe(() => this.redis.client.get(key));
    if (raw == null) return undefined;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return undefined;
    }
  }

  async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    await this.safe(() => this.redis.client.set(key, JSON.stringify(value), "EX", ttlSeconds));
  }

  async del(...keys: string[]): Promise<void> {
    if (keys.length) await this.safe(() => this.redis.client.del(...keys));
  }

  /** Deletes every key with the prefix. Uses SCAN, never KEYS. */
  async delByPrefix(prefix: string): Promise<void> {
    await this.safe(async () => {
      let cursor = "0";
      do {
        const [next, keys] = await this.redis.client.scan(cursor, "MATCH", `${prefix}*`, "COUNT", 200);
        cursor = next;
        if (keys.length) await this.redis.client.del(...keys);
      } while (cursor !== "0");
    });
  }

  private async tryLock(key: string): Promise<boolean> {
    return (
      (await this.safe(() => this.redis.client.set(`${key}:lock`, "1", "PX", LOCK_TTL_MS, "NX"))) === "OK"
    );
  }

  private async safe<T>(op: () => Promise<T>): Promise<T | undefined> {
    try {
      return await op();
    } catch (err) {
      this.logger.debug({ err: (err as Error).message }, "Cache unavailable; falling through");
      return undefined;
    }
  }
}

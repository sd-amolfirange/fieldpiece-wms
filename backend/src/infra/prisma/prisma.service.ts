import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { type Prisma, PrismaClient } from "@prisma/client";
import { ENV } from "../../config/config.module";
import type { Env } from "../../config/env";

export type Tx = Prisma.TransactionClient;
/** Anything that can run queries: the root client or a transaction. */
export type Db = PrismaClient | Tx;

function withPoolParams(url: string, env: Env): string {
  const parsed = new URL(url);
  if (!parsed.searchParams.has("connection_limit"))
    parsed.searchParams.set("connection_limit", String(env.DB_POOL_MAX));
  if (!parsed.searchParams.has("pool_timeout")) parsed.searchParams.set("pool_timeout", "10");
  return parsed.toString();
}

/** Database client. Services own transactions via `prisma.tx(async (tx) => ...)`. */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor(@Inject(ENV) private readonly env: Env) {
    super({
      datasourceUrl: withPoolParams(env.DATABASE_URL, env),
      log: [{ emit: "event", level: "warn" }],
    });
  }

  /** Interactive transaction with the configured timeout. Read-committed; conflicting writes use row locks. */
  tx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.$transaction(fn, { timeout: this.env.DB_TRANSACTION_TIMEOUT_MS, maxWait: 5000 });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
    this.logger.log("Database connections closed");
  }
}

import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { Prisma, PrismaClient } from "@prisma/client";
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

/** Primary database client. Services own transactions via `prisma.$transaction(async (tx) => ...)`. */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor(@Inject(ENV) env: Env) {
    super({
      datasourceUrl: withPoolParams(env.DATABASE_URL, env),
      log: [{ emit: "event", level: "warn" }],
      transactionOptions: { timeout: env.DB_STATEMENT_TIMEOUT_MS, maxWait: 2000 },
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
    this.logger.log("Database connections closed");
  }
}

/** Read replica for reports and heavy reads (Section 9.2). Falls back to the primary when not configured. */
@Injectable()
export class ReplicaPrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor(@Inject(ENV) env: Env) {
    super({ datasourceUrl: withPoolParams(env.DATABASE_REPLICA_URL ?? env.DATABASE_URL, env) });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}

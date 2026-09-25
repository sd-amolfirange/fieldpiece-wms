import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Prisma, PrismaClient } from "@prisma/client";
import { Redis } from "ioredis";
import type { OutgoingHttpHeaders } from "node:http";
import { createApp } from "../../src/app.factory";
import { type Clock } from "../../src/common/time/clock";
import { TEST_DB_OWNER_URL, TEST_REDIS_URL, testEnv } from "./test-env";

// e2e harness: the real app (same middleware as production) over app.inject(). Tokens are real RS256 JWTs
// from the dev IdP's in-memory key; the guard is never mocked (Section 13.2).

export interface Harness {
  app: NestFastifyApplication;
  /** Owner connection for fixtures and cleanup (the app role can't DELETE). */
  db: PrismaClient;
  tokenFor(email: string): Promise<string>;
  request(opts: {
    method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
    url: string;
    token?: string;
    body?: unknown;
    headers?: Record<string, string>;
  }): Promise<{
    status: number;
    body: Record<string, unknown> & { code?: string };
    headers: OutgoingHttpHeaders;
    /** Undecoded body, for binary responses. */
    raw: Buffer;
  }>;
  close(): Promise<void>;
}

/** Constant list; Prisma.raw is safe here because nothing comes from input. */
const TABLES = [
  "audit_log",
  "idempotency_keys",
  "outbox_events",
  "attachments",
  "claim_events",
  "rmas",
  "claims",
  "registrations",
  "customers",
  "users",
  "warranty_policies",
  "products",
  "organizations",
  "failure_categories",
  "holidays",
];

export async function createHarness(
  options: { clock?: Clock; env?: Partial<Record<string, string>> } = {},
): Promise<Harness> {
  const db = new PrismaClient({ datasourceUrl: TEST_DB_OWNER_URL });
  await db.$executeRaw`TRUNCATE ${Prisma.raw(TABLES.map((t) => `"${t}"`).join(", "))} RESTART IDENTITY CASCADE`;
  await db.$executeRaw`ALTER SEQUENCE claim_display_seq RESTART WITH 1`;
  await db.$executeRaw`ALTER SEQUENCE rma_display_seq RESTART WITH 1`;
  const redis = new Redis(TEST_REDIS_URL);
  await redis.flushdb();
  redis.disconnect();

  const app = await createApp(testEnv(options.env), { clock: options.clock, logs: false });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  const request: Harness["request"] = async ({ method, url, token, body, headers }) => {
    const res = await app.inject({
      method,
      url: url.startsWith("/dev-idp") ? url : `/api/v1${url}`,
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
      payload: body as Record<string, unknown> | undefined,
    });
    return {
      status: res.statusCode,
      body:
        res.body && String(res.headers["content-type"] ?? "").includes("json")
          ? (JSON.parse(res.body) as Record<string, unknown>)
          : {},
      headers: res.headers,
      raw: res.rawPayload,
    };
  };

  return {
    app,
    db,
    request,
    async tokenFor(email) {
      const res = await request({ method: "POST", url: "/dev-idp/token", body: { email } });
      if (res.status !== 200) throw new Error(`No token for ${email}: ${JSON.stringify(res.body)}`);
      return String(res.body.accessToken);
    },
    async close() {
      await app.close();
      await db.$disconnect();
    },
  };
}

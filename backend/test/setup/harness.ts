import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { PrismaClient } from "@prisma/client";
import type { OutgoingHttpHeaders } from "node:http";
import { createApp } from "../../src/app.factory";
import { isoDateIn } from "../../src/common/time/business-date";
import { FixedClock } from "../../src/common/time/clock";
import { hashPassword } from "../../src/modules/auth";
import { writeSeed } from "../../src/modules/demo";
import { E2E_DB_APP_URL, testEnv } from "./test-env";

// e2e harness: the real app (same middleware as production) over app.inject(), the demo seed in the e2e
// database, and a fixed clock so warranty status is deterministic. Suites share the database: run serially.

export const DEMO_PASSWORD = "Demo#2026";

export const EMAILS = {
  admin: "admin@demo.wms",
  dealer: "dealer.coolair@demo.wms",
  breeze: "dealer.breeze@demo.wms",
  arctic: "dealer.arctic@demo.wms",
  distributor: "dist.northstar@demo.wms",
  customer: "customer.rk@demo.wms",
} as const;
export type Who = keyof typeof EMAILS;

export interface Session {
  token: string;
  cookie: string;
}

export interface Response {
  status: number;
  // Tests read arbitrary fields of the JSON body.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any;
  headers: OutgoingHttpHeaders;
  raw: Buffer;
}

export interface Harness {
  app: NestFastifyApplication;
  db: PrismaClient;
  clock: FixedClock;
  today(): string;
  reseed(): Promise<void>;
  login(who: Who): Promise<Session>;
  request(opts: {
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
    url: string;
    as?: Session;
    /** Send only the session cookie, not the bearer token. */
    cookieOnly?: boolean;
    body?: unknown;
    headers?: Record<string, string>;
  }): Promise<Response>;
  upload(as: Session, url: string, file: { name: string; mime: string; content: Buffer }, fields?: Record<string, string>): Promise<Response>;
  close(): Promise<void>;
}

function multipart(file: { name: string; mime: string; content: Buffer }, fields: Record<string, string>) {
  const boundary = `----wms${Math.random().toString(16).slice(2)}`;
  const chunks: Buffer[] = [
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: ${file.mime}\r\n\r\n`,
    ),
    file.content,
    Buffer.from("\r\n"),
  ];
  for (const [name, value] of Object.entries(fields)) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { body: Buffer.concat(chunks), contentType: `multipart/form-data; boundary=${boundary}` };
}

export async function createHarness(options: { now?: Date; env?: Partial<Record<string, string>> } = {}): Promise<Harness> {
  const clock = new FixedClock(options.now ?? new Date());
  const env = testEnv(options.env);
  const db = new PrismaClient({ datasourceUrl: E2E_DB_APP_URL });
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const today = () => isoDateIn(env.APP_TIMEZONE, clock.now());
  const reseed = async () => {
    await db.authSession.deleteMany();
    await writeSeed(db, { today: today(), now: clock.now(), passwordHash });
  };
  await reseed();

  const app = await createApp(env, { clock, logs: false });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  const toResponse = (res: Awaited<ReturnType<typeof app.inject>>): Response => ({
    status: res.statusCode,
    body: String(res.headers["content-type"] ?? "").includes("json") && res.body ? JSON.parse(res.body) : res.body,
    headers: res.headers,
    raw: res.rawPayload,
  });

  const request: Harness["request"] = async ({ method, url, as, cookieOnly, body, headers }) =>
    toResponse(
      await app.inject({
        method,
        url: `/api${url}`,
        headers: {
          ...(as && !cookieOnly ? { authorization: `Bearer ${as.token}` } : {}),
          ...(as ? { cookie: as.cookie } : {}),
          ...headers,
        },
        payload: body as Record<string, unknown> | undefined,
      }),
    );

  return {
    app,
    db,
    clock,
    today,
    reseed,
    request,
    async login(who) {
      const res = await request({ method: "POST", url: "/auth/login", body: { email: EMAILS[who], password: DEMO_PASSWORD } });
      if (res.status !== 200) throw new Error(`Login failed for ${who}: ${JSON.stringify(res.body)}`);
      const setCookie = res.headers["set-cookie"];
      const cookie = String(Array.isArray(setCookie) ? setCookie[0] : setCookie).split(";")[0]!;
      return { token: String(res.body.accessToken), cookie };
    },
    async upload(as, url, file, fields = {}) {
      const form = multipart(file, fields);
      return toResponse(
        await app.inject({
          method: "POST",
          url: `/api${url}`,
          headers: { authorization: `Bearer ${as.token}`, "content-type": form.contentType },
          payload: form.body,
        }),
      );
    },
    async close() {
      await app.close();
      await db.$disconnect();
    },
  };
}

/** Smallest JPEG header the file check accepts. */
export const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);

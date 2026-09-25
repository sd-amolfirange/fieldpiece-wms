import type { IncomingMessage } from "node:http";
import type { Params } from "nestjs-pino";
import type { Env } from "../../config/env";

// Structured JSON logs (Section 12.4): requestId, userId, route, status, durationMs. PII and secrets redacted;
// no bodies at info.

export const REDACT_PATHS = [
  "req.headers.authorization",
  "req.headers.cookie",
  'res.headers["set-cookie"]',
  "*.email",
  "*.phone",
  "*.address",
  "*.shipTo",
  "*.returnAddress",
  "*.accessToken",
  "*.password",
];

type RequestWithUser = IncomingMessage & { userId?: string };

export function loggerOptions(env: Env): Params {
  return {
    pinoHttp: {
      level: env.LOG_LEVEL,
      redact: { paths: REDACT_PATHS, censor: "[redacted]" },
      // Fastify assigns the ID (see app.factory.ts) and mirrors it into this header.
      genReqId: (req) => String(req.headers["x-request-id"]),
      customProps: (req) => ({ userId: (req as RequestWithUser).userId }),
      customLogLevel: (_req, res, err) =>
        err || res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info",
      serializers: {
        req: (req: { id: string; method: string; url: string }) => ({
          id: req.id,
          method: req.method,
          url: req.url,
        }),
        res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
      },
      autoLogging: { ignore: (req) => req.url?.includes("/health/") ?? false },
      transport:
        env.NODE_ENV === "development" ? { target: "pino-pretty", options: { singleLine: true } } : undefined,
    },
  };
}

import compress from "@fastify/compress";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import multipart from "@fastify/multipart";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { Logger } from "nestjs-pino";
import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { AppModule } from "./app.module";
import type { Clock } from "./common/time/clock";
import type { Env } from "./config/env";

const REQUEST_ID = /^[A-Za-z0-9._-]{8,128}$/;
/** JSON bodies. Files go through multipart, with their own limits. */
const JSON_BODY_LIMIT_BYTES = 1024 * 1024;

/** Builds the HTTP app. Shared by main.ts, the OpenAPI export and the e2e suite, so all run the same middleware. */
export async function createApp(env: Env, options: { clock?: Clock; logs?: boolean } = {}) {
  const adapter = new FastifyAdapter({
    bodyLimit: JSON_BODY_LIMIT_BYTES,
    keepAliveTimeout: 65_000, // above a typical load balancer's 60 s idle timeout
    trustProxy: true, // Secure cookies and client IPs behind a proxy or tunnel
    genReqId: (req: IncomingMessage) => {
      const incoming = req.headers["x-request-id"];
      const id = typeof incoming === "string" && REQUEST_ID.test(incoming) ? incoming : randomUUID();
      req.headers["x-request-id"] = id;
      return id;
    },
  });

  const app = await NestFactory.create<NestFastifyApplication>(AppModule.forRoot(env, options.clock), adapter, {
    bufferLogs: true,
  });
  if (options.logs !== false) app.useLogger(app.get(Logger));

  const fastify = app.getHttpAdapter().getInstance();
  fastify.addHook("onSend", async (request, reply) => {
    void reply.header("X-Request-Id", request.id);
  });

  await app.register(cookie);
  await app.register(multipart, {
    limits: { fileSize: Math.max(env.UPLOAD_MAX_BYTES, env.BULK_IMPORT_MAX_BYTES), files: 1, fields: 20 },
  });
  await app.register(helmet, {
    // JSON API: only the Swagger page needs a relaxed CSP. File downloads set their own headers.
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:"],
      },
    },
    referrerPolicy: { policy: "no-referrer" },
    frameguard: { action: "deny" },
    hsts: { maxAge: 31_536_000, includeSubDomains: true },
  });
  await app.register(compress, { threshold: 1024 });

  // Browsers call the API through the frontend's own origin (the Vite proxy in development); CORS is for
  // deployments where the frontend runs on another origin. Credentials: the session cookie.
  app.enableCors({
    origin: env.CORS_ORIGINS,
    credentials: true,
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Authorization", "Content-Type", "X-Request-Id"],
    exposedHeaders: ["Retry-After", "X-Request-Id", "Content-Disposition"],
    maxAge: 600,
  });

  app.setGlobalPrefix(env.API_PREFIX);
  app.enableShutdownHooks();

  if (env.SWAGGER_ENABLED) {
    const config = new DocumentBuilder()
      .setTitle("Warranty Management API")
      .setDescription(
        "Units with part-wise warranties, registrations from every channel, complaints, service hand-off, " +
          "manufacturer claims and the integration log. Contract: frontend/docs/api-contract.md.",
      )
      .setVersion(process.env.npm_package_version ?? "0.2.0")
      .addBearerAuth({ type: "http", scheme: "bearer", bearerFormat: "JWT" })
      .addCookieAuth("wms_refresh")
      .build();
    const document = SwaggerModule.createDocument(app, config, {
      operationIdFactory: (controller, method) => `${controller.replace("Controller", "")}_${method}`,
    });
    SwaggerModule.setup("docs", app, document, { swaggerOptions: { persistAuthorization: true } });
  }

  return app;
}

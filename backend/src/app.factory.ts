import compress from "@fastify/compress";
import helmet from "@fastify/helmet";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { Logger } from "nestjs-pino";
import { patchNestJsSwagger } from "nestjs-zod";
import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { AppModule } from "./app.module";
import type { Clock } from "./common/time/clock";
import type { Env } from "./config/env";

const REQUEST_ID = /^[A-Za-z0-9._-]{8,128}$/;
const BODY_LIMIT_BYTES = 1024 * 1024; // files never pass through the API (Section 11.1)

/** Builds the HTTP app. Shared by main.ts and the e2e suite so both run the same middleware. */
export async function createApp(env: Env, options: { clock?: Clock; logs?: boolean } = {}) {
  const adapter = new FastifyAdapter({
    bodyLimit: BODY_LIMIT_BYTES,
    keepAliveTimeout: 65_000, // above the load balancer's 60 s idle timeout (Section 9.4)
    trustProxy: true,
    genReqId: (req: IncomingMessage) => {
      const incoming = req.headers["x-request-id"];
      const id = typeof incoming === "string" && REQUEST_ID.test(incoming) ? incoming : randomUUID();
      req.headers["x-request-id"] = id;
      return id;
    },
  });

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule.forRoot(env, options.clock),
    adapter,
    {
      bufferLogs: true,
    },
  );
  if (options.logs !== false) app.useLogger(app.get(Logger));

  const fastify = app.getHttpAdapter().getInstance();
  fastify.addHook("onSend", async (request, reply) => {
    void reply.header("X-Request-Id", request.id);
  });

  await app.register(helmet, {
    // JSON API: only the Swagger page needs a relaxed CSP.
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

  app.enableCors({
    origin: env.CORS_ORIGINS, // explicit allow-list, never *
    credentials: true, // only the dev IdP uses a cookie; the API itself is bearer-only
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Authorization", "Content-Type", "If-Match", "Idempotency-Key", "X-Request-Id"],
    exposedHeaders: ["ETag", "Retry-After", "X-Request-Id"],
    maxAge: 600,
  });

  app.setGlobalPrefix(env.API_PREFIX, { exclude: ["dev-idp/(.*)"] });
  app.enableShutdownHooks();

  if (env.SWAGGER_ENABLED) {
    patchNestJsSwagger();
    const config = new DocumentBuilder()
      .setTitle("Fieldpiece Warranty Management API")
      .setDescription("Registrations, warranty lookup, claims and RMA for Fieldpiece products.")
      .setVersion(process.env.npm_package_version ?? "0.1.0")
      .addBearerAuth({ type: "http", scheme: "bearer", bearerFormat: "JWT" }, "jwt")
      .addServer("/")
      .build();
    const document = SwaggerModule.createDocument(app, config, {
      operationIdFactory: (controller, method) => `${controller.replace("Controller", "")}_${method}`,
    });
    SwaggerModule.setup("docs", app, document, { swaggerOptions: { persistAuthorization: true } });
  }

  return app;
}

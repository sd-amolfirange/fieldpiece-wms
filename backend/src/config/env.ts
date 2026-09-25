import { existsSync } from "node:fs";
import { z } from "zod";

// Validated environment (build guide Section 4). The app refuses to start if config is invalid.

const bool = z
  .enum(["true", "false", "1", "0"])
  .default("false")
  .transform((v) => v === "true" || v === "1");

export const EnvSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "staging", "production"]),
    PORT: z.coerce.number().int().positive().default(3000),
    API_PREFIX: z.string().default("api/v1"),
    CORS_ORIGINS: z.string().transform((s) =>
      s
        .split(",")
        .map((o) => o.trim())
        .filter(Boolean),
    ),

    DATABASE_URL: z.string().url(), // via PgBouncer in prod
    DATABASE_REPLICA_URL: z.string().url().optional(),
    DB_POOL_MAX: z.coerce.number().int().positive().default(10),
    DB_STATEMENT_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),

    REDIS_URL: z.string().url(),

    OIDC_ISSUER: z.string().url(),
    OIDC_AUDIENCE: z.string().min(1),
    OIDC_JWKS_URI: z.string().url(),
    OIDC_ROLES_CLAIM: z.string().default("roles"),
    DEV_IDP_ENABLED: bool,
    /** Where the dev IdP persists its signing key so tokens survive restarts. Empty = in-memory. */
    DEV_IDP_KEY_FILE: z.string().default(".dev-keys/dev-idp.jwk.json"),

    STORAGE_DRIVER: z.enum(["s3", "azure", "minio"]),
    STORAGE_BUCKET: z.string().min(1),
    STORAGE_ENDPOINT: z.string().url().optional(),
    /** Endpoint baked into presigned URLs; must be reachable from the browser. Defaults to STORAGE_ENDPOINT. */
    STORAGE_PUBLIC_ENDPOINT: z.string().url().optional(),
    STORAGE_REGION: z.string().default("us-east-1"),
    STORAGE_ACCESS_KEY: z.string().optional(),
    STORAGE_SECRET_KEY: z.string().optional(),
    UPLOAD_MAX_BYTES: z.coerce
      .number()
      .int()
      .positive()
      .default(10 * 1024 * 1024),

    SMTP_URL: z.string().optional(),
    MAIL_FROM: z.string().default("Fieldpiece Warranty <no-reply@fieldpiece.local>"),
    WEB_APP_URL: z.string().url().default("http://localhost:5173"),
    /** Browser-reachable origin of this API, for URLs the API hands out (product images). */
    API_PUBLIC_URL: z.string().url().default("http://localhost:3000"),

    SWAGGER_ENABLED: bool,
    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
    OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional(),

    // Business settings [CONFIRM]
    EXPIRING_SOON_DAYS: z.coerce.number().int().min(1).max(365).default(60),
    SLA_REVIEW_BUSINESS_HOURS: z.coerce.number().positive().default(48),
    BUSINESS_DAY_START_HOUR: z.coerce.number().int().min(0).max(23).default(8),
    BUSINESS_DAY_END_HOUR: z.coerce.number().int().min(1).max(24).default(17),
    REQUIRE_PROOF_OF_PURCHASE: bool,
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === "production" && env.DEV_IDP_ENABLED) {
      ctx.addIssue({
        code: "custom",
        path: ["DEV_IDP_ENABLED"],
        message: "The dev IdP must never run in production",
      });
    }
    if (env.NODE_ENV === "production" && env.SWAGGER_ENABLED) {
      ctx.addIssue({
        code: "custom",
        path: ["SWAGGER_ENABLED"],
        message: "Swagger UI is off in production (6.6)",
      });
    }
    if (env.BUSINESS_DAY_END_HOUR <= env.BUSINESS_DAY_START_HOUR) {
      ctx.addIssue({
        code: "custom",
        path: ["BUSINESS_DAY_END_HOUR"],
        message: "Must be after the start hour",
      });
    }
    if (env.STORAGE_DRIVER !== "azure" && (!env.STORAGE_ACCESS_KEY || !env.STORAGE_SECRET_KEY)) {
      ctx.addIssue({ code: "custom", path: ["STORAGE_ACCESS_KEY"], message: "Required for s3 / minio" });
    }
  });

export type Env = z.infer<typeof EnvSchema>;

/** Parses process.env. Prints every problem and exits, instead of starting half-configured. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = EnvSchema.safeParse(source);
  if (!result.success) {
    const problems = result.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }
  return result.data;
}

/**
 * Loads `.env` for local development. Real environment variables always win, and production never reads a
 * file: secrets are injected by the platform (Section 4).
 */
export function loadDotEnv(path = ".env"): void {
  if (process.env.NODE_ENV === "production" || !existsSync(path)) return;
  process.loadEnvFile(path);
}

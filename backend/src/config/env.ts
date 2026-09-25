import { existsSync } from "node:fs";
import { z } from "zod";

// Validated environment. The process refuses to start on invalid config instead of running half-configured.

/** Booleans are parsed explicitly: `z.coerce.boolean()` would turn the string "false" into true. */
const bool = (fallback: "true" | "false") =>
  z
    .enum(["true", "false", "1", "0"])
    .default(fallback)
    .transform((v) => v === "true" || v === "1");

const isTimeZone = (tz: string) => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

export const EnvSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "staging", "production"]),
    PORT: z.coerce.number().int().positive().default(4000),
    /** Every route lives under this prefix. The frontend calls `${VITE_API_BASE_URL}` = "/api". */
    API_PREFIX: z
      .string()
      .default("api")
      .transform((p) => p.replace(/^\/+|\/+$/g, "")),
    CORS_ORIGINS: z
      .string()
      .default("")
      .transform((s) =>
        s
          .split(",")
          .map((o) => o.trim())
          .filter(Boolean),
      ),

    DATABASE_URL: z.string().url(),
    /** Owner connection, used only by migrations (Prisma `directUrl`). */
    DATABASE_MIGRATION_URL: z.string().url().optional(),
    DB_POOL_MAX: z.coerce.number().int().positive().default(10),
    DB_TRANSACTION_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),

    /** Rate-limit counters. Empty = in-process counters (fine for a single instance). */
    REDIS_URL: z.string().url().optional(),

    // Sessions: short-lived access JWT in the response body, long-lived refresh token in an httpOnly cookie.
    AUTH_JWT_SECRET: z.string().min(32, "Use at least 32 random characters"),
    AUTH_JWT_ISSUER: z.string().default("hvac-wms-api"),
    AUTH_ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
    /** Idle lifetime of a refresh session; every refresh extends it. */
    AUTH_SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(14),
    AUTH_LOGIN_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(30),

    // Object storage for uploads.
    STORAGE_DRIVER: z.enum(["local", "s3", "minio"]).default("local"),
    /** local driver: folder for the files. */
    STORAGE_LOCAL_DIR: z.string().default("var/storage"),
    STORAGE_BUCKET: z.string().default("wms-attachments"),
    STORAGE_ENDPOINT: z.string().url().optional(),
    STORAGE_REGION: z.string().default("us-east-1"),
    STORAGE_ACCESS_KEY: z.string().optional(),
    STORAGE_SECRET_KEY: z.string().optional(),
    UPLOAD_MAX_BYTES: z.coerce
      .number()
      .int()
      .positive()
      .default(15 * 1024 * 1024),
    BULK_IMPORT_MAX_BYTES: z.coerce
      .number()
      .int()
      .positive()
      .default(5 * 1024 * 1024),
    BULK_IMPORT_MAX_ROWS: z.coerce.number().int().positive().default(5000),

    /**
     * Calendar used for "today" (warranty status, future-date checks, "this month"). Warranty dates have no time
     * zone; this decides when a day starts. [CONFIRM] with the business.
     */
    APP_TIMEZONE: z.string().default("Asia/Kolkata").refine(isTimeZone, "Unknown IANA time zone"),
    /** SessionUser.currency. [CONFIRM] per organisation once more than one market is live. */
    APP_CURRENCY: z.string().length(3).default("INR"),

    /**
     * Demo-only endpoints: the "Sign in as" account list (GET /auth/demo-accounts) and the A13 simulator
     * (POST /simulate/*). Refused in production.
     */
    DEMO_FEATURES_ENABLED: bool("false"),
    /** Password of the seeded demo accounts. */
    DEMO_PASSWORD: z.string().min(8).default("Demo#2026"),

    SWAGGER_ENABLED: bool("false"),
    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === "production" && env.DEMO_FEATURES_ENABLED) {
      ctx.addIssue({
        code: "custom",
        path: ["DEMO_FEATURES_ENABLED"],
        message: "Demo accounts and the simulator must never run in production",
      });
    }
    if (env.NODE_ENV === "production" && env.STORAGE_DRIVER === "local") {
      ctx.addIssue({ code: "custom", path: ["STORAGE_DRIVER"], message: "Use s3 in production" });
    }
    if (env.STORAGE_DRIVER !== "local" && (!env.STORAGE_ACCESS_KEY || !env.STORAGE_SECRET_KEY)) {
      ctx.addIssue({ code: "custom", path: ["STORAGE_ACCESS_KEY"], message: "Required for s3 / minio" });
    }
    if (env.NODE_ENV === "production" && env.CORS_ORIGINS.some((o) => o === "*")) {
      ctx.addIssue({ code: "custom", path: ["CORS_ORIGINS"], message: "List the allowed origins explicitly" });
    }
  });

export type Env = z.infer<typeof EnvSchema>;

/** Parses process.env. Prints every problem at once, then refuses to start. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = EnvSchema.safeParse(source);
  if (!result.success) {
    const problems = result.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }
  return result.data;
}

/** Loads `.env` for local development. Real environment variables win; production never reads a file. */
export function loadDotEnv(path = ".env"): void {
  if (process.env.NODE_ENV === "production" || !existsSync(path)) return;
  process.loadEnvFile(path);
}

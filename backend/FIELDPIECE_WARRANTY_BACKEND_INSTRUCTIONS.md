# Fieldpiece Warranty Management System: Backend Build Instructions

**Audience:** Backend developers, DevOps and AI coding assistants working on the WMS API
**Stack:** Node.js 22 LTS · TypeScript 5 (strict) · NestJS 10 on Fastify · PostgreSQL 16 · Prisma · Docker · pgAdmin 4 · OpenAPI 3.1 (Swagger)
**Companion doc:** `FIELDPIECE_WARRANTY_FRONTEND_INSTRUCTIONS.md`. The domain model, roles, statuses and error format here have to match that doc exactly.
**Status:** v1.0, working draft

> Items marked **[CONFIRM]** are business rules or infrastructure choices the client still has to sign off. Build them so they can be configured, not hard-coded.

---

## 1. Architecture decisions

These are the calls I've made as architect, and why. If you want to change one, write an ADR in `docs/adr/` first.

| # | Decision | Reasoning |
|---|---|---|
| ADR-001 | **Modular monolith**, not microservices | The domain is one bounded context with maybe 5 to 8 modules and a small team. Microservices would add network hops, distributed transactions and ops cost without any real benefit. Module boundaries are strict (see 3.2), so a module can be split out later if load really calls for it. |
| ADR-002 | **NestJS with the Fastify adapter** | NestJS gives us DI, modules, guards and first-class Swagger generation. Fastify is roughly 2x Express throughput and has schema-based serialisation. |
| ADR-003 | **PostgreSQL 16** as the only system of record | ACID, strong constraints, JSONB for flexible metadata, partitioning for audit data, and full-text search for serial and customer lookup. |
| ADR-004 | **Prisma** for CRUD, plus **raw SQL** (`$queryRaw` / TypedSQL) for reporting | Typed client, migration workflow, good DX. Heavy aggregations go through hand-written SQL, not ORM chains. |
| ADR-005 | **Redis 7** for cache, rate limiting and **BullMQ** job queues | Keeps the API stateless and moves slow work (emails, PDFs, CSV imports) off the request path. |
| ADR-006 | **Transactional outbox** for domain events | Guarantees a notification or integration event goes out if, and only if, the DB change committed. |
| ADR-007 | **External OIDC provider** for identity (Azure AD B2C / Entra External ID or Auth0) **[CONFIRM]** | We never store passwords. The API only validates JWTs and maps claims to roles. |
| ADR-008 | **Object storage** for attachments (Azure Blob or S3; MinIO locally) with presigned URLs | Files never pass through the API process. That keeps memory flat and lets uploads scale on their own. |
| ADR-009 | **OpenAPI is code-first and generated from decorators**, then published and used for the frontend's type generation | One source of truth. CI fails if the spec changes without a version note. |
| ADR-010 | **Containers everywhere**: same image from dev to prod | Removes "works on my machine". Deploy target is Azure Container Apps / AKS or AWS ECS **[CONFIRM]**. |

### 1.1 System context

```
                    ┌───────────────────────┐
  Browser (React) ──►  CDN / WAF / TLS       │
                    └──────────┬────────────┘
                               │ HTTPS
                    ┌──────────▼────────────┐        ┌──────────────┐
                    │  API (NestJS) × N     │◄──JWT──┤ OIDC provider│
                    │  stateless containers │        └──────────────┘
                    └──┬───────┬────────┬───┘
                       │       │        │ presigned URLs
             ┌─────────▼─┐ ┌───▼────┐ ┌─▼──────────────┐
             │ PgBouncer │ │ Redis  │ │ Object storage │
             └─────┬─────┘ └───┬────┘ └────────────────┘
          ┌────────▼──────┐    │ BullMQ
          │ PostgreSQL 16 │ ┌──▼──────────────────────┐
          │ primary (+RR) │ │ Worker (same image) × M │──► Email/SMS, PDF, ERP, carriers
          └───────────────┘ └─────────────────────────┘
```

API and worker are **the same Docker image**, started with different commands (`node dist/main.js` vs `node dist/worker.js`). That way they scale on their own but always ship together.

---

## 2. Local development setup

### 2.1 Prerequisites

- Node.js 22 LTS (use `.nvmrc`), pnpm 9
- Docker Desktop (or Docker Engine + Compose v2)
- VS Code with the ESLint, Prettier, Prisma and Docker extensions

### 2.2 `docker-compose.yml` (development)

```yaml
name: fieldpiece-wms

services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: wms
      POSTGRES_USER: wms_owner
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-localdev}
    ports: ["5432:5432"]
    volumes:
      - pgdata:/var/lib/postgresql/data
      - ./docker/postgres/init:/docker-entrypoint-initdb.d:ro   # creates app role, extensions
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U wms_owner -d wms"]
      interval: 5s
      retries: 10
    command: >
      postgres -c shared_preload_libraries=pg_stat_statements
               -c log_min_duration_statement=250
               -c max_connections=200

  pgadmin:
    image: dpage/pgadmin4:8
    environment:
      PGADMIN_DEFAULT_EMAIL: admin@local.dev
      PGADMIN_DEFAULT_PASSWORD: ${PGADMIN_PASSWORD:-localdev}
      PGADMIN_CONFIG_SERVER_MODE: "False"
    ports: ["5050:80"]
    volumes:
      - ./docker/pgadmin/servers.json:/pgadmin4/servers.json:ro  # pre-registers the local DB
    depends_on: [postgres]

  redis:
    image: redis:7-alpine
    command: ["redis-server", "--appendonly", "yes"]
    ports: ["6379:6379"]

  minio:
    image: minio/minio:latest
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: minio
      MINIO_ROOT_PASSWORD: ${MINIO_PASSWORD:-localdev123}
    ports: ["9000:9000", "9001:9001"]
    volumes: [miniodata:/data]

  mailpit:                       # catches outgoing email locally
    image: axllent/mailpit
    ports: ["8025:8025", "1025:1025"]

  api:
    build: { context: ., target: dev }
    env_file: .env
    command: pnpm start:dev
    ports: ["3000:3000", "9229:9229"]   # 9229 = debugger
    volumes: [".:/app", "/app/node_modules"]
    depends_on:
      postgres: { condition: service_healthy }
      redis: { condition: service_started }

  worker:
    build: { context: ., target: dev }
    env_file: .env
    command: pnpm worker:dev
    volumes: [".:/app", "/app/node_modules"]
    depends_on: [api]

volumes: { pgdata: {}, miniodata: {} }
```

`docker/pgadmin/servers.json`, so pgAdmin opens with the DB already registered:

```json
{
  "Servers": {
    "1": {
      "Name": "WMS local",
      "Group": "Fieldpiece",
      "Host": "postgres",
      "Port": 5432,
      "MaintenanceDB": "wms",
      "Username": "wms_owner",
      "SSLMode": "prefer"
    }
  }
}
```

`docker/postgres/init/01-roles.sql`:

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

-- The app connects as a least-privilege role, never as the owner.
CREATE ROLE wms_app LOGIN PASSWORD 'localdev';
CREATE ROLE wms_readonly LOGIN PASSWORD 'localdev';   -- reporting / BI
GRANT CONNECT ON DATABASE wms TO wms_app, wms_readonly;
```

Grants on tables go in a migration that runs after the tables exist (see 5.6).

### 2.3 First run

```bash
cp .env.example .env
docker compose up -d postgres redis minio mailpit pgadmin
pnpm install
pnpm prisma migrate dev
pnpm db:seed               # roles, sample products, policies, test users
pnpm start:dev
```

| URL | What |
|---|---|
| http://localhost:3000/api/v1 | API |
| http://localhost:3000/docs | Swagger UI (dev and staging only) |
| http://localhost:3000/docs-json | Raw OpenAPI JSON |
| http://localhost:5050 | pgAdmin |
| http://localhost:9001 | MinIO console |
| http://localhost:8025 | Mailpit (captured email) |

pgAdmin is **only for local and staging use**. In production, DB access goes through a bastion or private endpoint with named, audited accounts, never through a pgAdmin container on the internet.

---

## 3. Project structure

### 3.1 Layout

```
.
├── docker/                       # compose helpers, postgres init, pgadmin servers.json
├── docs/
│   ├── adr/                      # architecture decision records
│   └── runbooks/                 # on-call runbooks
├── prisma/
│   ├── schema.prisma
│   ├── migrations/
│   └── seed.ts
├── src/
│   ├── main.ts                   # HTTP bootstrap
│   ├── worker.ts                 # BullMQ worker bootstrap
│   ├── app.module.ts
│   ├── config/                   # zod-validated env config
│   ├── common/
│   │   ├── auth/                 # JWT strategy, RolesGuard, @CurrentUser, scope helpers
│   │   ├── errors/               # AppError, error codes, global exception filter
│   │   ├── http/                 # interceptors: request-id, logging, idempotency, etag
│   │   ├── pagination/
│   │   ├── validation/           # zod pipe, shared schemas (serial, dates)
│   │   └── observability/        # logger, OpenTelemetry, metrics
│   ├── infra/
│   │   ├── prisma/               # PrismaService, tx helper, read-replica client
│   │   ├── redis/
│   │   ├── storage/              # BlobStorage interface + S3/Azure/MinIO adapters
│   │   ├── queue/
│   │   └── outbox/
│   └── modules/
│       ├── products/
│       ├── policies/
│       ├── customers/
│       ├── registrations/
│       ├── warranty/             # lookup + calculation engine
│       ├── claims/
│       ├── rma/
│       ├── attachments/
│       ├── notifications/
│       ├── reports/
│       ├── users/
│       ├── audit/
│       └── health/
├── test/
│   ├── e2e/
│   ├── load/                     # k6 scripts
│   └── fixtures/
├── Dockerfile
├── docker-compose.yml
└── .github/workflows/            # or azure-pipelines.yml
```

### 3.2 Inside a module

```
modules/claims/
├── claims.module.ts
├── claims.controller.ts         # HTTP only: parse, authorise, call service, map DTO
├── claims.service.ts            # use-cases / business logic, owns transactions
├── claims.repository.ts         # all DB access for this module
├── claim-state-machine.ts       # pure functions, 100% unit tested
├── dto/                         # request/response DTOs with Swagger decorators
├── events.ts                    # domain event types emitted to the outbox
└── __tests__/
```

**Rules:**

1. Controllers never touch Prisma. Services never touch `FastifyRequest`.
2. One module never reaches into another module's repository. It calls the other module's **exported service** instead. Enforce this with `eslint-plugin-boundaries`.
3. Business rules live in plain functions, such as the state machine and warranty maths. That makes them testable without Nest or a DB.
4. Anything that talks to the outside world (email, carriers, ERP) goes through a queue, never inside the request.

---

## 4. Configuration and secrets

`src/config/env.ts`. The app **refuses to start** if config is invalid.

```ts
import { z } from "zod";

export const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "staging", "production"]),
  PORT: z.coerce.number().default(3000),
  API_PREFIX: z.string().default("api/v1"),
  CORS_ORIGINS: z.string().transform((s) => s.split(",")),

  DATABASE_URL: z.string().url(),              // via PgBouncer in prod
  DATABASE_REPLICA_URL: z.string().url().optional(),
  DB_POOL_MAX: z.coerce.number().default(10),
  DB_STATEMENT_TIMEOUT_MS: z.coerce.number().default(5000),

  REDIS_URL: z.string().url(),

  OIDC_ISSUER: z.string().url(),
  OIDC_AUDIENCE: z.string(),
  OIDC_JWKS_URI: z.string().url(),
  OIDC_ROLES_CLAIM: z.string().default("roles"),

  STORAGE_DRIVER: z.enum(["s3", "azure", "minio"]),
  STORAGE_BUCKET: z.string(),
  STORAGE_ENDPOINT: z.string().url().optional(),
  UPLOAD_MAX_BYTES: z.coerce.number().default(10 * 1024 * 1024),

  SMTP_URL: z.string().optional(),
  SWAGGER_ENABLED: z.coerce.boolean().default(false),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional(),
});
export type Env = z.infer<typeof EnvSchema>;
```

- **Commit `.env.example`, never `.env`.** Add `.env*` (except the example) to `.gitignore`, and run **gitleaks** in the pre-commit hook and in CI.
- In staging and prod, secrets come from **Azure Key Vault / AWS Secrets Manager** and are injected as env vars at runtime. They never go into image layers or compose files.
- Rotate DB passwords and storage keys at least every 90 days. The app should pick up new values on restart without a code change.

---

## 5. Database design

### 5.1 Conventions

| Item | Convention |
|---|---|
| Primary keys | `uuid` via `gen_random_uuid()`. UUID v7 is preferred once available, because it's time-ordered and index-friendly. |
| Human IDs | A separate `display_no` from a sequence, e.g. `CLM-000123`, `RMA-000045`. Never expose sequence gaps as meaningful. |
| Naming | `snake_case`, plural table names, `_id` suffix for FKs, `_at` for timestamps |
| Timestamps | `timestamptz` only, stored in UTC. Every table has `created_at` and `updated_at`. |
| Soft delete | `deleted_at timestamptz` only where business needs it (customers, products). Claims and audit rows are never deleted. |
| Concurrency | `version int NOT NULL DEFAULT 1` on mutable aggregates (claims, rma, registrations) for optimistic locking |
| Money | `numeric(12,2)` plus a `currency char(3)`. Never use float. |
| Enums | Postgres `enum` types for stable sets (claim status). A lookup table for sets admins edit (failure categories). |
| Text search | `citext` for emails, `pg_trgm` GIN indexes for fuzzy serial and customer search |

### 5.2 Core schema (DDL reference)

Prisma generates the real migrations. This DDL is the reviewed target design, and the indexes and constraints here **must** end up in the migrations. Where Prisma can't express something, add it by hand in the migration SQL.

```sql
-- ── Reference data ────────────────────────────────────────────
CREATE TYPE product_family AS ENUM ('meters','gauges','vacuum','leak_detection','combustion','airflow','recovery','other');

CREATE TABLE products (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sku             text NOT NULL UNIQUE,
  name            text NOT NULL,
  family          product_family NOT NULL,
  serial_pattern  text,                     -- regex source, [CONFIRM] per SKU
  launch_date     date,
  image_url       text,
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz
);

CREATE TABLE warranty_policies (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id                uuid REFERENCES products(id),   -- NULL = default policy for all
  base_months               int  NOT NULL CHECK (base_months BETWEEN 0 AND 240),
  registration_bonus_months int  NOT NULL DEFAULT 0 CHECK (registration_bonus_months >= 0),
  registration_window_days  int,             -- bonus only if registered within N days [CONFIRM]
  coverage                  text[] NOT NULL DEFAULT '{}',
  exclusions                text[] NOT NULL DEFAULT '{}',
  effective_from            date NOT NULL,
  effective_to              date,
  created_at                timestamptz NOT NULL DEFAULT now(),
  CHECK (effective_to IS NULL OR effective_to > effective_from)
);
-- Only one policy is active per product at a time
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE warranty_policies ADD CONSTRAINT no_overlapping_policies
  EXCLUDE USING gist (
    coalesce(product_id, '00000000-0000-0000-0000-000000000000'::uuid) WITH =,
    daterange(effective_from, coalesce(effective_to, 'infinity'::date)) WITH &&
  );

-- ── Parties ───────────────────────────────────────────────────
CREATE TABLE organizations (                 -- distributors, service centers, Fieldpiece itself
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type        text NOT NULL CHECK (type IN ('fieldpiece','distributor','service_center')),
  name        text NOT NULL,
  external_ref text,                         -- ERP account number
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idp_subject      text NOT NULL UNIQUE,     -- "sub" claim from the OIDC provider
  email            citext NOT NULL UNIQUE,
  display_name     text NOT NULL,
  organization_id  uuid REFERENCES organizations(id),
  roles            text[] NOT NULL CHECK (roles <@ ARRAY['technician','distributor','claims_agent','service_center','admin']),
  is_active        boolean NOT NULL DEFAULT true,
  last_login_at    timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE customers (                     -- end owners; may or may not have a login
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid UNIQUE REFERENCES users(id),
  distributor_id   uuid REFERENCES organizations(id),
  company_name     text,
  contact_name     text NOT NULL,
  email            citext,
  phone            text,
  address          jsonb NOT NULL,           -- {line1,line2,city,region,postalCode,country}
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  deleted_at       timestamptz
);
CREATE INDEX customers_distributor_idx ON customers (distributor_id) WHERE deleted_at IS NULL;
CREATE INDEX customers_search_trgm ON customers USING gin ((coalesce(company_name,'') || ' ' || contact_name) gin_trgm_ops);

-- ── Registrations ─────────────────────────────────────────────
CREATE TYPE registration_status AS ENUM ('ACTIVE','VOID');  -- EXPIRING_SOON / EXPIRED are computed

CREATE TABLE registrations (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  serial_number     text NOT NULL,
  product_id        uuid NOT NULL REFERENCES products(id),
  customer_id       uuid NOT NULL REFERENCES customers(id),
  distributor_id    uuid REFERENCES organizations(id),
  policy_id         uuid NOT NULL REFERENCES warranty_policies(id),   -- snapshot of the policy used
  purchase_date     date NOT NULL CHECK (purchase_date <= current_date),
  warranty_start    date NOT NULL,
  warranty_end      date NOT NULL,
  status            registration_status NOT NULL DEFAULT 'ACTIVE',
  replaces_registration_id uuid REFERENCES registrations(id),         -- set on replacement units
  version           int NOT NULL DEFAULT 1,
  created_by        uuid NOT NULL REFERENCES users(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CHECK (warranty_end >= warranty_start)
);
-- One ACTIVE registration per physical unit
CREATE UNIQUE INDEX registrations_active_serial_uq
  ON registrations (product_id, upper(serial_number)) WHERE status = 'ACTIVE';
CREATE INDEX registrations_serial_trgm ON registrations USING gin (upper(serial_number) gin_trgm_ops);
CREATE INDEX registrations_customer_idx ON registrations (customer_id);
CREATE INDEX registrations_distributor_end_idx ON registrations (distributor_id, warranty_end);

-- ── Claims ────────────────────────────────────────────────────
CREATE TYPE claim_status AS ENUM (
  'DRAFT','SUBMITTED','IN_REVIEW','NEEDS_INFO','APPROVED','REJECTED',
  'RMA_ISSUED','IN_TRANSIT','RECEIVED','REPAIRED','REPLACED','CREDITED','CLOSED');

CREATE SEQUENCE claim_display_seq;

CREATE TABLE claims (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  display_no         text NOT NULL UNIQUE DEFAULT 'CLM-' || lpad(nextval('claim_display_seq')::text, 6, '0'),
  registration_id    uuid NOT NULL REFERENCES registrations(id),
  failure_category   text NOT NULL REFERENCES failure_categories(code),
  description        text NOT NULL CHECK (char_length(description) BETWEEN 30 AND 5000),
  failure_date       date NOT NULL,
  in_warranty        boolean NOT NULL,       -- evaluated at submit time and frozen
  status             claim_status NOT NULL DEFAULT 'DRAFT',
  resolution         text CHECK (resolution IN ('repair','replace','credit','none')),
  rejection_reason   text,
  return_address     jsonb,
  assigned_to        uuid REFERENCES users(id),
  sla_due_at         timestamptz,
  submitted_at       timestamptz,
  closed_at          timestamptz,
  created_by         uuid NOT NULL REFERENCES users(id),
  version            int NOT NULL DEFAULT 1,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CHECK (status <> 'REJECTED' OR rejection_reason IS NOT NULL)
);
CREATE INDEX claims_queue_idx     ON claims (status, sla_due_at) WHERE status IN ('SUBMITTED','IN_REVIEW','NEEDS_INFO');
CREATE INDEX claims_assignee_idx  ON claims (assigned_to, status);
CREATE INDEX claims_registration_idx ON claims (registration_id);
CREATE INDEX claims_created_by_idx ON claims (created_by, created_at DESC);
CREATE INDEX claims_created_at_brin ON claims USING brin (created_at);   -- cheap for reporting ranges

CREATE TABLE failure_categories (
  code        text PRIMARY KEY,              -- no_power, inaccurate_reading, display, ...
  label       text NOT NULL,
  requires_photo boolean NOT NULL DEFAULT false,
  is_active   boolean NOT NULL DEFAULT true
);

CREATE TABLE claim_events (                  -- append-only timeline
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  claim_id    uuid NOT NULL REFERENCES claims(id),
  actor_id    uuid NOT NULL REFERENCES users(id),
  type        text NOT NULL CHECK (type IN ('created','status_changed','comment','attachment_added','assigned')),
  from_status claim_status,
  to_status   claim_status,
  comment     text,
  internal    boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX claim_events_claim_idx ON claim_events (claim_id, created_at);

-- ── RMA ───────────────────────────────────────────────────────
CREATE SEQUENCE rma_display_seq;
CREATE TABLE rmas (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  display_no          text NOT NULL UNIQUE DEFAULT 'RMA-' || lpad(nextval('rma_display_seq')::text, 6, '0'),
  claim_id            uuid NOT NULL UNIQUE REFERENCES claims(id),   -- one RMA per claim
  type                text NOT NULL CHECK (type IN ('repair','replace','credit')),
  status              text NOT NULL DEFAULT 'ISSUED'
                      CHECK (status IN ('ISSUED','IN_TRANSIT','RECEIVED','INSPECTED','COMPLETED','CANCELLED')),
  service_center_id   uuid REFERENCES organizations(id),
  ship_to             jsonb NOT NULL,
  inbound_carrier     text,  inbound_tracking  text,
  outbound_carrier    text,  outbound_tracking text,
  inspection_notes    text,
  root_cause          text,
  replacement_serial  text,
  credit_amount       numeric(12,2), credit_currency char(3),
  version             int NOT NULL DEFAULT 1,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX rmas_sc_status_idx ON rmas (service_center_id, status);

-- ── Attachments ───────────────────────────────────────────────
CREATE TABLE attachments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_type    text NOT NULL CHECK (owner_type IN ('registration','claim','rma')),
  owner_id      uuid,                        -- NULL until linked after upload
  storage_key   text NOT NULL UNIQUE,
  file_name     text NOT NULL,
  mime_type     text NOT NULL,
  size_bytes    bigint NOT NULL CHECK (size_bytes > 0),
  sha256        text,
  scan_status   text NOT NULL DEFAULT 'PENDING' CHECK (scan_status IN ('PENDING','CLEAN','INFECTED','ERROR')),
  uploaded_by   uuid NOT NULL REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX attachments_owner_idx ON attachments (owner_type, owner_id);

-- ── Platform tables ───────────────────────────────────────────
CREATE TABLE outbox_events (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  aggregate     text NOT NULL,
  aggregate_id  uuid NOT NULL,
  type          text NOT NULL,               -- e.g. claim.approved
  payload       jsonb NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  published_at  timestamptz,
  attempts      int NOT NULL DEFAULT 0
);
CREATE INDEX outbox_unpublished_idx ON outbox_events (id) WHERE published_at IS NULL;

CREATE TABLE idempotency_keys (
  key           text NOT NULL,
  user_id       uuid NOT NULL,
  request_hash  text NOT NULL,
  response_code int,
  response_body jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key)
);

CREATE TABLE audit_log (                     -- partitioned by month
  id            bigint GENERATED ALWAYS AS IDENTITY,
  occurred_at   timestamptz NOT NULL DEFAULT now(),
  actor_id      uuid,
  actor_ip      inet,
  action        text NOT NULL,               -- e.g. claim.status_changed
  entity        text NOT NULL,
  entity_id     uuid,
  before        jsonb,
  after         jsonb,
  request_id    text,
  PRIMARY KEY (id, occurred_at)
) PARTITION BY RANGE (occurred_at);
-- Create partitions ahead of time with pg_partman or a monthly job.
```

Note: create `failure_categories` before `claims` in the actual migration order.

### 5.3 Warranty status is computed, not stored

`EXPIRING_SOON` and `EXPIRED` depend on today's date, so storing them means running a nightly job and risking stale data. Compute them in SQL instead:

```sql
CASE
  WHEN r.status = 'VOID'                             THEN 'VOID'
  WHEN r.warranty_end <  current_date                THEN 'EXPIRED'
  WHEN r.warranty_end <= current_date + $expiring    THEN 'EXPIRING_SOON'   -- default 60 days, from settings
  ELSE 'ACTIVE'
END AS warranty_status
```

### 5.4 Migrations

- Use `prisma migrate dev` locally and `prisma migrate deploy` in CI/CD. **Never run `db push` against a shared DB.**
- Migrations run as a **separate one-off job** before the new version rolls out, not on app start, because several replicas starting at once would race.
- Use the **expand → migrate → contract** pattern for zero-downtime changes: add the nullable column, deploy code that writes to both, backfill in batches, deploy code that reads the new one, then drop the old column in a later release.
- Build big indexes with `CREATE INDEX CONCURRENTLY`. Put that in its own migration file, because it can't run inside a transaction.
- Every migration is reviewed in the PR together with its SQL. Adding a column with a volatile default, or a lock-heavy change, needs a note on estimated lock time.

### 5.5 Seed data

`prisma/seed.ts` has to be idempotent (upsert). It loads the failure categories, a default warranty policy, about 20 sample Fieldpiece products **[CONFIRM real SKU list]**, one org of each type, and one test user per role, mapped to test identities in the dev IdP tenant.

### 5.6 Database roles and privileges

| Role | Used by | Privileges |
|---|---|---|
| `wms_owner` | Migrations job only | Owns schema, DDL |
| `wms_app` | API and worker | `SELECT, INSERT, UPDATE` on app tables; `INSERT` only on `audit_log` and `claim_events`; **no `DELETE`** except `idempotency_keys` and `outbox_events` cleanup; no DDL |
| `wms_readonly` | BI / reporting, pgAdmin for support | `SELECT` on views that mask PII |

```sql
GRANT USAGE ON SCHEMA public TO wms_app, wms_readonly;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO wms_app;
REVOKE UPDATE, DELETE ON audit_log, claim_events FROM wms_app;
GRANT DELETE ON idempotency_keys, outbox_events TO wms_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO wms_app;
ALTER DEFAULT PRIVILEGES FOR ROLE wms_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE ON TABLES TO wms_app;
```

---

## 6. API design standards

### 6.1 Basics

- Base path `/api/v1`. The major version lives in the URL. Additive changes don't bump the version; breaking changes mean `/v2` running alongside `/v1` for at least 6 months, with a `Deprecation` / `Sunset` header on v1.
- JSON only, `camelCase` fields, ISO 8601 UTC timestamps, `YYYY-MM-DD` for dates.
- Resource nouns in plural (`/claims`). Actions that aren't CRUD are sub-resources (`POST /claims/{id}/approve`), not `PATCH status`. That keeps permissions and validation per transition explicit.
- IDs in URLs are UUIDs. Lookups by display number use a query (`GET /claims?displayNo=CLM-000123`).

### 6.2 Endpoint catalogue (v1)

| Method & path | Purpose | Roles |
|---|---|---|
| `GET /health/live`, `GET /health/ready` | Liveness / readiness | public (internal network) |
| `GET /warranty/check?serial=&sku=` | Public warranty lookup, returns minimal data | public, rate-limited |
| `GET /me` | Current user profile + permissions | any |
| `GET /products`, `GET /products/{sku}` | Catalogue | any |
| `POST /products`, `PATCH /products/{sku}` | Manage catalogue | admin |
| `GET/POST /policies`, `PATCH /policies/{id}` | Warranty policies | admin (write), agent (read) |
| `GET /customers`, `POST /customers`, `GET/PATCH /customers/{id}` | Customers | distributor (own), agent, admin |
| `GET /registrations`, `POST /registrations` | List / create | technician (own), distributor (own org), agent, admin |
| `GET /registrations/{id}`, `POST /registrations/{id}/void` | Detail / void | scoped; void = admin |
| `POST /registrations/imports` | Bulk CSV import (async; returns job id) | distributor, admin |
| `GET /imports/{jobId}` | Import job status + error report link | owner |
| `GET /registrations/{id}/certificate` | PDF certificate (signed URL) | scoped |
| `GET /claims`, `POST /claims` | List / create draft | scoped |
| `GET /claims/{id}`, `PATCH /claims/{id}` | Detail / edit draft | scoped; edit only in DRAFT or NEEDS_INFO |
| `POST /claims/{id}/submit` | DRAFT → SUBMITTED | owner |
| `POST /claims/{id}/assign` | Assign agent | claims_agent, admin |
| `POST /claims/{id}/start-review` | → IN_REVIEW | claims_agent |
| `POST /claims/{id}/request-info` | → NEEDS_INFO | claims_agent |
| `POST /claims/{id}/respond` | NEEDS_INFO → IN_REVIEW | owner |
| `POST /claims/{id}/approve` | → APPROVED, creates RMA | claims_agent |
| `POST /claims/{id}/reject` | → REJECTED | claims_agent |
| `GET /claims/{id}/events`, `POST /claims/{id}/comments` | Timeline / comments | scoped (internal notes hidden from customers) |
| `GET /rmas`, `GET /rmas/{id}` | RMAs | agent, service_center, admin |
| `POST /rmas/{id}/ship-inbound`, `/receive`, `/inspect`, `/complete`, `/cancel` | RMA lifecycle | service_center, agent |
| `POST /attachments/upload-url` | Get presigned PUT URL | any authenticated |
| `POST /attachments/{id}/confirm` | Confirm upload, trigger scan | uploader |
| `GET /attachments/{id}/download-url` | Presigned GET (5-min expiry) | scoped |
| `GET /reports/claims-summary`, `/claim-rate-by-sku`, `/failure-categories`, `/resolution-time`, `/cost` | Analytics | claims_agent, admin |
| `GET/POST/PATCH /users`, `GET /users/{id}` | User admin | admin |
| `GET /audit?entity=&entityId=` | Audit trail | admin |

### 6.3 Pagination, filtering, sorting

List endpoints take `?page=1&pageSize=25&sort=-createdAt&status=SUBMITTED,IN_REVIEW&q=...`

```json
{ "items": [ ... ], "page": 1, "pageSize": 25, "total": 342 }
```

- `pageSize` max is 100. Anything larger is capped, not rejected.
- `sort` fields come from an allow-list per endpoint. **Never interpolate them into SQL.**
- For large, fast-growing sets (claim events, audit), use **keyset pagination** (`?after=<cursor>`) and return `nextCursor` instead of `total`.
- `total` uses `count(*)` over the filtered set. If that gets slow at scale, switch to an estimate above 10k rows and flag it with `"totalIsEstimate": true`.

### 6.4 Error format (the frontend depends on this)

```json
{
  "code": "CLAIM_INVALID_TRANSITION",
  "message": "A claim in status REJECTED cannot be approved.",
  "fieldErrors": { "purchaseDate": ["Must not be in the future"] },
  "requestId": "01J8Z6Q7X9..."
}
```

| HTTP | When | Example `code` |
|---|---|---|
| 400 | Malformed request / validation | `VALIDATION_FAILED` |
| 401 | Missing / invalid token | `UNAUTHENTICATED` |
| 403 | Authenticated but not allowed | `FORBIDDEN` |
| 404 | Not found **or not in the caller's scope** (don't leak that it exists) | `NOT_FOUND` |
| 409 | Conflict: duplicate serial, stale `version`, bad state transition | `REGISTRATION_DUPLICATE_SERIAL`, `STALE_VERSION`, `CLAIM_INVALID_TRANSITION` |
| 413 | Upload too large | `PAYLOAD_TOO_LARGE` |
| 422 | Business rule broken (valid shape, wrong meaning) | `PURCHASE_BEFORE_LAUNCH`, `PHOTO_REQUIRED` |
| 429 | Rate limited (with `Retry-After`) | `RATE_LIMITED` |
| 500 | Unexpected; generic message, details only in logs | `INTERNAL_ERROR` |
| 503 | Dependency down / shutting down | `SERVICE_UNAVAILABLE` |

Keep all codes in `src/common/errors/error-codes.ts` as one `enum`, and publish them in the Swagger spec so the frontend can map them to messages. **Never return stack traces, SQL or internal hostnames.**

### 6.5 Concurrency and idempotency

- **Optimistic locking:** `GET` returns an `ETag: W/"<version>"`. Mutations need `If-Match`. Updates run as `UPDATE ... WHERE id=$1 AND version=$2`, and if zero rows change the API returns **409 `STALE_VERSION`**. This stops two agents from overwriting each other's decisions.
- **Idempotency:** every `POST` that creates something or triggers a transition accepts an `Idempotency-Key` header (a UUID from the client). The key and request hash are stored for 24h, and a replay returns the stored response. Reusing a key with a different body returns 422. This makes network retries on "Submit claim" safe.

### 6.6 Swagger / OpenAPI

`main.ts`:

```ts
if (env.SWAGGER_ENABLED) {
  const config = new DocumentBuilder()
    .setTitle("Fieldpiece Warranty Management API")
    .setDescription("Registrations, warranty lookup, claims and RMA for Fieldpiece products.")
    .setVersion(pkg.version)
    .addBearerAuth({ type: "http", scheme: "bearer", bearerFormat: "JWT" }, "jwt")
    .addServer("/")
    .build();
  const doc = SwaggerModule.createDocument(app, config, { operationIdFactory: (c, m) => `${c.replace("Controller", "")}_${m}` });
  SwaggerModule.setup("docs", app, doc, { swaggerOptions: { persistAuthorization: true } });
}
```

Documentation rules:

1. Every endpoint has `@ApiOperation({ summary, description })`, `@ApiTags(module)`, `@ApiBearerAuth('jwt')` (unless it's public), and **every** possible response with `@ApiResponse` / `@ApiOkResponse`, including the error codes it can return.
2. DTO fields use `@ApiProperty` with `example`, `format`, `enum`, `minLength` / `maxLength`. The examples should look like real Fieldpiece data (e.g. SKU `SC680`), not `"string"`.
3. Use the `@nestjs/swagger` CLI plugin in `nest-cli.json` so properties are picked up without writing every decorator by hand.
4. A CI step exports `openapi.json`, runs **Spectral** lint on it (naming, every operation has security, examples present), and diffs it against `main` with **oasdiff**. **Breaking changes fail the build** unless the PR is labelled `api-breaking`.
5. The spec is published as a build artifact. The frontend generates types with `openapi-typescript`.
6. Swagger UI is **off in production** (`SWAGGER_ENABLED=false`). If partners need docs, publish a static Redoc page behind auth.

---

## 7. Authentication and authorisation

### 7.1 Authentication

- The frontend does OIDC Authorization Code + PKCE with the IdP. The API only receives `Authorization: Bearer <access_token>`.
- Validate with `jose`: signature against the JWKS (cached, with kid rotation), `iss`, `aud`, `exp` / `nbf` (60s clock skew max), and allowed `alg` (RS256/ES256 only, **never `none` or HS256 with a public key**).
- On the first request, upsert `users` by `idp_subject`. Roles come from our DB (managed by admins), **not straight from token claims**, unless the IdP is the agreed source of truth. **[CONFIRM]**
- There are no API sessions and no cookies, so there's no CSRF surface on the API.
- Service-to-service calls (ERP integration, workers calling out) use client-credentials tokens with narrow scopes.

### 7.2 Authorisation: two layers, both required

**Layer 1: role guard (can this role call this endpoint at all?)**

```ts
@Roles("claims_agent", "admin")
@Post(":id/approve")
approve(...) {}
```

**Layer 2: data scope (can this user see *this* row?)** This one is where real bugs come from, so it's never left to the controller:

```ts
// common/auth/scope.ts
export function claimScope(user: AuthUser): Prisma.ClaimWhereInput {
  if (user.hasAny("claims_agent", "admin")) return {};
  if (user.has("service_center")) return { rma: { serviceCenterId: user.organizationId } };
  if (user.has("distributor")) return { registration: { distributorId: user.organizationId } };
  return { createdBy: user.id };                         // technician
}
```

Every repository read takes the scope and merges it into its `where`. When a row is out of scope, the API returns **404, not 403**.

**Optional, extra protection:** turn on Postgres **Row-Level Security** on `claims`, `registrations` and `customers`, with policies keyed on `current_setting('app.user_id')` / `app.org_id`, set per transaction with `SET LOCAL`. Then even a buggy query can't leak another distributor's data. Decide this by the end of sprint 2. **[CONFIRM]**

### 7.3 Permission matrix (source of truth for tests)

| Action | tech | dist | agent | svc | admin |
|---|:-:|:-:|:-:|:-:|:-:|
| Create registration | own | own org | ✓ | – | ✓ |
| Bulk import | – | ✓ | – | – | ✓ |
| Void registration | – | – | – | – | ✓ |
| Create / submit claim | own | own org | ✓ | – | ✓ |
| Review / approve / reject | – | – | ✓ | – | ✓ |
| See internal notes | – | – | ✓ | ✓ | ✓ |
| Update RMA inspection | – | – | – | own center | ✓ |
| Reports | – | own org (limited) | ✓ | – | ✓ |
| Manage users / policies / products | – | – | – | – | ✓ |

Write one e2e test per cell that checks both the allowed **and** denied result.

---

## 8. Core business logic

### 8.1 Warranty engine (`modules/warranty/warranty.engine.ts`)

This is a pure function with no I/O:

```ts
export function computeWarranty(input: {
  purchaseDate: Date;
  registeredAt: Date;
  policy: { baseMonths: number; registrationBonusMonths: number; registrationWindowDays?: number | null };
}): { start: Date; end: Date; bonusApplied: boolean } {
  const start = startOfDay(input.purchaseDate);
  const withinWindow =
    input.policy.registrationWindowDays == null ||
    differenceInCalendarDays(input.registeredAt, input.purchaseDate) <= input.policy.registrationWindowDays;
  const bonus = withinWindow ? input.policy.registrationBonusMonths : 0;
  const end = subDays(addMonths(start, input.policy.baseMonths + bonus), 1);
  return { start, end, bonusApplied: bonus > 0 };
}
```

- The policy is chosen by `product_id` and `purchase_date` (the one in effect on that date), falling back to the default policy (`product_id IS NULL`).
- The chosen `policy_id` is saved on the registration, so later policy edits never change existing coverage.
- Unit tests must cover month-end dates (31 Jan + 1 month), leap years, a window boundary at exactly N days, and a zero bonus. **[CONFIRM]** the real Fieldpiece terms.

### 8.2 Registration rules

1. The serial is normalised with `trim().toUpperCase()` and checked against `products.serial_pattern` if one is set.
2. `purchase_date` can't be in the future or before `launch_date`. Either failure returns 422.
3. A duplicate active serial returns 409 `REGISTRATION_DUPLICATE_SERIAL`. The response body tells the caller whether **they** own the existing registration, and never exposes someone else's customer data.
4. Proof of purchase is required **[CONFIRM]**, and the attachment must have `scan_status = CLEAN` before it can be linked.
5. Inside one transaction: insert the registration, the audit row, and an outbox event `registration.created` (which sends a confirmation email and builds the certificate PDF).

### 8.3 Claim state machine (`claim-state-machine.ts`)

```ts
type T = { from: ClaimStatus[]; to: ClaimStatus; roles: Role[]; requires?: (c: Claim, input: any) => string | null };

export const TRANSITIONS: Record<string, T> = {
  submit:       { from: ["DRAFT"],                   to: "SUBMITTED",  roles: ["technician", "distributor", "claims_agent", "admin"] },
  startReview:  { from: ["SUBMITTED"],               to: "IN_REVIEW",  roles: ["claims_agent", "admin"] },
  requestInfo:  { from: ["IN_REVIEW"],               to: "NEEDS_INFO", roles: ["claims_agent", "admin"],
                  requires: (_, i) => (i?.message ? null : "MESSAGE_REQUIRED") },
  respond:      { from: ["NEEDS_INFO"],              to: "IN_REVIEW",  roles: ["technician", "distributor"] },
  approve:      { from: ["IN_REVIEW"],               to: "APPROVED",   roles: ["claims_agent", "admin"],
                  requires: (_, i) => (i?.resolution ? null : "RESOLUTION_REQUIRED") },
  reject:       { from: ["IN_REVIEW"],               to: "REJECTED",   roles: ["claims_agent", "admin"],
                  requires: (_, i) => (i?.reason ? null : "REASON_REQUIRED") },
  issueRma:     { from: ["APPROVED"],                to: "RMA_ISSUED", roles: ["system"] },      // automatic after approve
  shipInbound:  { from: ["RMA_ISSUED"],              to: "IN_TRANSIT", roles: ["technician", "distributor", "service_center", "claims_agent"] },
  receive:      { from: ["IN_TRANSIT", "RMA_ISSUED"],to: "RECEIVED",   roles: ["service_center"] },
  complete:     { from: ["RECEIVED"],                to: /* REPAIRED | REPLACED | CREDITED by resolution */ "REPAIRED", roles: ["service_center", "claims_agent"] },
  close:        { from: ["REPAIRED", "REPLACED", "CREDITED", "REJECTED"], to: "CLOSED", roles: ["system", "claims_agent", "admin"] },
};
```

A service method for a transition does all of this in **one DB transaction**:

1. Load the claim with the caller's scope → 404 if it isn't there.
2. Check the role, the `from` status and `requires` → 403 / 409 / 422.
3. `UPDATE claims SET status=..., version=version+1 WHERE id=$1 AND version=$2` → if 0 rows, 409 `STALE_VERSION`.
4. Insert a `claim_events` row and an `audit_log` row.
5. Insert an `outbox_events` row (e.g. `claim.approved`).
6. On `approve`, create the RMA and move to `RMA_ISSUED` in the same transaction.

The same `TRANSITIONS` table drives an `allowedActions` array in the `GET /claims/{id}` response, so the frontend never has to copy this logic.

### 8.4 SLA

- `sla_due_at = submitted_at + SLA hours` (default 48 business hours, configurable **[CONFIRM]**). Business-hours maths lives in one tested utility and uses a holiday calendar table.
- A repeatable BullMQ job every 15 minutes finds breached claims (using the partial index), emits a `claim.sla_breached` event once per claim, and escalates according to settings.

### 8.5 Attachments flow

```
Client ── POST /attachments/upload-url {fileName, mime, size, ownerType}
API    ── validate mime (allow-list) & size → insert attachments(PENDING) → presigned PUT (5 min, content-type + length pinned)
Client ── PUT file straight to storage
Client ── POST /attachments/{id}/confirm
API    ── HEAD object, verify size / type → enqueue "scan" job
Worker ── virus scan (ClamAV sidecar or cloud Defender for Storage) → CLEAN / INFECTED
         INFECTED → delete object, mark, notify uploader
```

- Allow-list: `image/jpeg`, `image/png`, `image/heic`, `image/webp`, `application/pdf`, `video/mp4` (max 50 MB, claims only). Check the **magic bytes** in the worker, not only the declared type.
- Storage keys are random (`claims/2026/09/<uuid>`), never the user's file name.
- The bucket is private. Downloads always go through short-lived presigned GETs, and only after a scope check.
- Strip EXIF GPS data from images before a thumbnail is served. **[CONFIRM]** whether the originals have to be kept.

### 8.6 Bulk registration import

`POST /registrations/imports` takes an already-uploaded CSV attachment ID and enqueues a job. The worker streams the CSV with `csv-parse` (never loading it all into memory), validates each row with the same zod schema as the single endpoint, inserts valid rows in batches of 500 using `ON CONFLICT DO NOTHING` on the active-serial index, and writes an error CSV. Progress goes to Redis and is read through `GET /imports/{jobId}`. Limit: 10,000 rows per file.

---

## 9. Performance

### 9.1 Targets (SLOs)

| Metric | Target |
|---|---|
| p95 latency, reads (lists, detail, lookup) | < 200 ms |
| p95 latency, writes (register, transition) | < 400 ms |
| p99 latency, anything except reports | < 1 s |
| Report endpoints p95 | < 2 s |
| Throughput per API container (1 vCPU / 1 GB) | ≥ 300 req/s on mixed read traffic |
| Error rate (5xx) | < 0.1% |
| Availability | 99.9% monthly (about 43 min of downtime) |

Check these with k6 before every major release (see 13.4).

### 9.2 Database

- **Connection pooling:** PgBouncer in **transaction mode** in front of Postgres. Prisma runs with `?pgbouncer=true&connection_limit=10`. Budget: `replicas × connection_limit` ≤ PgBouncer pool, and PgBouncer pool ≤ about 80% of `max_connections`.
- **Timeouts:** set `statement_timeout = 5s` on the app role and `idle_in_transaction_session_timeout = 30s`. Reports use their own role or session with a 30s limit.
- **Indexes:** every FK column, every `WHERE` or `ORDER BY` a list endpoint uses, and partial indexes for queue queries. Check slow queries with `EXPLAIN (ANALYZE, BUFFERS)`, and attach that output to the PR for any new list query.
- **No N+1:** use Prisma `include` / `select` on purpose. Log a warning in dev when one request runs more than 15 queries.
- **Select only needed columns.** List DTOs are slimmer than detail DTOs.
- **Reports** run on the **read replica** (`DATABASE_REPLICA_URL`) through raw SQL. Heavy dashboards read from **materialized views** refreshed every 15 minutes with `REFRESH MATERIALIZED VIEW CONCURRENTLY` (e.g. `mv_claims_daily`, `mv_claim_rate_by_sku`).
- **Monitoring:** keep `pg_stat_statements` on. A weekly look at the top 10 queries by total time is part of the team routine.
- **Housekeeping:** autovacuum tuned for the `claims` / `claim_events` churn, monthly audit partitions, and a job that deletes idempotency keys older than 24h and published outbox rows older than 7 days.

### 9.3 Caching (Redis)

| What | TTL | Invalidation |
|---|---|---|
| Product catalogue, failure categories, active policies | 10 min | On admin write, delete the key |
| Public warranty check result by serial | 5 min | On registration create / void |
| JWKS keys | 1 h | On unknown `kid`, refetch |
| Report query results (per filter hash) | 5 min | Time-based only |
| `/me` permissions | 60 s | On user role change |

Use the cache-aside pattern with a short lock (`SET NX`) to stop stampedes on hot keys. **Never cache scoped data under a key that doesn't include the user or org.**

### 9.4 Application

- Fastify adapter, and JSON response serialisation through schemas where possible.
- Enable `compression` (gzip/br) for responses over 1 KB, or leave it to the gateway if it already does it.
- Anything slower than about 100 ms that the user doesn't need to wait for goes to BullMQ: emails, PDFs, CSV, ERP sync, thumbnails.
- Don't block the event loop: no sync crypto or FS on the request path, and use `pdfkit` / Puppeteer only in the worker.
- Set `keepAliveTimeout` above the load balancer's idle timeout (e.g. 65s vs 60s) to avoid random 502s.

---

## 10. Scalability

- **Stateless API:** no in-memory sessions, caches that must agree across instances, or local file writes. Anything shared lives in Postgres, Redis or object storage.
- **Horizontal scaling:** autoscale API containers on CPU (60%) and p95 latency. Minimum 2 replicas in prod, across availability zones.
- **Workers scale separately**, based on queue depth. Queues have their own concurrency: `email` 20, `pdf` 4, `import` 2, `scan` 8, `integration` 5.
- **Database scaling path**, in order. Only move to the next step when metrics say so:
  1. Better indexes and queries
  2. A bigger instance
  3. Read replica for reports and public lookups
  4. Materialized views
  5. Partition `claim_events` and `audit_log` by month
  6. Split out a module DB, only if one domain really dominates.
- **Rate limits** protect shared resources (see 11.4).
- **Graceful degradation:** if Redis is down, the API skips the cache and keeps serving from the DB, and rate limiting falls back to an in-process limiter. If object storage is down, uploads fail with 503 but everything else keeps working.

---

## 11. Security

Build against the **OWASP API Security Top 10 (2023)** and the **OWASP ASVS L2**.

### 11.1 Transport and headers

- TLS 1.2+ everywhere. TLS ends at the gateway, and the internal hop is TLS too where the platform supports it. HSTS is 1 year with `includeSubDomains`.
- `@fastify/helmet` with a strict set: `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`, and a CSP on the Swagger page.
- CORS: an explicit origin allow-list from `CORS_ORIGINS`, never `*`. Allow the `Authorization`, `Content-Type`, `If-Match` and `Idempotency-Key` headers. Expose `ETag`, `Retry-After` and `X-Request-Id`.
- Request body limit is 1 MB (files don't go through the API anyway).

### 11.2 Input and output

- Validate **every** input (body, query, params, headers) with zod or class-validator. Unknown fields are **stripped** (`whitelist: true, forbidNonWhitelisted: true`). This blocks mass assignment, OWASP API3.
- Responses go through explicit response DTOs. **Never return a Prisma entity directly**, because it leaks fields like `idp_subject` or internal notes.
- SQL uses Prisma or parameterised `$queryRaw` tagged templates. **Ban `$queryRawUnsafe`** with a lint rule.
- For user text shown in emails or PDFs, escape it at render time.

### 11.3 Access control (the #1 risk in this app)

- Object-level authorisation (BOLA, OWASP API1): every read and write goes through the scope helpers in 7.2. Automated tests try reading claim B as the owner of claim A, and a distributor reading another distributor's customers.
- Function-level (OWASP API5): the `@Roles` guard is on **by default for every route**. Public routes have to opt out explicitly with `@Public()`, and a CI script lists all public routes so the reviewer sees them.
- Internal notes are filtered out in the repository layer for customer roles, not in the controller.

### 11.4 Abuse protection

| Scope | Limit |
|---|---|
| Public `/warranty/check` | 20 / min per IP, 500 / day per IP, plus CAPTCHA after 10 misses **[CONFIRM]** |
| Authenticated default | 300 / min per user |
| Writes (POST / PATCH) | 60 / min per user |
| Upload URL creation | 30 / min per user |
| Bulk import | 5 / hour per org |

Use `@nestjs/throttler` with Redis storage. Return 429 with a `Retry-After` header. Put a WAF (Azure Front Door / AWS WAF) in front, with the OWASP core rule set and bot protection.

The public lookup returns **only** the product name, SKU, warranty status and end date. It never returns customer, distributor or purchase details. Serial enumeration (OWASP API6) is limited by rate limits and by monitoring for scraping patterns.

### 11.5 Data protection

- PII: customer name, email, phone, address. Encrypt it at rest (managed disk / TDE on the DB and storage), mask it in logs (pino `redact` paths), and serve it to BI only through views that hide email and phone.
- Backups are encrypted. Access to prod data needs a ticket and is logged.
- Retention: claims and registrations are kept 7 years **[CONFIRM]** with legal, the audit log 2 years online then archived, and application logs 30 days.
- A "right to erasure" request is handled by anonymising customer PII while keeping claim history. This is an admin-only endpoint and is itself audited.

### 11.6 Supply chain and runtime

- Commit `pnpm-lock.yaml` and install with `pnpm install --frozen-lockfile` in CI.
- `pnpm audit --prod` and **Trivy** (image and filesystem) run in CI, and a high or critical finding fails the build unless it has a recorded exception with an expiry date. Renovate / Dependabot opens weekly update PRs.
- Semgrep or CodeQL for SAST. OWASP ZAP baseline scan against staging each release.
- The container runs as a **non-root** user on a read-only root filesystem, drops all Linux capabilities, and has no shell in the prod image (distroless).
- Sign images with **cosign**, and let the cluster only pull signed images from our registry.

### 11.7 Audit

Every state change writes an `audit_log` row with: who, from which IP, what, the before and after values (with PII diffed carefully), and the request ID. Login events come from the IdP's logs. Admin actions (role changes, voids, policy edits) also send an alert to a monitored channel.

---

## 12. Reliability

### 12.1 Health and lifecycle

- `/health/live` answers 200 if the process event loop is responsive. It has **no dependency checks**, so a DB blip doesn't make the orchestrator restart every pod.
- `/health/ready` checks the DB (`SELECT 1`, 1s timeout) and Redis. It returns 503 during startup and shutdown.
- **Graceful shutdown** on `SIGTERM`: mark not-ready, stop accepting new requests, let in-flight requests finish (up to 25s), close the Prisma and Redis connections, then exit. Workers finish their current job, or return it to the queue.
- `enableShutdownHooks()` in Nest. The container's `terminationGracePeriodSeconds` is 30.

### 12.2 Failure handling

- **Timeouts on every outbound call:** DB 5s, Redis 500ms, HTTP integrations 5s by default. Never let a call hang forever.
- **Retries** only on idempotent operations and transient errors (network, 502 / 503 / 504, Postgres serialisation failure `40001`), with exponential backoff and jitter, at most 3 attempts.
- **Circuit breaker** (`opossum`) around third-party APIs (ERP, carriers, SMS) so a slow partner doesn't eat all the workers.
- **Queue jobs:** `attempts: 5`, exponential backoff, then a **dead-letter queue**. A DLQ that isn't empty raises an alert. Every job handler has to be idempotent (check the result before acting).
- **Outbox relay:** a worker loop reads unpublished `outbox_events` with `FOR UPDATE SKIP LOCKED` in batches of 100, publishes them to BullMQ, and marks them `published_at`. That gives at-least-once delivery, so consumers de-duplicate by event ID.

### 12.3 Data safety

- Managed Postgres with **PITR (point-in-time recovery), 14-day window**, plus daily snapshots kept for 35 days. Stream WAL to another region for DR. **[CONFIRM]** whether cross-region DR is needed.
- **RPO ≤ 5 min, RTO ≤ 1 h.** Do a restore drill **every quarter** into a scratch environment and write down the result.
- Object storage: versioning on, soft delete for 30 days.

### 12.4 Observability

| Signal | Tool | Must have |
|---|---|---|
| Logs | **pino** as JSON, shipped to Azure Monitor / CloudWatch / Loki | `requestId`, `userId`, `route`, `status`, `durationMs`; PII redacted; no bodies at `info` |
| Traces | **OpenTelemetry** (auto-instrument HTTP, Prisma, Redis, BullMQ), OTLP export | Trace ID in log lines and in the `X-Request-Id` response header |
| Metrics | Prometheus endpoint `/metrics` (internal only) or OTel metrics | RED metrics per route, DB pool usage, queue depth / age, cache hit rate, business counters (claims submitted, approved) |
| Errors | Sentry (or App Insights) | Release tagging, source maps, user ID (not email) |

**Alerts** (paging vs ticket):

- **Page:** 5xx over 2% for 5 min, p95 over 1s for 10 min, readiness failing on more than half the pods, DB CPU over 85% for 15 min, DB storage over 85%, DLQ over 0 for `integration` / `email`, and the outbox backlog over 1,000 or its oldest item over 10 min.
- **Ticket:** SLA breach count rising, cache hit rate under 70%, dependency CVE found.

Every alert links to a runbook in `docs/runbooks/`.

---

## 13. Testing strategy

### 13.1 Pyramid

| Level | Tool | Scope | Target |
|---|---|---|---|
| Unit | Jest (or Vitest) | Warranty engine, state machine, SLA maths, scope helpers, mappers | ≥ 90% lines on `modules/*/**/*.engine.ts`, `*state-machine.ts` |
| Integration | Jest + **Testcontainers** (real Postgres 16 + Redis) | Repositories, transactions, constraints, migrations apply cleanly | Every repository method |
| API / e2e | Jest + supertest on the Nest app with a test JWT issuer | Every endpoint: happy path, validation, authz matrix (7.3), 404-for-out-of-scope | Every row of 6.2 |
| Contract | OpenAPI diff + Schemathesis (fuzzing against the spec) | The API matches the published spec | Runs in CI on staging |
| Load | **k6** | 9.1 SLOs | Before each major release |
| Security | ZAP baseline, Trivy, Semgrep | 11.6 | Every release |

### 13.2 Test data

- Factories live in `test/fixtures/` (for example `makeClaim({ status: 'IN_REVIEW' })`). Tests never depend on seed data.
- Each integration test file gets its own schema or truncates the tables. Tests run in parallel.
- Test JWTs are signed by a local key pair exposed through a fake JWKS in the test module. Never mock the guard away.

### 13.3 Must-have test cases

- Duplicate serial: two parallel requests, exactly one wins (the unique index does its job).
- Two agents approve the same claim at once: one gets 409 `STALE_VERSION`.
- Idempotency: replaying a submit with the same key gives the same response, and no second claim or event is created.
- Distributor A can't list, read or edit distributor B's customers, registrations or claims.
- A technician never sees `internal: true` events.
- Outbox: if the transaction rolls back, no event is published. If the relay crashes partway through, the event is published again and the consumer de-duplicates it.
- Warranty engine edge dates (8.1).

### 13.4 Load test profile (k6)

A mixed scenario with 200 virtual users for 15 minutes: 50% list claims, 20% claim detail, 15% warranty check, 10% create registration, 5% transitions. Pass if the 9.1 thresholds hold and the error rate stays under 0.1%. Run it against staging with production-like data volumes: 500k registrations and 100k claims, generated by `test/load/seed-volume.ts`.

---

## 14. Docker and deployment

### 14.1 `Dockerfile` (multi-stage)

```dockerfile
# syntax=docker/dockerfile:1.7
ARG NODE_VERSION=22

FROM node:${NODE_VERSION}-alpine AS base
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,target=/root/.local/share/pnpm/store pnpm install --frozen-lockfile

FROM deps AS dev
COPY . .
RUN pnpm prisma generate
CMD ["pnpm", "start:dev"]

FROM deps AS build
COPY . .
RUN pnpm prisma generate && pnpm build && pnpm prune --prod

FROM gcr.io/distroless/nodejs22-debian12:nonroot AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build --chown=nonroot:nonroot /app/node_modules ./node_modules
COPY --from=build --chown=nonroot:nonroot /app/dist ./dist
COPY --from=build --chown=nonroot:nonroot /app/prisma ./prisma
COPY --from=build --chown=nonroot:nonroot /app/package.json ./
USER nonroot
EXPOSE 3000
CMD ["dist/main.js"]          # worker: override with ["dist/worker.js"]
```

Notes:

- If Prisma's query engine needs OpenSSL / glibc that distroless doesn't have, use `node:22-bookworm-slim` with a non-root user. Test the image in CI with `docker run ... node -e "require('@prisma/client')"`.
- Add a `.dockerignore` that excludes `node_modules`, `.git`, `.env*`, `test`, `coverage` and `docs`.
- Image tags are the git SHA plus semver. **Never deploy `latest`.**

### 14.2 Environments

| Env | Purpose | Data | Swagger | pgAdmin |
|---|---|---|---|---|
| local | Development | Seed | on | container |
| dev | Integration of merged work | Seed + synthetic | on | container (VPN) |
| staging | Pre-prod, load and security tests, UAT | Anonymised copy / synthetic volume | on (auth) | restricted |
| prod | Live | Real | **off** | **none**; bastion + named DB accounts |

### 14.3 CI/CD pipeline

```
PR:      install → lint (eslint, prettier) → typecheck → unit → integration (Testcontainers)
         → build image → Trivy scan → OpenAPI export + Spectral + oasdiff → e2e against compose stack
main:    all of the above → push signed image → migrate dev DB (job) → deploy dev → smoke tests
release: tag vX.Y.Z → deploy staging → migrate → k6 + ZAP → manual approval
         → migrate prod (job) → rolling / blue-green deploy prod → smoke → auto-rollback on failed readiness or 5xx spike
```

- Migrations run as a separate job with the `wms_owner` credentials. The app never gets DDL rights.
- Deploys are rolling with `maxUnavailable: 0`, and migrations have to be backward compatible with the version before (5.4).
- Feature flags (Unleash / LaunchDarkly / a DB table) let risky features ship dark.

---

## 15. Coding standards

- TypeScript `strict: true`, `noUncheckedIndexedAccess: true`. No `any`. Use `unknown` and narrow it.
- ESLint with `@typescript-eslint/recommended-type-checked`, `eslint-plugin-boundaries`, `no-floating-promises`, and a custom rule that bans `$queryRawUnsafe` and `console.*`.
- Prettier, Husky + lint-staged, Conventional Commits, and PR titles checked in CI.
- **Errors:** throw `AppError(code, httpStatus, message, details?)`, and let the global filter map it. Never `throw new Error('...')` from services for expected business failures.
- **Transactions:** use `prisma.$transaction(async (tx) => ...)` inside services. Pass `tx` down to repositories. Never start a transaction in a controller.
- **Dates:** the server's clock is always UTC. Put `Clock` behind an injectable interface so tests can freeze time.
- **Logging:** use the injected logger, with structured fields and no string concatenation. Never log tokens, passwords, full addresses or file contents.
- **PR checklist:**
  - [ ] Tests added or updated at the right level, and green
  - [ ] Swagger decorators complete, spec diff reviewed
  - [ ] Migration reviewed (locks, backfill, `CONCURRENTLY` where needed)
  - [ ] New queries: `EXPLAIN ANALYZE` attached, indexes present
  - [ ] Authz: role guard plus data scope applied, negative tests written
  - [ ] No secrets, no PII in logs
  - [ ] Runbook / ADR updated if behaviour or operations changed

---

## 16. Delivery plan (suggested)

| Sprint (2 wks) | Scope |
|---|---|
| 0 | Repo, CI, Docker compose, config, logging, health, auth guard with the dev IdP, Swagger skeleton, base schema + seeds |
| 1 | Products, policies, warranty engine, public warranty check, customers |
| 2 | Registrations (single + attachments + certificate PDF), audit, outbox + email worker. **Decision on RLS.** |
| 3 | Claims: draft, submit, comments, timeline, state machine, assignment, SLA job |
| 4 | Approve / reject → RMA lifecycle, service center flows, notifications |
| 5 | Bulk import, reports + materialized views, admin (users / roles) |
| 6 | Hardening: load tests, ZAP, DR restore drill, runbooks, prod readiness review |

---

## 17. Open items to confirm

1. Identity provider, and whether roles are managed in the IdP or in the app DB.
2. Cloud and runtime: Azure (Container Apps / AKS, Azure Database for PostgreSQL Flexible Server, Blob, Key Vault) or AWS (ECS, RDS, S3, Secrets Manager).
3. Real warranty terms per product family, registration bonus and window, proof-of-purchase requirement.
4. Serial number formats per SKU.
5. SLA hours, business calendar, escalation contacts.
6. Out-of-warranty claims (paid repair quotes: in scope for v1?).
7. Replacement unit warranty rule.
8. Integrations: ERP (orders / credits), CRM, carrier tracking, SMS provider, email sender domain (SPF / DKIM / DMARC).
9. Data retention periods and regions (data residency for Canada / Mexico customers?).
10. Cross-region DR requirement and budget.
11. Row-level security in Postgres: yes or no (decide by the end of sprint 2).

---

*This document is the backend counterpart to the frontend instructions. When the domain model, statuses, roles or error format change, update both documents in the same PR.*

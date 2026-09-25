# Fieldpiece WMS: Backend

API and background worker for the Fieldpiece Warranty Management System. Built to
[FIELDPIECE_WARRANTY_BACKEND_INSTRUCTIONS.md](FIELDPIECE_WARRANTY_BACKEND_INSTRUCTIONS.md) (the "build guide"). Read it
before changing anything.

**Stack:** Node 20, NestJS 10 on Fastify, TypeScript (strict), Prisma 6 + PostgreSQL 16, Redis + BullMQ, S3-compatible
object storage (MinIO locally), zod (env + DTOs via `nestjs-zod`), pino, Jest.

## Getting started

```bash
cd backend
cp .env.example .env
docker compose up -d                 # postgres :5433, redis :6379, minio :9000/:9001, mailpit :8025, pgadmin :5050
pnpm install
pnpm db:deploy && pnpm db:seed       # migrate as wms_owner, then load demo data (safe to re-run)
pnpm db:seed:images                  # optional, needs internet: official product photos into MinIO
pnpm start:dev                       # API   -> http://localhost:3000/api/v1   (Swagger at /docs)
pnpm worker:dev                      # worker: outbox relay, email, PDFs, file scan, imports, SLA + purge jobs
```

Then start the frontend with `npm run dev` in `../frontend`. It talks to this API and to the dev identity provider.

Postgres is on host port **5433** so it doesn't clash with a locally installed Postgres on 5432.

### Signing in (development)

`DEV_IDP_ENABLED=true` turns on a built-in identity provider at `/dev-idp`. It signs real RS256 tokens and serves a
JWKS, so the guard verifies tokens exactly as it would with the production IdP. There are no passwords. Pick a seeded
user on the sign-in screen:

| Email               | Role                              |
| ------------------- | --------------------------------- |
| `tech@example.com`  | Technician                        |
| `dist@example.com`  | Distributor (sees its org's data) |
| `agent@example.com` | Claims agent                      |
| `svc@example.com`   | Service center                    |
| `admin@example.com` | Admin                             |

Roles come from the `users` table, not the token (cached for 60 s). The dev IdP refuses to start when
`NODE_ENV=production`.

### Local tools

| Tool          | URL                        | Login                          |
| ------------- | -------------------------- | ------------------------------ |
| Swagger       | http://localhost:3000/docs | —                              |
| Mailpit       | http://localhost:8025      | —                              |
| MinIO console | http://localhost:9001      | values in `.env` (`STORAGE_*`) |
| pgAdmin       | http://localhost:5050      | values in `docker-compose.yml` |

## Scripts

| Script                          | What it does                                                             |
| ------------------------------- | ------------------------------------------------------------------------ |
| `pnpm start:dev` / `worker:dev` | API / worker with watch mode                                             |
| `pnpm build`, `start`, `worker` | Compile, then run `dist/main.js` / `dist/worker.js`                      |
| `pnpm typecheck` / `lint`       | `tsc --noEmit` / ESLint with zero warnings                               |
| `pnpm test` / `test:cov`        | Unit tests (engines, state machines, scope, SLA, file policy)            |
| `pnpm test:e2e`                 | HTTP tests through `app.inject` against the `wms_test` DB and Redis DB 1 |
| `pnpm db:migrate` / `db:deploy` | Create a migration (dev) / apply migrations                              |
| `pnpm db:seed`                  | Idempotent demo data                                                     |
| `pnpm db:seed:images`           | Loads official product photos into storage (`--force` replaces them)     |
| `pnpm openapi:export`           | Writes `openapi.json` (the frontend types mirror it)                     |
| `pnpm routes:public`            | Lists every route that skips auth. Review it in each PR.                 |

The e2e suite needs `docker compose up -d`. It migrates `wms_test` itself and truncates it before each suite, so it
never touches dev data. Suites share that database, so always run them serially (the script passes `--runInBand`).

## Layout

```
src/
├── main.ts / worker.ts   two entry points, one image (API vs worker command)
├── app.factory.ts        middleware shared by production and tests: request id, helmet, CORS, prefix, Swagger
├── config/               zod-validated env; the process exits on bad config
├── common/               auth (guard, JWT verifier, scope helpers), errors, If-Match/ETag, idempotency, throttling,
│                         pagination, validation, UTC date + business-hours maths, logger
├── infra/                prisma (primary + read replica), redis/cache, blob storage, transactional outbox
├── modules/<name>/       controller · service · dto · index.ts (the only file other modules may import)
│   users, dev-idp, health, audit, products, policies, warranty, customers, attachments,
│   registrations, claims, rma, reports
├── worker/               outbox relay, notifications, maintenance
└── cli/                  openapi export, public-route listing
prisma/                   schema, hand-reviewed SQL migrations, seed
test/                     e2e harness, factories, suites
```

## Rules the tooling and review enforce

- **Modules import each other only through `index.ts`** (eslint-plugin-boundaries). Cross-module calls that would
  create a cycle go through a port (for example, claims issues RMAs via `RmaIssuer`).
- **Everything is deny-by-default.** A route needs `@Roles(...)` or an explicit `@Public()`. There are 10 public routes.
- **Out-of-scope rows return 404, not 403**, so IDs can't be probed. Use the helpers in `common/auth/scope.ts`.
- **Mutations on existing records need `If-Match`.** A missing header gets 428; a stale one gets 409 `STALE_VERSION`.
  Creates accept `Idempotency-Key`.
- **Side effects go through the outbox** in the same transaction as the change. Never send email or enqueue a job
  directly from a request.
- **Status changes only through the state machines** (`claims/claim-state-machine.ts`, `rma/rma-state-machine.ts`).
  Responses carry `allowedActions`, and the UI renders buttons from them.
- **No `$queryRawUnsafe` / `$executeRawUnsafe`** (lint-banned). Use tagged `$queryRaw`.
- **Lists are paginated on the server** with `?page=&pageSize=&sort=&q=` (`common/pagination`). `pageSize` is
  capped at 100 and `sort` must be on the endpoint's allow-list.
- **Product photos live in object storage**, never as external URLs. `products.image_key` holds the key and
  responses carry a versioned `imageUrl` (`API_PUBLIC_URL` + `/products/{sku}/image?v=...`). A new upload means
  a new URL, so the image route can send `Cache-Control: immutable`.
- **Dates are UTC, date-only values are `DATE` columns.** Warranty end = start + months − 1 day.
- **The app connects as `wms_app`**, which can't run DDL or delete audit rows. Migrations run as `wms_owner`.

## Deviations from the build guide

1. **Storage images.** `minio/minio` and `minio/mc` are no longer pullable from Docker Hub, so compose uses
   `quay.io/minio/minio`, and the API creates the bucket at startup in development. The Azure Blob adapter is a
   TODO behind the `BlobStorage` interface.
2. **Malware scan** checks file type by magic bytes and size only. The antivirus engine is a TODO in the scan job.
   Files stay `PENDING` → `CLEAN`/`INFECTED` exactly as the guide describes, so an AV engine can be added without
   changing callers.
3. **Audit log partitions.** `audit_log` is partitioned by month, but rows currently land in the default partition.
   Creating monthly partitions needs DDL rights the app role doesn't have. Make it a migration or a DBA job before go-live.
4. **Pagination** is `page`/`pageSize` everywhere, including claims (the guide suggests keyset for large lists).
   Revisit once claim volumes are known.
5. **Test database.** e2e uses the compose `wms_test` database instead of Testcontainers, which keeps it fast on Windows
   dev machines. CI can point `TEST_DATABASE_URL` / `TEST_DATABASE_OWNER_URL` / `TEST_REDIS_URL` elsewhere.
6. **Identity.** The dev IdP stands in until Fieldpiece confirms the provider. Switching means setting the `OIDC_*`
   values and `DEV_IDP_ENABLED=false`. No other code changes.

Search the code for `TODO` and `[CONFIRM]` to find open work and questions for Fieldpiece.

# Warranty Management API (`backend/`)

The real backend behind the React app in `../frontend`. It implements the contract the frontend already uses
(`../frontend/docs/api-contract.md`) on NestJS + PostgreSQL, so the frontend runs against it **without code changes**.
The domain is the one in `../frontend/docs/demo-workflows.md`: units with part-wise warranties, registrations from
every channel, complaints, service hand-off, manufacturer claims, the integration log and notifications.

`demo-server/` in this folder is the old in-memory mock. It stays because the frontend's unit tests run against its
core (the `@demo-core` alias in `frontend/vite.config.ts`). The real API doesn't use it.

**Stack:** Node 22, NestJS 10 on Fastify, TypeScript (strict), Prisma 6 + PostgreSQL 16, optional Redis (rate-limit
counters), local-folder or S3-compatible file storage, pino, Jest, Playwright (via the frontend's specs).

**Shared rules:** warranty status, entitlement, registration row checks and claim status steps come from
`../shared/wms-domain` (`@wms/domain`), the same code the frontend runs. The build bundles it (webpack via Nest CLI,
tsconfig `paths`), so the two can't drift.

## Getting started

```bash
cd backend
cp .env.example .env                 # already set up for local development
docker compose up -d                 # Postgres :5433, Redis :6379, pgAdmin :5050
npm install
npm run db:deploy                    # migrations, as the owner role
npm run db:seed                      # demo data (safe to re-run; replaces business data)
npm run start:dev                    # API on http://localhost:4000/api, Swagger on http://localhost:4000/docs
```

Then, in `../frontend`: `npm run dev` and open http://localhost:5173. The frontend's dev server proxies `/api` to
port 4000 by default (`DEMO_API_URL`), which is why the API listens there. Don't run the mock server at the same time.

Sign in with the "Sign in as" picker, or with any demo account and `DEMO_PASSWORD` (`Demo#2026`):

| Email                     | Role                                   |
| ------------------------- | -------------------------------------- |
| `admin@demo.wms`          | Admin (sees everything)                |
| `dealer.coolair@demo.wms` | Dealer CoolAir Traders                 |
| `dealer.breeze@demo.wms`  | Dealer Breeze Point                    |
| `dist.northstar@demo.wms` | Distributor NorthStar (both dealers)   |
| `customer.rk@demo.wms`    | Customer R. Kulkarni                   |

Postgres is on host port **5433** so it doesn't clash with a local install. If your Docker volume was created by
an earlier version of this backend, the `wms_hvac*` databases don't exist yet: create them with the three
`CREATE DATABASE` lines in `docker/postgres/init/01-roles.sql` (or remove the volume to start over).

## Scripts

| Script                         | What it does                                                                                   |
| ------------------------------ | ---------------------------------------------------------------------------------------------- |
| `npm run start:dev`            | API in watch mode                                                                              |
| `npm run build` / `npm start`  | Webpack build to `dist/`, then run `dist/main.js`                                              |
| `npm run typecheck` / `lint`   | `tsc --noEmit` (includes the shared rules) / ESLint with zero warnings                         |
| `npm test`                     | Unit tests (scope, sessions, sheets, files, dates, job helpers)                                |
| `npm run test:e2e`             | API tests through `app.inject` against the `wms_hvac_e2e` database, with a fixed clock         |
| `npm run test:ui`              | **The frontend's own Playwright specs (`../frontend/e2e`, unchanged) against this API**        |
| `npm run db:deploy` / `db:migrate` | Apply migrations / create a new one (development)                                          |
| `npm run db:seed`              | Load the demo data set (refuses in production without `--force`)                               |
| `npm run openapi:export`       | Writes `openapi.json` (committed: the machine-readable contract)                               |
| `npm run routes:public`        | Lists every unauthenticated route. Review it in each PR (there are 6).                         |

`test:e2e` and `test:ui` need `docker compose up -d`. `test:ui` also needs `npm run build` first and a Chromium for
Playwright (`npx playwright install chromium` in `../frontend`); it migrates and seeds `wms_hvac_test` itself.

## Layout

```
src/
├── main.ts, app.factory.ts, app.module.ts   bootstrap; middleware shared by production, tests and CLIs
├── config/        zod-validated env; the process refuses to start on bad config
├── common/        auth decorators and request context, errors, list queries, multipart, file headers,
│                  rate limits, ids (Postgres sequences), dates, business calendar, logger
├── domain/        scoping rules (who sees which rows) and the row -> API view mappers
├── infra/         Prisma, optional Redis, blob storage (local folder or S3/MinIO)
├── modules/<name>/  controller · service · index.ts (the only file other modules may import)
│     auth, catalog (models, brands, dealers, org), files, units, registrations (incl. bulk import),
│     complaints, claims, integrations, notifications, dashboard, health, demo (accounts, simulator, seed)
└── cli/           OpenAPI export, public-route listing
prisma/            schema, migrations (hand-reviewed SQL), seed entry point
test/e2e/          API suites;  test/ui/  Playwright config that reuses the frontend's specs
```

## Rules the code and tests enforce

- **Deny by default.** Every route needs a signed-in user unless it's `@Public()`; `@Roles()` limits it further.
- **Scope on the server.** Admin: everything; distributor: its dealers' rows; dealer: its own; customer: rows with
  its customer id, never claims. Out-of-scope rows answer **404**, not 403 (`src/domain/scope.ts`).
- **Sessions:** email + password (scrypt) → short-lived access JWT in the body + httpOnly `wms_refresh` cookie
  (`Path=/api`, SameSite=Lax, Secure on HTTPS). Only the cookie token's SHA-256 is stored. Every request re-checks
  the session, so signing out ends the access token too. The cookie authenticates **only** file downloads
  (`@CookieAuth()`: `<img src>`, `<object>`, plain links), never JSON endpoints.
- **Status changes only through the shared state machine** (`nextClaimStatus`), with compare-and-set updates, so
  concurrent actions can't both win. Units and registrations are row-locked while they change.
- **One transaction per business change**, including its notifications and integration-log entries.
- **Errors** always look like `{ code, message, fieldErrors?, requestId }`; codes and field-error i18n keys are the
  ones the frontend knows (`src/common/errors/app-error.ts`).
- **No unsafe raw SQL** (lint-banned). Sort columns come from allow-lists.
- **Least privilege:** the app connects as `wms_app` (rows only, no DDL); migrations run as `wms_owner`.
- **Demo features** (`DEMO_FEATURES_ENABLED`: the sign-in account list and the A13 simulator) aren't mounted unless
  enabled, and the API refuses to start with them in production.

## Deployment notes

- Build the image from the repository root: `docker build -f backend/Dockerfile --target runtime .` (target
  `migrate` applies migrations). `docker compose --profile app up -d --build` runs both locally.
- Set `AUTH_JWT_SECRET` (32+ random characters), `DATABASE_URL`, `STORAGE_DRIVER=s3` with its bucket and keys,
  `CORS_ORIGINS` if the frontend is on another origin, and `DEMO_FEATURES_ENABLED=false`.
- Serve the frontend and `/api` from the same site (reverse proxy), so the session cookie and `<img src>` file URLs
  work without third-party cookies.

## Open items [CONFIRM]

Search the code for `[CONFIRM]` and `TODO`. The main ones: the real integrations (service system, OEM, ERP, CRM,
Finance, mailbox) replace the simulator and the "recorded as delivered" outbound log; password reset
(`POST /auth/forgot-password` isn't implemented: the frontend hides it in the demo build); an identity provider if
Fieldpiece wants SSO; business time zone and currency per market.

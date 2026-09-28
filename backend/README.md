# Warranty Management API (`backend/`)

The real backend behind the React app in `../frontend`. It implements the contract the frontend already uses
(`../frontend/docs/api-contract.md`) on NestJS + PostgreSQL, so the frontend runs against it **without code changes**.
The domain is the Fieldpiece warranty core (`../docs/adr/ADR-012-warranty-core.md`): the product catalog (categories
and Fieldpiece models, each with its warranty term and serial and batch formats), registered products with serial,
batch number and one warranty from the date of purchase, registrations from every channel (dealer form, bulk file,
customer portal, public web form, email, ERP, partner API), one warranty claim workflow decided by the warranty desk,
the integration log and notifications. US data, USD.

`demo-server/` in this folder is the old in-memory mock. It stays because the frontend's unit tests run against its
core (the `@demo-core` alias in `frontend/vite.config.ts`). The real API doesn't use it.

**Stack:** Node 22, NestJS 10 on Fastify, TypeScript (strict), Prisma 6 + PostgreSQL 16, optional Redis (rate-limit
counters), local-folder or S3-compatible file storage, pino, Jest, Playwright (via the frontend's specs).

**Shared rules:** warranty status and coverage, registration row checks (serial and batch formats) and claim status
steps come from
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

| Email                         | Role                                                              |
| ----------------------------- | ----------------------------------------------------------------- |
| `admin@wms.local`             | Admin: Fieldpiece warranty desk (sees everything)                 |
| `dealer.lonestar@wms.local`   | Dealer Lone Star Refrigeration Supply, Houston TX                 |
| `dealer.bayou@wms.local`      | Dealer Bayou Air Parts, Baton Rouge LA                            |
| `dealer.desertpeak@wms.local` | Dealer Desert Peak HVAC Supply, Phoenix AZ (no distributor)       |
| `dist.gulfstates@wms.local`   | Distributor Gulf States HVAC Distribution (Lone Star and Bayou)   |
| `customer.mreed@wms.local`    | Customer Marcus Reed                                              |

The first five are in the sign-in picker (`src/modules/demo/seed-data.ts`). The seed also creates two partner API
clients with known keys (`DEMO_PARTNER_KEYS` in the same file) for trying `POST /api/partner/v1/registrations`, and
`../demo-assets/lonestar_sales_week38.xlsx` is a sample bulk upload for Lone Star (25 rows, 3 deliberate errors;
regenerate it with `npx tsx scripts/make-sample-bulk-file.ts`).

Postgres is on host port **5433** so it doesn't clash with a local install. If your Docker volume was created by
an earlier version of this backend, the `wms_hvac*` databases don't exist yet: create them with the three
`CREATE DATABASE` lines in `docker/postgres/init/01-roles.sql` (or remove the volume to start over).

## Scripts

| Script                         | What it does                                                                                   |
| ------------------------------ | ---------------------------------------------------------------------------------------------- |
| `npm run start:dev`            | API in watch mode                                                                              |
| `npm run build` / `npm start`  | Webpack build to `dist/`, then run `dist/main.js`                                              |
| `npm run typecheck` / `lint`   | `tsc --noEmit` (includes the shared rules) / ESLint with zero warnings                         |
| `npm test`                     | Unit tests (scope, passwords, sheets, file signatures, dates, email parser, registration input) |
| `npm run test:e2e`             | API tests through `app.inject` against the `wms_hvac_e2e` database, with a fixed clock         |
| `npm run test:ui`              | **The frontend's own Playwright specs (`../frontend/e2e`, unchanged) against this API**        |
| `npm run db:deploy` / `db:migrate` | Apply migrations / create a new one (development)                                          |
| `npm run db:seed`              | Load the demo data set (refuses in production without `--force`)                               |
| `npm run openapi:export`       | Writes `openapi.json` (committed: the machine-readable contract)                               |
| `npm run routes:public`        | Lists every unauthenticated route. Review it in each PR (10 with demo features on, 9 without). |

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
│     auth, catalog (models, categories, dealers, org), files, units (registered products, coverage,
│     certificate), registrations (incl. bulk import), intake (public form, partner API and keys, email
│     webhook), claims, integrations, notifications, dashboard, health, demo (accounts, simulator, seed)
└── cli/           OpenAPI export, public-route listing
prisma/            schema, migrations (hand-reviewed SQL), seed entry point
test/e2e/          API suites;  test/ui/  Playwright config that reuses the frontend's specs
```

## Rules the code and tests enforce

- **Deny by default.** Every route needs a signed-in user unless it's `@Public()`; `@Roles()` limits it further.
- **Scope on the server.** Admin: everything; distributor: its dealers' rows; dealer: its own; customer: rows with
  its customer id (including claims on its products). Only admins decide registrations and claims. Out-of-scope
  rows answer **404**, not 403 (`src/domain/scope.ts`).
- **Sessions:** email + password (scrypt) → short-lived access JWT in the body + httpOnly `wms_refresh` cookie
  (`Path=/api`, SameSite=Lax, Secure on HTTPS). Only the cookie token's SHA-256 is stored. Every request re-checks
  the session, so signing out ends the access token too. The cookie authenticates **only** file downloads
  (`@CookieAuth()`: `<img src>`, `<object>`, plain links), never JSON endpoints.
- **Status changes only through the shared state machine** (`nextClaimStatus`), with compare-and-set updates, so
  concurrent actions can't both win. Products, registrations and claims are row-locked while they change.
- **One transaction per business change**, including its notifications and integration-log entries.
- **Errors** always look like `{ code, message, fieldErrors?, requestId }`; codes and field-error i18n keys are the
  ones the frontend knows (`src/common/errors/app-error.ts`).
- **No unsafe raw SQL** (lint-banned). Sort columns come from allow-lists.
- **Least privilege:** the app connects as `wms_app` (rows only, no DDL); migrations run as `wms_owner`.
- **Demo features** (`DEMO_FEATURES_ENABLED`: the sign-in account list and the A13 simulator) aren't mounted unless
  enabled, and the API refuses to start with them in production.
- **Unauthenticated intake has its own control:** the public form has a honeypot and a per-IP limit; the partner API
  needs an `X-Api-Key` (only its SHA-256 is stored); the email webhook needs `X-Inbound-Secret` and is off until
  `INBOUND_EMAIL_SECRET` is set.

## Deployment notes

- Build the image from the repository root: `docker build -f backend/Dockerfile --target runtime .` (target
  `migrate` applies migrations). `docker compose --profile app up -d --build` runs both locally.
- Set `AUTH_JWT_SECRET` (32+ random characters), `DATABASE_URL`, `STORAGE_DRIVER=s3` with its bucket and keys,
  `CORS_ORIGINS` if the frontend is on another origin, and `DEMO_FEATURES_ENABLED=false`.
- Serve the frontend and `/api` from the same site (reverse proxy), so the session cookie and `<img src>` file URLs
  work without third-party cookies.

### Environment: locale and registration intake

Every variable is validated in `src/config/env.ts`; `.env.example` has working local values. The ones added for the
warranty core:

| Variable                       | Default                  | What it does                                                                                                             |
| ------------------------------ | ------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `APP_TIMEZONE`                 | `America/Los_Angeles`    | IANA zone that decides "today" (warranty status, future-date checks, "this month"). [CONFIRM]                           |
| `APP_CURRENCY`                 | `USD`                    | ISO 4217 code sent as `SessionUser.currency`                                                                             |
| `PUBLIC_FORM_LIMIT_PER_HOUR`   | `20`                     | Public registration form submissions per IP per hour                                                                    |
| `INBOUND_EMAIL_ADDRESS`        | `registrations@wms.local` | Mailbox shown on the registration hub; customers and dealers forward invoices to it. [CONFIRM]                          |
| `INBOUND_EMAIL_SECRET`         | not set                  | 24+ characters. The mail provider's inbound webhook sends it in `X-Inbound-Secret`. Not set = email intake off (`POST /api/inbound/email` answers 404) |
| `PARTNER_API_LIMIT_PER_MINUTE` | `120`                    | Partner API (and inbound email) calls per minute                                                                         |

## Open items [CONFIRM]

Search the code for `[CONFIRM]` and `TODO`. The main ones: Fieldpiece's real serial and batch label format (assumed:
9-digit serial `yy`+`ww`+5 digits, batch `yyww-Lnn`); whether a replacement carries the rest of the original warranty
(assumed) or starts a new one; the real integrations (ERP, CRM, Finance, mail provider) replace the simulator and the
"recorded as delivered" outbound log; password reset (`POST /auth/forgot-password` isn't implemented: the frontend
hides it in the demo build); an identity provider if Fieldpiece wants SSO; business time zone and currency per
market. See `../docs/adr/ADR-012-warranty-core.md`.

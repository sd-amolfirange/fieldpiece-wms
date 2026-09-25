# INSTRUCTIONS.md: Fieldpiece WMS, backend build and frontend integration

This file is for Claude Code running inside VS Code, at the root of the Fieldpiece Warranty Management System repo. Read all of it before you change anything.

Your job has two parts:

1. Build the API in `backend/` to the spec in `docs/FIELDPIECE_WARRANTY_BACKEND_INSTRUCTIONS.md`.
2. Wire the existing React app in `frontend/` to that API, **without breaking any feature that works today**.

"Works today" means whatever the frontend does right now against its MSW mocks. Before you write any code, you'll record that as a baseline (Phase 0), and every later step has to keep it green.

---

## 1. Ground rules

These apply to every task in this repo. If an instruction elsewhere conflicts with one of these, stop and ask.

1. **Read before you write.** Before you edit a file, open it and the files that import it. Don't guess what's in a file from its name.
2. **The frontend is the customer.** You can change `frontend/` only to connect it to the real API: the HTTP client, feature `api.ts` / `hooks.ts` files, mappers, env config, MSW setup and tests. Don't redesign screens, rename components, restyle anything or restructure folders. If a screen needs a real change to work with the API, write down why in the commit and keep the change as small as it can be.
3. **Never delete MSW handlers.** The frontend tests depend on them. The mocks move behind a flag (Section 7.9). They don't go away.
4. **One phase at a time.** Finish a phase, pass its gate (Section 9), commit, then move on. Don't start two phases in the same change.
5. **Small commits, Conventional Commits.** `feat(claims): add submit transition`, `fix(frontend/http): send If-Match on PATCH`. One logical change per commit.
6. **No secrets in the repo.** `.env` files stay out of git. Only `.env.example` gets committed.
7. **Don't hard-code business rules** marked **[CONFIRM]** in the specs. Put them in config, seed data or a settings table, with the current placeholder value.
8. **When you're unsure, ask.** Section 12 lists the situations where you stop and ask the developer instead of picking something.

---

## 2. Where the truth lives

Read these in this order. If two of them disagree, the higher one wins, **unless** it would break the frontend. In that case stop and ask.

| Priority | Source | What it decides |
|---|---|---|
| 1 | Anything else in `docs/` written for this project (ADRs, notes, client decisions) | Anything it covers explicitly. These are the most recent decisions. |
| 2 | This file | Integration approach, contract decisions (Section 5), order of work |
| 3 | `docs/FIELDPIECE_WARRANTY_BACKEND_INSTRUCTIONS.md` | Backend architecture, schema, API, security, ops |
| 4 | `docs/FIELDPIECE_WARRANTY_FRONTEND_INSTRUCTIONS.md` | What the frontend expects, design system, roles, routes |
| 5 | The actual code in `frontend/` | What the frontend really does. When the frontend spec and the code disagree, **the code is what you must not break**. Note the difference in `docs/integration/DISCOVERY.md`. |

At the start of every session, list `docs/` and read anything new since the last session. If you find a document that changes a decision in Section 5, update Section 5's ADR (see 5.3) before writing code.

When this file cites "BE §8.3" it means section 8.3 of the backend spec. "FE §7" means section 7 of the frontend spec.

---

## 3. Repo layout

```
/
├── docs/
│   ├── FIELDPIECE_WARRANTY_BACKEND_INSTRUCTIONS.md
│   ├── FIELDPIECE_WARRANTY_FRONTEND_INSTRUCTIONS.md
│   ├── adr/                 # ADR-001..010 from BE §1, plus the ones you add
│   ├── integration/         # you create this in Phase 0
│   └── runbooks/
├── backend/                 # NestJS API + worker (you build this)
├── frontend/                # React app (exists; integrate, don't rewrite)
├── docker-compose.yml       # optional root compose that includes backend/ services
└── INSTRUCTIONS.md          # this file
```

Notes:

- The backend spec's layout (BE §3.1) shows `docs/`, `docker/`, `prisma/` etc. at its own root. In this repo that root is `backend/`, **except** ADRs and runbooks, which go in the top-level `docs/adr/` and `docs/runbooks/` so there's one place for decisions.
- Backend uses **pnpm**. The frontend keeps whatever package manager it already has (check the lock file). Don't convert it.
- The developer is probably on Windows. Use forward slashes in code and config, keep scripts cross-platform (no bash-only syntax in `package.json` scripts; use `cross-env` if you need env vars in a script), and don't rely on file permissions or symlinks.

---

## 4. Phase 0: discovery (read only, do this first)

Don't write any backend code until this phase is done and the developer has seen the output.

### 4.1 Inventory the frontend

Create `docs/integration/DISCOVERY.md` with:

1. **Toolchain:** package manager, Node version, scripts in `package.json`, test runners, whether Playwright and MSW are set up.
2. **HTTP layer:** where the axios instance lives, its interceptors, how the base URL is read, how auth is attached today (or whether it's stubbed).
3. **Every API call the frontend makes.** One table row per call: feature, file, method, path, request shape, response shape it reads, query key. Get this from the feature `api.ts` files **and** from the MSW handlers in `src/mocks/`. Flag any call that exists in one but not the other.
4. **Types:** compare `src/types/domain.ts` (and any feature `types.ts`) with the backend schema and DTO naming. List every field that differs in name, type, nullability or meaning.
5. **Auth:** how login works today, what `RequireRole` reads, where the session lives.
6. **Uploads:** how the dropzone currently "uploads" (mocked presigned URL? direct?), which mime types and sizes it accepts.
7. **Env vars** the frontend reads, and what's in `.env.example`.
8. **Frontend-only logic that duplicates backend rules:** `features/claims/transitions.ts`, warranty date preview, serial validation.
9. **Differences between the frontend spec and the code.** Anything the spec says that the code doesn't do, or the other way round.

### 4.2 Record the baseline

In `frontend/`, run and write down the result of each (pass/fail, counts, time):

- install (frozen lock file)
- typecheck (`tsc --noEmit` or the project's script)
- lint
- unit and component tests
- production build
- Playwright e2e, if it exists (against MSW)

Save this as `docs/integration/BASELINE.md`. **This is the "don't break it" bar.** If something is already failing, record it as pre-existing and don't fix it unless asked, so the baseline stays honest.

Also make a list of the user journeys that work in the browser today with mocks (for example: public warranty check, register product, file claim, agent approve, RMA view). Those become the manual smoke list in Section 9.

### 4.3 Check the contract decisions

Compare what you found against Section 5. If the code does something Section 5 didn't predict, add it to 5.2 with a proposed decision and flag it for the developer.

**Gate:** show the developer `DISCOVERY.md` and `BASELINE.md` and wait for a go-ahead.

---

## 5. Contract decisions (backend ⇄ frontend)

The two specs were written to match, but they don't line up everywhere. These are the decisions to apply. The general rule:

> **The API follows the backend spec's naming and shapes.** The frontend adapts in its feature `api.ts` files through small mapper functions, so components and props don't change. Component-facing types in `types/domain.ts` can gain fields, but don't rename or remove a field unless you update every use in the same commit and the baseline stays green.

### 5.1 Things that already match (don't change them)

- Roles: `technician | distributor | claims_agent | service_center | admin`.
- `ClaimStatus` values and the RMA status values.
- Pagination: `{ items, total, page, pageSize }` with `page`, `pageSize`, `sort`, filters in the query.
- Error body: `{ code, message, fieldErrors?, requestId }`. The frontend ignores `requestId` today; show it in the error toast as "Reference: …" so support can find the log line.
- Base path `/api/v1`, JSON, camelCase, ISO 8601 timestamps, `YYYY-MM-DD` dates.

### 5.2 Mismatches and how to resolve them

| # | Area | Frontend (spec / code) | Backend spec | Decision |
|---|---|---|---|---|
| 1 | Claim ID | `id` shown as `CLM-000123` | `id` is a UUID; `displayNo` is `CLM-000123` | API returns both `id` (UUID) and `displayNo`. Frontend routes use `id`, UI shows `displayNo` in mono. If the frontend currently routes by display number, keep that URL working: resolve it with `GET /claims?displayNo=` and redirect. Same for RMAs. |
| 2 | Claim serial/SKU | `Claim.serialNumber`, `Claim.sku` | Not on the `claims` table | Claim DTOs join through the registration and return `serialNumber` and `sku`. |
| 3 | Claim history | `Claim.history` embedded | `GET /claims/{id}/events`, separate | `GET /claims/{id}` does **not** embed history. Frontend fetches events with their own query key `['claim', id, 'events']`. If components expect `claim.history`, the claim hook combines both queries so the component doesn't change. |
| 4 | Allowed actions | `features/claims/transitions.ts` decides which buttons to show | `GET /claims/{id}` returns `allowedActions` from the same `TRANSITIONS` table | Frontend uses `allowedActions` from the API when present. Keep `transitions.ts` and its tests; use it only as a fallback for mocks. Add a test that the MSW mock's `allowedActions` match `transitions.ts` for every status × role. |
| 5 | Registration status | `ACTIVE \| EXPIRING_SOON \| EXPIRED \| VOID` | Stored `ACTIVE \| VOID`; the rest computed (BE §5.3) | The DTO field `status` carries the **computed** value, so the frontend type stays as it is. The stored value is internal. |
| 6 | Warranty end date | `addMonths(purchaseDate, months)` | `addMonths(start, months) - 1 day` (BE §8.1) | Backend rule wins. Update the frontend preview helper to subtract one day and fix its tests; that's a fix, not a break. Label it "Estimated" as the spec already implies. |
| 7 | Policy fields | `extensionMonthsOnRegistration`, `sku: string \| "*"` | `registrationBonusMonths`, `registrationWindowDays`, `productId` null = default, `effectiveTo` | API returns `registrationBonusMonths`, `registrationWindowDays`, `sku` (null for the default policy), `effectiveFrom`, `effectiveTo`. The frontend mapper turns `null` into `"*"` and `registrationBonusMonths` into `extensionMonthsOnRegistration`. |
| 8 | Product warranty months | `Product.warrantyMonths` | Lives on the policy | Product DTO includes `warrantyMonths` (base months of the policy in effect today) and `registrationBonusMonths`, filled from the policy. Never stored on the product. |
| 9 | Failure categories | Hard-coded union in the type | Lookup table with `requiresPhoto`, editable by admin | Add `GET /failure-categories` (any authenticated user, cached). Frontend loads the list from it and uses `requiresPhoto` for the photo rule. Keep the TS union for the seeded codes but accept any string at runtime. |
| 10 | Auth refresh | "Refresh with an httpOnly cookie" | API has no sessions or cookies | Token refresh happens between the browser and the **IdP** (OIDC refresh token / silent renew with `oidc-client-ts`), not our API. The axios 401 handler asks the OIDC client to renew once, then logs out. The backend doesn't build a refresh endpoint. |
| 11 | Optimistic locking | Not mentioned | `ETag` + `If-Match` required on mutations | Every mutable DTO also returns `version` in the body. The frontend http layer sends `If-Match: W/"<version>"` on PATCH and transition POSTs. On `409 STALE_VERSION`, show "Someone else updated this claim. Reload to see the latest." and refetch. |
| 12 | Idempotency | Not mentioned | `Idempotency-Key` on create/transition POSTs | The axios interceptor adds a fresh UUID per user action, and reuses it for automatic retries of that same action. Generate it in the mutation hook, not in the interceptor, so a retry keeps the same key. |
| 13 | Upload flow | Presigned URL → upload → send IDs | Adds `POST /attachments/{id}/confirm` and a virus scan (`PENDING` → `CLEAN`) | Frontend calls `confirm` after the PUT. Add `GET /attachments/{id}` (uploader or scoped) returning `scanStatus`. The form waits for `CLEAN` before enabling submit, with a "Checking file…" state; `INFECTED` shows an error and removes the file. In local dev the scan job can mark files `CLEAN` straight away (config flag). |
| 14 | Upload limits | `image/*`, PDF, 10 MB, 5 files | Allow-list jpeg/png/heic/webp/pdf, mp4 up to 50 MB (claims only) | Frontend `accept` list and size checks follow the backend allow-list. Expose the limits from `GET /me` or a small `GET /config/uploads` so they aren't copied into two places. |
| 15 | Public check result | Image, name, SKU, registration status, badge, end date | Only name, SKU, status, end date | Add `imageUrl` (product data, not personal). Nothing else. The "Register this product" / "File a claim" buttons depend only on `status`. |
| 16 | Out-of-scope rows | Permission-denied state | 404 for out-of-scope | Frontend shows its not-found state on 404. Permission-denied is only for 403. |
| 17 | Forgot password | `/forgot-password` route | IdP owns passwords | The route redirects to the IdP's reset flow. Keep the route so links don't break. |
| 18 | Global search | Serial, claim ID, RMA number, customer name | No endpoint | Add `GET /search?q=` returning up to 5 hits per type, scoped to the caller, using the trigram indexes. Rate limit it like authenticated reads. |
| 19 | Distributor dashboard KPIs | Registrations this month, open claims, avg resolution days | Reports are agent/admin only; matrix says "own org (limited)" | Add `GET /dashboard/summary`, role-aware and scoped. Don't open the full reports endpoints to distributors. |
| 20 | CSV export on tables | Toolbar button | Not specified | List endpoints accept `Accept: text/csv` with the same filters, streamed, max 10,000 rows. |
| 21 | Rate limit on autosave | Draft autosave every 10 s | 60 writes/min per user | Fine as specified (6/min). Autosave only sends a PATCH when the form actually changed. |

Anything the frontend needs that isn't in the table or in BE §6.2: add it to 5.2 with a proposed decision, and ask before building it.

### 5.3 Record it

Write these decisions as `docs/adr/ADR-011-api-contract-alignment.md` (context, decision per row, consequences). Update it whenever a row changes. The OpenAPI spec is the machine-readable version of this ADR.

---

## 6. Backend build plan

Follow BE §16's sprints, grouped into phases you can gate. For each phase: build it, write its tests at the levels BE §13.1 asks for, document it in Swagger (BE §6.6), then pass the gate in Section 9.

| Phase | Scope | Must be true at the end |
|---|---|---|
| **B0** | Scaffold `backend/`: NestJS 10 + Fastify, pnpm, strict TS, ESLint rules from BE §15, config (BE §4), pino logging, request ID, global exception filter with the error codes enum, `/health/live` and `/health/ready`, Swagger skeleton, docker compose (BE §2.2), Dockerfile (BE §14.1), `.env.example` | `docker compose up` brings up infra, the API starts, `/docs` loads, health checks answer, lint and typecheck are clean |
| **B1** | Prisma schema and migrations for the full DDL in BE §5.2, grants (BE §5.6), idempotent seed (BE §5.5) | `prisma migrate reset` runs clean twice in a row; seed runs twice without duplicates; integration test checks constraints (duplicate active serial, overlapping policies, rejection reason) |
| **B2** | Auth: JWT validation with `jose`, dev IdP (7.3), `/me`, `@Roles` default-on guard, `@Public()`, scope helpers (BE §7.2) | Test JWT issuer in the test module; one allowed and one denied test per matrix cell for the endpoints that exist so far |
| **B3** | Products, policies, failure categories, warranty engine, public `/warranty/check`, customers, Redis caching | Warranty engine unit tests cover the edge dates in BE §8.1; public check rate limit works |
| **B4** | Attachments (presigned URLs, confirm, scan job), registrations (single), certificate PDF in the worker, audit log, outbox and relay, email via Mailpit | Duplicate serial race test passes; outbox rollback test passes |
| **B5** | Claims: drafts, submit, comments, events, state machine, `allowedActions`, assignment, SLA job, optimistic locking, idempotency | Must-have tests in BE §13.3 for claims pass |
| **B6** | Approve/reject → RMA lifecycle, service-center flows, notifications | Full claim → RMA → close flow passes as an e2e test |
| **B7** | Bulk import, reports with materialized views, admin users/roles, the extra endpoints from 5.2 (#9, #13, #18, #19, #20) | Import of a 10,000-row CSV finishes without memory growth; report endpoints under 2 s on seeded volume |
| **B8** | Hardening: k6 profile, security scans, runbooks | Targets in BE §9.1 met locally or on staging |

Integrate each feature with the frontend as soon as its backend phase is done (Section 8). Don't wait for B8.

### 6.1 Fix these spec problems while you build

These are bugs or gaps in the backend spec. Apply the fix and note it in the relevant ADR:

1. **`SWAGGER_ENABLED: z.coerce.boolean()` is wrong.** `Boolean("false")` is `true`, so Swagger would turn on in production if someone sets it to `"false"`. Parse booleans explicitly, e.g. `z.enum(["true","false"]).default("false").transform((v) => v === "true")`. Apply the same to every boolean env var.
2. **Migration order:** create `failure_categories` before `claims` (the spec notes this; make sure the generated SQL does it).
3. **Things Prisma can't express** (the `EXCLUDE` constraint, partial unique index on `upper(serial_number)`, trigram GIN indexes, BRIN index, sequences for `display_no`, the `roles <@ ARRAY[...]` check, `audit_log` partitioning): add them by hand in the migration SQL. Use `@default(dbgenerated(...))` for `display_no` so Prisma doesn't try to write it.
4. **Presigned URL host.** If the API runs in Docker, it reaches MinIO at `http://minio:9000`, but the browser needs `http://localhost:9000`, and the signature covers the host. Add `STORAGE_PUBLIC_ENDPOINT` and sign URLs with it.
5. **MinIO CORS.** Browsers PUT straight to MinIO, so set `MINIO_API_CORS_ALLOW_ORIGIN` to the frontend origin in compose. In the cloud, set the equivalent CORS rule on the bucket.
6. **CORS for the frontend dev server.** `CORS_ORIGINS` in `.env.example` includes the Vite origin (normally `http://localhost:5173`). Allowed headers must include `Authorization, Content-Type, If-Match, Idempotency-Key`, and exposed headers `ETag, Retry-After, X-Request-Id` (BE §11.1).
7. **`registrations.purchase_date <= current_date` as a CHECK constraint** works, but keep the same rule in application validation so users get a 422 with a field error, not a raw constraint failure mapped to 500. Map any constraint violation you expect (unique, check, FK) to a proper `AppError` code in the repository.

---

## 7. Integration details

### 7.1 Environment

`backend/.env.example` (local values only):

```
NODE_ENV=development
PORT=3000
API_PREFIX=api/v1
CORS_ORIGINS=http://localhost:5173
DATABASE_URL=postgresql://wms_app:localdev@localhost:5432/wms
REDIS_URL=redis://localhost:6379
OIDC_ISSUER=http://localhost:8080/wms
OIDC_AUDIENCE=wms-api
OIDC_JWKS_URI=http://localhost:8080/wms/jwks
OIDC_ROLES_CLAIM=roles
STORAGE_DRIVER=minio
STORAGE_BUCKET=wms-local
STORAGE_ENDPOINT=http://localhost:9000
STORAGE_PUBLIC_ENDPOINT=http://localhost:9000
SMTP_URL=smtp://localhost:1025
SWAGGER_ENABLED=true
SCAN_MODE=auto-clean
```

`frontend/.env.example` gets (add, don't replace what's there):

```
VITE_API_BASE_URL=http://localhost:3000/api/v1
VITE_API_MOCKING=false
VITE_OIDC_AUTHORITY=http://localhost:8080/wms
VITE_OIDC_CLIENT_ID=wms-web
```

Run the API on the host (`pnpm start:dev`) with only the infra in Docker, as BE §2.3 does. That avoids the Docker-internal hostname problems. If the developer wants the API in Docker too, use internal hostnames for server-to-server calls (`OIDC_JWKS_URI`, `DATABASE_URL`, `STORAGE_ENDPOINT`) and keep `OIDC_ISSUER` and `STORAGE_PUBLIC_ENDPOINT` on `localhost`, because those have to match what the browser sees.

### 7.2 HTTP client (`frontend/src/lib/http.ts`)

Extend the existing axios instance; don't replace it. It needs to:

- read `VITE_API_BASE_URL`
- attach `Authorization: Bearer <token>` from the in-memory OIDC user
- attach `If-Match` when the request config carries a `version`
- attach `Idempotency-Key` when the request config carries one
- on 401: ask the OIDC client to renew once, retry the request once, then log out
- on 429: read `Retry-After` and show the friendly message the FE spec asks for
- map `{ code, message, fieldErrors, requestId }` into form errors or a toast, as it already does

Keep existing call sites working. New options go in an optional config field so old calls don't need changes.

### 7.3 Local identity provider

The real IdP is still **[CONFIRM]**. For local dev, add a mock OIDC server to compose (for example `ghcr.io/navikt/mock-oauth2-server`, pinned to a specific tag) on port 8080 with an issuer called `wms`. Configure it to issue tokens with `aud=wms-api` and let the login form choose one of the seeded test users.

- The seed creates one user per role with `idp_subject` values that match the mock server's subjects.
- Roles come from our DB (BE §7.1). The `roles` claim in the mock token is ignored unless the ADR says otherwise.
- The frontend uses `oidc-client-ts` (or `react-oidc-context`) with PKCE against `VITE_OIDC_AUTHORITY`. Swapping to Entra External ID or Auth0 later should only need env changes.
- **Never** add a "log in as anyone" endpoint to the API, even behind `NODE_ENV`. The mock IdP is the only dev shortcut.

### 7.4 Types from OpenAPI

- Add a backend script `pnpm openapi:export` that boots the app without listening and writes `backend/openapi.json`.
- Add a frontend script that runs `openapi-typescript ../backend/openapi.json -o src/types/api.gen.ts`.
- `api.gen.ts` is generated and never edited by hand. Feature mappers turn generated API types into the domain types in `types/domain.ts`. That's where the 5.2 mappings live.
- Commit `openapi.json` so frontend changes can be reviewed against it.

### 7.5 Claims and `allowedActions`

Buttons on the claim detail page come from `claim.allowedActions`. Each action name matches a key in the backend `TRANSITIONS` table (`submit`, `startReview`, `requestInfo`, `respond`, `approve`, `reject`, `shipInbound`, `receive`, `complete`, `close`), and each maps to its `POST /claims/{id}/<kebab-case>` endpoint. After any transition, invalidate `['claim', id]`, `['claim', id, 'events']` and `['claims']`.

### 7.6 Uploads

1. `POST /attachments/upload-url` with `{ fileName, mime, size, ownerType }` → `{ attachmentId, uploadUrl, headers }`
2. `PUT uploadUrl` straight from the browser with exactly the returned headers (content type and length are pinned). Use a plain `fetch` or a separate axios instance **without** the auth interceptor, because storage must not receive our bearer token.
3. `POST /attachments/{id}/confirm`
4. Poll `GET /attachments/{id}` every 1–2 s (max 60 s) until `scanStatus` isn't `PENDING`.
5. Send the attachment IDs with the registration or claim.

Keep the existing dropzone component, thumbnails and progress bar. Only the upload function behind it changes.

### 7.7 Draft autosave

`POST /claims` creates the draft the first time, then autosave `PATCH /claims/{id}` with `If-Match`. Keep the local fallback the FE spec describes. If a PATCH gets `409 STALE_VERSION` (the draft was edited in another tab), refetch and ask the user which version to keep; don't overwrite silently.

### 7.8 Dates and money

Send `YYYY-MM-DD` for dates, ISO strings for timestamps. Don't send `Date` objects through axios, since that converts them to UTC timestamps and can shift a purchase date by a day for users west of UTC. Money arrives as a string from `numeric(12,2)`; format it with `Intl.NumberFormat` and never do arithmetic on it as a float in the UI.

### 7.9 Keeping MSW

- `VITE_API_MOCKING=true` starts the MSW browser worker as before. `false` (the new default for local dev) talks to the real API.
- Vitest and component tests keep using MSW, always.
- Update the MSW handlers so their responses match the real DTOs (field names from 5.2). Add a test that validates each mock response against the OpenAPI schema (for example with `openapi-response-validator` or zod schemas generated from the spec). This stops mocks and API drifting apart.

---

## 8. Integration order, one feature at a time

For each feature: the backend phase is done → switch the feature's `api.ts` to the real endpoints → update mappers and MSW handlers → run the gate → commit.

1. **Health and config**: frontend can reach the API; CORS works.
2. **Auth and `/me`**: login through the mock IdP, `RequireRole`, logout, token renew.
3. **Products and failure categories**: catalogue pages, SKU pickers.
4. **Public warranty check (`/check`)**: works logged out; 429 message shows.
5. **Registrations**: single registration with proof-of-purchase upload, duplicate serial message, confirmation and certificate download.
6. **Claims**: new claim with autosave, submit, detail page, timeline, comments, internal notes hidden from technicians.
7. **Agent actions**: assign, start review, request info, respond, approve (creates RMA), reject.
8. **RMA**: list, detail, tracking, inspection, complete, printable slip.
9. **Customers.**
10. **Dashboard** for each role, using `/dashboard/summary` and reports.
11. **Reports.**
12. **Bulk registration import.**
13. **Admin**: users, policies, settings.
14. **Global search and CSV export.**

For each feature, add or update one Playwright test that runs against the **real** stack (compose + seeded DB + mock IdP), alongside the existing MSW-based tests.

---

## 9. Gates: how you know nothing broke

Run this after every phase and every feature integration. All of it has to pass before you commit and move on.

**Backend**

- [ ] `pnpm lint` and `pnpm typecheck` clean
- [ ] Unit, integration (Testcontainers) and e2e tests green
- [ ] `pnpm openapi:export` works; the spec diff is what you intended
- [ ] Every new endpoint has Swagger summary, tags, auth and all responses (BE §6.6)
- [ ] New list queries have indexes; you ran `EXPLAIN ANALYZE` on seeded data
- [ ] Authz: role guard and data scope applied, with a denied test

**Frontend**

- [ ] Everything in `BASELINE.md` is at least as green as it was
- [ ] Typecheck, lint, unit, component tests, production build pass
- [ ] Existing MSW-based Playwright tests still pass with `VITE_API_MOCKING=true`
- [ ] New real-stack Playwright test for this feature passes
- [ ] Mock responses validate against the OpenAPI schema

**Manual smoke** (list the journeys from 4.2 and tick them off in the commit message or PR description): open the app against the real API, sign in as each role that uses the feature, and walk the journey once. Check the browser console and the API log for errors.

If a gate fails because of something you changed, fix it before continuing. If it fails because of something pre-existing, note it in `BASELINE.md` and tell the developer.

---

## 10. Command cheat sheet

```bash
# Infra (from backend/)
docker compose up -d postgres redis minio mailpit pgadmin mock-oidc

# Backend
pnpm install
pnpm prisma migrate dev
pnpm db:seed
pnpm start:dev            # API on :3000, Swagger on /docs
pnpm worker:dev
pnpm test                 # unit
pnpm test:int             # Testcontainers
pnpm test:e2e
pnpm openapi:export

# Frontend (use its own package manager)
npm run dev               # :5173
npm run gen:api           # regenerate src/types/api.gen.ts
npm test
npm run build
npx playwright test
```

Local URLs: API `http://localhost:3000/api/v1`, Swagger `http://localhost:3000/docs`, pgAdmin `http://localhost:5050`, MinIO console `http://localhost:9001`, Mailpit `http://localhost:8025`, mock IdP `http://localhost:8080/wms/.well-known/openid-configuration`.

Create any script above that doesn't exist yet as part of B0 or the relevant integration step.

---

## 11. How to work in this repo

- **Plan first.** For anything bigger than a one-file change, write a short plan (files you'll touch, tests you'll add, how you'll check the frontend still works) and wait for approval.
- **Keep module boundaries** (BE §3.2): controllers don't touch Prisma, modules call each other's exported services, business rules are pure functions.
- **Test the rules, not the framework.** Warranty engine, state machine, SLA maths and scope helpers get thorough unit tests with no Nest or DB.
- **Keep both specs in step.** If you change a status, role, field or error code, update `ADR-011`, the OpenAPI spec, the frontend mapper and the MSW handler in the same change.
- **Leave it runnable.** At the end of each session, the repo should build, tests should pass, and `README.md` in `backend/` should say how to run what exists so far.
- **Update `docs/integration/PROGRESS.md`** at the end of each session: what's done, what's next, open questions.

Don't touch these without asking:

- `frontend/src/components/ui/`, `frontend/src/styles/`, `tailwind.config.*` (design system)
- Routes and page layouts
- Frontend dependencies you don't need for integration (adding `oidc-client-ts` is expected; a new state library isn't)
- Existing migrations once they've been shared. Add a new migration instead.

---

## 12. Stop and ask when

- A change would alter what a frontend user sees or can do, beyond wiring it to real data.
- `docs/` and this file disagree on something that affects the contract.
- A **[CONFIRM]** item blocks you and there's no sensible configurable default.
- A baseline check starts failing and the fix isn't obviously inside your change.
- You'd need a new endpoint, table or dependency not listed in the specs or in 5.2.
- Anything touching security defaults: public routes, CORS, token validation, rate limits, RLS.
- A migration would lock a large table or drop data.

When you ask, give the options you see and which one you'd pick, so the developer can answer in one line.

---

## 13. Open items (from both specs)

Build these as configurable, and don't guess the real values:

1. Identity provider, and whether roles live in the IdP or our DB
2. Cloud target (Azure or AWS)
3. Warranty terms per product family, registration bonus and window, whether proof of purchase is required
4. Serial formats per SKU, barcode/QR on labels
5. SLA hours, business calendar, escalation contacts
6. Out-of-warranty claims (paid repair quotes)
7. Replacement unit warranty rule
8. Integrations: ERP, CRM, carriers, SMS, email domain
9. Retention periods and data residency
10. Cross-region DR
11. Postgres RLS: yes or no (decide by the end of B4)
12. Brand sign-off: logo SVGs, Myriad Pro licence, colours (frontend only; don't block on it)

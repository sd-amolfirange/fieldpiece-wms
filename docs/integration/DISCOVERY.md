# Phase 0 discovery: backend ⇄ frontend integration

Status: **decided.** The backend follows the frontend's contract (developer, 2026-09-25); see
`docs/adr/ADR-011-api-contract-alignment.md` and `PROGRESS.md`. Date: 2026-09-25. Branch: `demo-workflows`.

This file records what the code does today, not what the specs say. Paths are relative to the repo root.

---

## 0. Headline: the two sides describe different systems

`INSTRUCTIONS.md` §5 and `backend/FIELDPIECE_WARRANTY_BACKEND_INSTRUCTIONS.md` assume the **original Fieldpiece
frontend** (technician / claims agent / service center, products + policies, 13-state claims with RMA, OIDC). That
frontend no longer exists as a live app.

Commits `WMS-004` … `WMS-015` (24 Sep) rebuilt the frontend around **`frontend/docs/demo-workflows.md`** (an HVAC
warranty demo: screens A01–A13, DL01–DL07, CU01–CU05; workflows W1–W7). `frontend/CLAUDE.md` makes that document the
only source of truth and says to **ignore `FIELDPIECE_WARRANTY_FRONTEND_INSTRUCTIONS.md`**. The frontend talks over
HTTP to `backend/demo-server/` (Express, JSON-file persistence), and the contract is written down in
**`frontend/docs/api-contract.md`**.

The NestJS app in `backend/src` (untracked, dated 23 Sep) was built to the original backend spec, before the
rebuild. Its infrastructure is good and reusable, but its domain covers a small part of what the live frontend calls:

| Concept                 | Frontend (live code, `@wms/domain`)                                   | Existing NestJS backend                                                    |
| ----------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Roles                   | `admin`, `dealer`, `distributor`, `customer`                          | `technician`, `distributor`, `claims_agent`, `service_center`, `admin`     |
| Organisations           | Distributor → Dealer hierarchy; customers linked to dealers           | `Organization` (fieldpiece / distributor / service_center), no dealers     |
| Catalogue               | `Brand`, `Model` with a **part template** (UNIT/COMPRESSOR/PCB)       | `Product` (SKU, family) + `WarrantyPolicy` (one term)                      |
| Warranty record         | `Unit` with **per-part** warranties, void, history, `PENDING` units   | `Registration` with one warranty term                                      |
| Registration            | Channel (DEALER/PORTAL/EMAIL/ERP/BULK), PENDING→APPROVED/REJECTED inbox, flags, merge | Direct create; duplicate → 409                                   |
| Service                 | `Complaint` (NEW→WITH_SERVICE→RESOLVED), entitlement, job result      | none                                                                       |
| Claim                   | 5 states `DRAFT→SUBMITTED→APPROVED→PAID` / `REJECTED`, brand, amount, RMA number, finance posting | 13 states + RMA lifecycle, failure categories, SLA            |
| Integrations            | Integration log (CRM/ERP/FINANCE/SERVICE/OEM/EMAIL), retry, simulator | outbox → no-op `integration` queue                                         |
| Notifications           | In-app bell, per user, mark read                                      | email only                                                                 |
| Dashboard               | Role-shaped `/dashboard/summary`                                      | agent/admin reports only                                                   |
| Auth                    | `POST /auth/login {email,password}`, refresh cookie `wms_refresh`     | OIDC JWT; dev IdP picks a user by email, no passwords                      |
| Uploads                 | Multipart `POST /uploads`, `GET /files/:id` (cookie accepted)         | presigned PUT → confirm → scan; bearer only                                |
| Base path               | `/api`                                                                | `/api/v1`                                                                  |
| Errors                  | lowercase codes, `fieldErrors: Record<string,string>` of i18n keys, 422 | UPPER_SNAKE codes, `fieldErrors: Record<string,string[]>` of messages, 400 |

Almost every row of INSTRUCTIONS.md §5.2 is about a frontend that is no longer routed (RMA pages, failure
categories, policies, `/check`, global search by RMA). **Section 5 has to be redone against the live contract before any
code is written.** See §10 for the decisions this needs.

---

## 1. Toolchain

| Package               | Manager | Node      | Scripts                                                                   | Tests                                |
| --------------------- | ------- | --------- | ------------------------------------------------------------------------- | ------------------------------------ |
| `frontend/`           | npm (`package-lock.json`) | `>=20` | dev, build, build:showcase, typecheck (`tsc -b --noEmit`), lint (`--max-warnings 0`), test (vitest), e2e (playwright) | Vitest + RTL + MSW; Playwright 9 specs |
| `shared/wms-domain/`  | npm     | —         | typecheck, lint, test, build                                              | Vitest                               |
| `backend/demo-server/`| npm     | `>=20`    | dev (tsx watch, :4000), build (esbuild), demo, reset, typecheck, lint, test | Vitest                             |
| `backend/` (NestJS)   | declares `pnpm@9.15.9`; has both `pnpm-lock.yaml` and a `package-lock.json` (npm install ran on 25 Sep) | `>=22` | build, start:dev, worker:dev, typecheck, lint, test, test:e2e, db:*, openapi:export, routes:public | Jest (unit + e2e via `app.inject`) |

Machine: Node 22.22.3, npm 10.9.8, Docker 29.8. **pnpm is not installed** (`corepack enable` would provide it).

Commit hook: `frontend/.husky/commit-msg` requires `WMS-<n>: <summary>`, which conflicts with the Conventional Commits
rule in INSTRUCTIONS.md §1.5 (see §10, D7).

---

## 2. HTTP layer (`frontend/src/lib/http.ts`, `lib/api-error.ts`)

- One axios instance `http`: `baseURL = env.apiBaseUrl` (`VITE_API_BASE_URL`, default `/api`), `withCredentials: true`,
  JSON, 30 s timeout.
- Access token in a module variable (`tokenStore`), never in storage. Request interceptor adds `Authorization: Bearer`.
- 401 → single-flight `POST /auth/refresh` (cookie) → retry once; if refresh fails → `signOut()`. Opt-out per request
  with `skipAuthRefresh` (module augmentation of `AxiosRequestConfig`).
- `toApiError` → `ApiError{status, code, message, fieldErrors}`. 0 → `network_error`; 429 → `rate_limited` with a fixed
  message; else uses the body. `applyFieldErrors` maps `fieldErrors` (i18n keys) onto react-hook-form fields.
- **Not present:** `requestId` display, `Retry-After`, `If-Match`, `Idempotency-Key`.
- Query client: no retry on 400/401/403/404/409/422/429; mutations never retry; `staleTime` 5 s, many lists poll every
  5 s (`LIVE_REFRESH_MS`).
- Dev server proxies `/api` → `DEMO_API_URL ?? http://localhost:4000` (`vite.config.ts`).

## 3. Every API call

Paths relative to `VITE_API_BASE_URL`. **All live calls are served by the demo server; the demo server serves nothing
the frontend doesn't call.**

| Feature (file)                 | Method + path                                   | Request                                                    | Response                          | Query key                                  |
| ------------------------------ | ----------------------------------------------- | ---------------------------------------------------------- | --------------------------------- | ------------------------------------------ |
| auth (`features/auth/api.ts`)  | POST `/auth/login`                              | `{email,password}`                                         | `{accessToken,user:SessionUser}` + cookie | mutation                           |
|                                | POST `/auth/refresh`                            | cookie                                                     | same                              | —                                          |
|                                | POST `/auth/logout`                             | —                                                          | 204                               | mutation                                   |
|                                | GET `/auth/demo-accounts`                       | —                                                          | `{email,label,password}[]`        | `["auth","demo-accounts"]`                 |
|                                | POST `/auth/forgot-password`                    | `{email}`                                                  | —                                 | mutation — **not served** (hidden in demo build) |
| catalog                        | GET `/models`, `/brands`, `/dealers`            | —                                                          | `ModelView[]`, `Brand[]`, `DealerView[]` | `["models"]`, `["brands"]`, `["dealers"]` |
| registrations                  | GET `/registrations`                            | status, channel, flag, page, pageSize, sort, q             | `Paginated<RegistrationView>`     | `["registrations",f]`                      |
|                                | GET `/registrations/:id`                        | —                                                          | `RegistrationView` (+`duplicateOf`) | `["registration",id]`                    |
|                                | POST `/registrations`                           | `NewRegistration`                                          | `RegistrationView`                | mutation                                   |
|                                | POST `/registrations/:id/approve` · `/reject {reason}` · `/merge` | —                                        | `RegistrationView`                | mutation                                   |
|                                | POST `/registrations/bulk-approve`              | `{ids}`                                                    | `{approved,skipped}`              | mutation                                   |
| bulk import                    | GET `/bulk-imports`, `/bulk-imports/:id`        | —                                                          | `BulkImportView[]` / `BulkImportView` | `["bulk-imports"]`, `["bulk-import",id]` |
|                                | POST `/bulk-imports` (multipart)                | `file`, `name`, `dealerId?`                                | `BulkImportView` 201              | mutation                                   |
|                                | PUT `/bulk-imports/:id/rows`                    | `{rows:[{rowNumber,values}]}`                              | `BulkImportView`                  | mutation                                   |
|                                | GET `/bulk-imports/template.csv` / `.xlsx`      | plain link                                                 | file                              | —                                          |
| units                          | GET `/units`                                    | status, dealerId, list params                              | `Paginated<UnitView>`             | `["units",f]`, `["units","for-complaint"]` |
|                                | GET `/units/:serial`                            | —                                                          | `UnitView`                        | `["unit",serial]`                          |
|                                | GET `/units/:serial/certificate.pdf`            | blob, bearer                                               | PDF                               | —                                          |
|                                | GET `/units/:serial/entitlement`                | —                                                          | `Entitlement`                     | `["entitlement",serial]`                   |
|                                | POST `/units/:serial/void`                      | `{reason,note?}`                                           | `UnitView`                        | mutation                                   |
| complaints                     | GET `/complaints`, `/complaints/:id`            | status, source, list params                                | `Paginated<ComplaintView>` / `ComplaintView` | `["complaints",f]`, `["complaint",id]` |
|                                | POST `/complaints`                              | `{unitSerial,description,attachmentIds}`                   | `ComplaintView`                   | mutation                                   |
|                                | POST `/complaints/:id/send-to-service`          | —                                                          | `ComplaintView`                   | mutation                                   |
| claims                         | GET `/claims`, `/claims/counts`, `/claims/:id`  | status, brandId, list params                               | `Paginated<ClaimView>`, `Record<ClaimStatus,number>`, `ClaimView` | `["claims",f]`, `["claims","counts"]`, `["claim",id]` |
|                                | POST `/claims/:id/transitions`                  | `{action,rmaNumber?,amount?,reason?}`                      | `ClaimView`                       | mutation                                   |
| files                          | POST `/uploads` (multipart)                     | `file`, `name`                                             | `Attachment` 201                  | —                                          |
|                                | GET `/files/:id`                                | `<img>`, `<a>`, `<object>` — **no bearer, cookie only**    | file                              | —                                          |
| dashboard                      | GET `/dashboard/summary`                        | `dealerId?`                                                | `DashboardSummary` (union by role) | `["dashboard","summary",d]`               |
| notifications                  | GET `/notifications`, POST `/notifications/read` | `{ids?}`                                                  | `Notification[]`, `{ok}`          | `["notifications"]`                        |
| admin                          | GET `/integrations`, POST `/integrations/:id/retry` | system, direction, status, list params                 | `Paginated<IntegrationMessage>`   | `["integrations",f]`                       |
|                                | GET `/admin/org`                                | —                                                          | `OrgStructure`                    | `["admin","org"]`                          |
| simulator (A13)                | POST `/simulate/erp-invoice`, `/registration-email`, `/job-result`, `/oem-decision`, `/reset` | see api-contract §5.13 | see api-contract §5.13         | mutation                                   |

**Legacy, unrouted, not served** (api-contract §7; don't build): `/admin/users|policies|settings`, `/customers*`,
`/reports/*`, `/rma*`, `/warranty/check`. `GlobalSearch.tsx` (in the header) navigates to `/rma/:id` and
`/claims?q=`; `/rma` isn't routed and `/claims` is admin-only. That's pre-existing, not an API call.

## 4. Types

The shapes live in `shared/wms-domain/src/types.ts` and `views.ts` (`@wms/domain`), shared by the frontend and the demo
server. `frontend/docs/api-contract.md` §3 copies them. `frontend/src/types/domain.ts` still holds the legacy
Fieldpiece types used only by unrouted screens.

Compared with the NestJS Prisma schema, nearly every live type is **missing**, not just different: `Brand`, `Model` +
part template, `Unit`, `UnitPart`, `UnitEvent`, `Dealer`, `Complaint`, `JobResult`, `IntegrationMessage`,
`Notification`, `BulkImport` rows. The types that do exist differ in concept:

| Live type field                           | NestJS                                                       |
| ----------------------------------------- | ------------------------------------------------------------ |
| `Role` (4 values)                         | 5 different values (only `admin`, `distributor` overlap)     |
| `SessionUser.dealerId/distributorId/customerId/orgName/currency` | `/me` has `roles[]`, `organization`, `currency` |
| `RegistrationView.status` PENDING/APPROVED/REJECTED | `Registration.status` ACTIVE/VOID (it *is* the warranty) |
| `UnitView.status` incl. `PENDING`, 30-day `EXPIRING_SOON` | computed ACTIVE/EXPIRING_SOON/EXPIRED/VOID, 60 days |
| `ClaimView` (brand, amount number, rmaNumber, financePosting, partsReplaced) | `Claim` (displayNo, failureCategory, SLA, assignee, allowedActions) |
| `Attachment.url` (stream URL)             | presigned download URL on request                             |
| Money: whole number, `currency` "INR"     | `numeric(12,2)` string, org currency USD                     |
| `VoidReason` enum                         | free text                                                    |

## 5. Auth today

- Login: `LoginPage.tsx` (zod) → `POST /auth/login` → `useSession.signIn(user, accessToken)`. The session lives in a
  Zustand store (`lib/session.ts`) and isn't persisted. On start, `useBootstrapSession` calls `POST /auth/refresh`.
- Refresh cookie: `wms_refresh`, httpOnly, SameSite=Lax, Path=`/api`, 14 days (demo server doesn't rotate it).
- "Sign in as" picker: shown when `env.demoMode` (always true in `npm run dev`, or `VITE_DEMO_MODE=true`); it reads
  `GET /auth/demo-accounts`, which returns emails **and the shared demo password**. Playwright signs in through it.
- `RequireRole` (`app/RequireRole.tsx`) reads `useSession().status/user.role`: anonymous → `/login` with `state.from`;
  wrong role → `ForbiddenState`. UI-only; `lib/permissions.ts` hides actions.
- Logout: `POST /auth/logout`, then `signOut` (clears token, query cache, drafts).
- `/forgot-password`: posts `/auth/forgot-password` (not served); hidden when `VITE_SHOW_FORGOT_PASSWORD=false`.
- **No OIDC.** `VITE_OIDC_*` exist in `.env.example` but nothing reads them; `oidc-client-ts` isn't a dependency.

## 6. Uploads

- `features/files/api.ts`: multipart `POST /uploads` (`file`, `name`) with progress → `Attachment`. `uploadAll`
  uploads one after another and returns IDs, which go in the registration / complaint body.
- Client limits: `FileDropzone` default 10 MB, 5 files, `image/*` + PDF. Registrations: 3 files. Complaints:
  `image/*` + `video/*`, 3 files. Bulk import: `.xlsx`/`.csv`, 5 MB, 1 file. HEIC refused on the client
  (`lib/upload.ts` `isHeic`/`dropHeic`) because browsers can't display it.
- Server limits (demo server): `image/*`, `video/*`, `application/pdf`, 15 MB → 415 `unsupported_type`, 413 `too_large`.
- Display: `<img src>`, `<a href>`, `<object data>` hit `GET /files/:id` with **no bearer**, so the server accepts the
  refresh cookie there (and on the certificate PDF).
- NestJS today: presigned PUT to MinIO → confirm → scan (magic bytes) → presigned GET; allow-list jpeg/png/heic/webp/pdf
  (+mp4 50 MB on claims), 10 MB; API body limit 1 MB, no multipart plugin.

## 7. Env vars

Read by the app (`lib/env.ts`): `VITE_API_BASE_URL`, `VITE_DEMO_MODE`, `VITE_SHOW_ENV_TAG`, `VITE_SHOW_FORGOT_PASSWORD`,
`VITE_EXPIRING_SOON_DAYS` (legacy screens only), plus `DEV`/`MODE`. In `.env.example` but unused: `VITE_OIDC_AUTHORITY`,
`VITE_OIDC_CLIENT_ID`, `VITE_SENTRY_DSN`, `VITE_ENABLE_MOCKS`. `.env.showcase` is the demo build. Build-time only:
`DEMO_API_URL` (Vite proxy target).

## 8. Frontend logic that duplicates backend rules

- From `@wms/domain` at runtime (same code the server runs): `claimActionsFor` (claim buttons, `ClaimDetailPage`),
  `SERIAL_PATTERN`, `normalizeSerialValue`, date helpers, `VOID_REASONS`, status enums. **A real backend should import
  the same package** so the rules can't drift (warranty maths, entitlement, registration row rules, claim transitions).
- Local copies: `lib/warranty.ts` (60-day window; used only by its own test, legacy); `ComplaintDetailPage` `canSend`
  (`status === "NEW"`); `RegistrationReviewPage` pending/duplicate checks; `useUnitsForComplaint` drops `PENDING`;
  form zod rules (purchase date not in the future, dealer required for admin/distributor); `permissions.ts`.
- Server-only today: entitlement, unit status/daysRemaining, bulk row validation.
- `features/claims/transitions.ts` (named in INSTRUCTIONS §5.2 #4) **doesn't exist**; `vite.config.ts` still has a
  coverage threshold on it (harmless: v8 skips missing files).

## 9. Spec vs code differences

1. The frontend spec is superseded (`frontend/CLAUDE.md`). Everything in INSTRUCTIONS.md §5.2 about RMA screens,
   failure categories, policies, `/check`, global search and CSV export targets unrouted code.
2. INSTRUCTIONS §7.3 / §5.2 #10 (OIDC + mock IdP, no API sessions) vs the live app (password login + API-issued
   refresh cookie). api-contract §6.1 explicitly requires API sessions.
3. INSTRUCTIONS §7.9 assumes a browser MSW worker behind `VITE_API_MOCKING`. There isn't one: the app always calls a
   real HTTP API (the demo server); MSW is Vitest-only and is backed by the demo-server core (`@demo-core` alias).
4. INSTRUCTIONS §7.6 presigned uploads vs live multipart `POST /uploads`; §5.2 #11/#12 `If-Match` /
   `Idempotency-Key` aren't sent by the frontend.
5. Base path `/api/v1` (BE spec) vs `/api` (frontend default; env-configurable, so this one is cheap).
6. The demo-workflows seed (India, INR, AER-* serials, CoolAir/NorthStar) replaces the Fieldpiece seed.
7. Demo-only features the real app relies on in W3/W6: the simulator (A13) and `/auth/demo-accounts`.

## 10. Decisions needed before Phase B0

My recommendation is in **bold**; each can be answered in one line.

- **D1. Which contract does the real backend implement?**
  (a) **`frontend/docs/api-contract.md`, the live contract.** Rebuild the NestJS domain modules (models/parts, units,
  registrations inbox, bulk import, complaints, entitlement, 5-state claims, integrations, notifications, dashboard,
  org), keep its infrastructure, and reuse `@wms/domain` for the rules. The frontend barely changes.
  (b) Keep the BE-spec domain and rewrite the frontend onto it. That breaks every screen and violates INSTRUCTIONS §1.2.
  (c) Both: build the BE-spec domain and a translation layer. That's the most work, and the concepts don't map.
- **D2. Auth.** (a) **The contract's email/password login plus the `wms_refresh` httpOnly cookie, served by our API**:
  password hashes in `users`, short-lived RS256 access JWTs verified by the existing `jose` guard, and rotating
  refresh tokens stored hashed. The frontend doesn't change, and the verifier stays OIDC-compatible so an IdP can
  replace the login later. (b) OIDC with a mock IdP and `oidc-client-ts` as INSTRUCTIONS §7.3 says. That changes the
  login screen and the refresh flow, which is a user-visible change.
- **D3. Demo-only endpoints** (`GET /auth/demo-accounts`, `POST /simulate/*`). INSTRUCTIONS §7.3 forbids "log in as
  anyone" endpoints, but `/auth/demo-accounts` hands out a password, and W3/W6 need the simulator.
  **Build both behind `DEMO_FEATURES_ENABLED` (default false), and refuse to start when it's true and
  `NODE_ENV=production`**, like the existing dev-IdP guard. Otherwise the picker stays off on the real stack
  (`VITE_DEMO_MODE=false`, but `npm run dev` always enables it, so that needs a one-line env change) and the simulator
  isn't built.
- **D4. Uploads.** **Keep multipart `POST /uploads` and `GET /files/:id`, which accepts bearer or refresh cookie.** The
  API streams to MinIO, checks magic bytes and enforces the 15 MB limit and the type allow-list server-side. The
  presigned flow in INSTRUCTIONS §7.6 would change the frontend upload function and break `<img src>` display.
- **D5. `If-Match` / `Idempotency-Key`.** The frontend sends neither. **Accept both when present and don't require
  them** (no 428), so the frontend doesn't change. Transitions stay safe because the state machines reject invalid
  moves with 409.
- **D6. Error format.** **Follow the contract**: lowercase codes, `fieldErrors` as i18n keys, 422 for validation. Add
  `requestId` to the body, which the frontend ignores safely.
- **D7. Commit style.** The repo's husky hook enforces `WMS-<n>: …`. **Use `WMS-<n>: feat(scope): …`**, which
  satisfies both.
- **D8. What happens to `backend/demo-server`.** **Keep it untouched.** Vitest (via `@demo-core`) and the existing
  Playwright suite depend on it, and the INSTRUCTIONS §9 bar is "MSW-based tests still pass". The real backend gets its
  own Playwright project.
- **D9. Package manager.** The backend declares pnpm, but it isn't installed and a `package-lock.json` exists.
  **Enable pnpm via corepack, keep `pnpm-lock.yaml`, and delete the stray `backend/package-lock.json`.**
- **D10. Old NestJS modules** (products, policies, warranty check, failure categories, customers, RMA, reports, SLA).
  **First commit `backend/` as it is today, as a snapshot commit, then remove these modules during the B-phases.** They
  have no frontend consumer. They're untracked right now, so git can't recover them until that snapshot commit exists.

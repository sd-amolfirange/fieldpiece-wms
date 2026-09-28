# Integration progress

## 2026-09-28: warranty core for the US Fieldpiece deployment

**Decision** (developer, on Fieldpiece's review feedback): focus on the warranty core with US data. Recorded in
`docs/adr/ADR-012-warranty-core.md`. Feedback addressed: US data and USD; real-looking serial numbers; the product
list verified against fieldpiece.com; RMA removed; warranty core instead of service jobs; multiple registration entry
points; a batch number with the serial.

### Done

- `shared/wms-domain`: product categories and Fieldpiece models with per-model serial and batch formats; one
  product-level warranty (1 year from the date of purchase); coverage instead of part-wise entitlement; one warranty
  claim (`SUBMITTED` → `IN_REVIEW` → `APPROVED` with `REPAIR` / `REPLACE` / `CREDIT` → `CLOSED`, or `REJECTED`);
  channels `DEALER`, `BULK`, `PORTAL`, `WEB`, `EMAIL`, `ERP`, `API`, `RETAIL`.
- `backend/`: complaints, service jobs, RMA, OEM claims, part templates and brands removed. New modules and routes:
  `/categories`, `/units/:serial/coverage`, `/claims` (file and decide), and the registration hub: `/intake`, the public
  form (`/public/models`, `/public/registrations` with honeypot and per-IP limit), the partner API
  (`/partner/v1/registrations`, `X-Api-Key`, keys stored as SHA-256), email intake (`/inbound/email`, provider webhook
  with `X-Inbound-Secret`) and `/admin/partner-clients`. Simulator: `reset`, `erp-invoice`, `registration-email`,
  `marketplace-order`.
- Migration `20260928000000_warranty_core`: truncates the demo data, drops the old tables, creates the new ones;
  `npm run db:seed` reloads fictional US starting data (555-01xx phones, example.com emails) with real Fieldpiece
  products.
- New settings: `APP_TIMEZONE` (`America/Los_Angeles`), `APP_CURRENCY` (`USD`), `PUBLIC_FORM_LIMIT_PER_HOUR`,
  `INBOUND_EMAIL_ADDRESS`, `INBOUND_EMAIL_SECRET`, `PARTNER_API_LIMIT_PER_MINUTE`.
- Docs: `frontend/docs/api-contract.md` rewritten for the new API; `backend/README.md` (accounts, sample file
  `demo-assets/lonestar_sales_week38.xlsx`, settings); ADR-012.

### Open questions [CONFIRM]

1. Fieldpiece's real serial and batch label format. Assumed: 9-digit serial (`yy` + `ww` + 5-digit sequence), batch
   `yyww-Lnn`.
2. Replacement warranty: the replacement currently carries the rest of the original warranty. Or a new year?
3. Business time zone (`America/Los_Angeles` assumed) and the real inbound email address and mail provider.
4. `backend/openapi.json` still describes the previous API; regenerate it with `npm run openapi:export`.

## 2026-09-25: real backend built to the frontend's contract

**Decision** (developer): follow the frontend's implementation, change only the backend. Recorded in
`docs/adr/ADR-011-api-contract-alignment.md`. It resolves DISCOVERY.md §10 as D1 (a), D2 (a), D3 (demo endpoints behind
a flag), D4 (multipart), D5 (not required), D6 (contract errors) and D8 (mock server kept). For D9 the backend uses
npm, because pnpm isn't installed and every other package in the repo uses npm. For D10, a snapshot commit
(`6c48202`) was made first and the old modules were then removed.

### Done

- `backend/` rebuilt on the existing NestJS infrastructure (config, error filter, logger, rate limits, Prisma,
  storage):
  - new schema and migration, with checks, partial unique indexes, GIN indexes, id sequences and least-privilege
    grants;
  - modules: auth (password + refresh cookie), catalog/org, files, units, registrations and bulk import,
    complaints, claims, integrations, notifications, dashboard, and demo (accounts, simulator, seed and reset).
- The shared rules come from `shared/wms-domain`, bundled into the build.
- No changes in `frontend/`, `backend/demo-server/` or `shared/`.
- Docker image (built from the repo root), compose profiles, README, and ADR-011.

### Verification (all green)

| Check | Result |
| ----- | ------ |
| Backend typecheck, lint (0 warnings), build | pass |
| Backend unit tests | 8 suites, 31 tests pass |
| Backend API e2e (`test:e2e`, fixed clock, own DB) | 3 suites, 28 tests pass: sessions, role/scope matrix, W1-W7 rules, concurrent claim decisions, SQL status = shared rule at 4 dates, idle expiry |
| **Frontend Playwright suite against the real API** (`test:ui`, specs unchanged) | **9 / 9 pass** (a11y, screens, W1-W7), 7.0 min |
| Parity: mock core vs real API, same seed, every GET for all 4 roles | 292 requests, 0 differences |
| Frontend baseline (BASELINE.md) | unchanged (no frontend files touched) |

### How to run the frontend against the real API

```bash
cd backend && docker compose up -d && npm install && npm run db:deploy && npm run db:seed && npm run start:dev
cd frontend && npm run dev        # http://localhost:5173, proxies /api to :4000
```

### Open questions

1. Password reset: `POST /auth/forgot-password` isn't built. The frontend hides the link in the demo build. Build it
   (email, reset token, reset page) or move to an identity provider?
2. Real integrations: the service system, OEM, ERP, CRM, Finance and mailbox currently go through the simulator.
   Outbound messages are recorded as delivered.
3. Business time zone and currency: currently one per deployment (`APP_TIMEZONE`, `APP_CURRENCY`).
4. User administration: A11 is read-only in the frontend. Accounts are created by the seed only.
5. MinIO: the `quay.io/minio/minio` image wasn't pullable here, so local development uses the `local` storage
   driver. S3 is supported for real deployments.

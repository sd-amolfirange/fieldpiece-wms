# Integration progress

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

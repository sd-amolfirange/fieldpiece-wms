# Baseline: the "don't break it" bar

Recorded 2026-09-25 on branch `demo-workflows` at `aeac4b8`, on Windows 11, Node 22.22.3, npm 10.9.8. Nothing was
fixed to get these results. Every later phase has to be **at least this green** (INSTRUCTIONS.md §9).

## Frontend and the packages it depends on

| Package                | Install (`npm ci`) | Typecheck | Lint (0 warnings) | Unit / component tests     | Build        |
| ---------------------- | ------------------ | --------- | ----------------- | -------------------------- | ------------ |
| `shared/wms-domain`    | pass, 163 s        | pass, 11 s | pass, 18 s       | **2 files, 26 tests pass**, 22 s | pass, 14 s |
| `backend/demo-server`  | pass, 112 s        | pass, 9 s | pass, 17 s        | **2 files, 21 tests pass**, 13 s | pass, 8 s  |
| `frontend`             | pass, 356 s        | pass, 32 s | pass, 33 s       | **20 files, 93 tests pass** (Vitest + MSW over `@demo-core`), 71 s | pass, 34 s |

**Playwright e2e** (`frontend`, `npx playwright test`; starts demo server :4100 + Vite :5174; Chromium, 1 worker):
**9 of 9 pass in 5.6 min**: a11y (WCAG 2.2 AA on every demo screen), screens (every must-contain item), W1–W7.

Known noise, not failures: Vite 8 warnings about `esbuild`/`jsx` options from `@vitejs/plugin-react`.

## Existing NestJS backend (`backend/`, untracked)

Not part of the frontend bar. Recorded so later phases can compare.

| Check                     | Result                                                                                                 |
| ------------------------- | ------------------------------------------------------------------------------------------------------ |
| Typecheck                 | **fail** as found (Prisma client not generated after `npm install`); **pass** after `npx prisma generate` |
| Lint                      | **fail, 34 errors, all in `backend/demo-server/**`** (the NestJS ESLint config doesn't ignore the sibling package). `backend/src` and `backend/test` are clean |
| Unit tests (`npm test`)   | **13 suites, 87 tests pass**, 16 s                                                                     |
| e2e (`test:e2e`)          | not run: needs `docker compose up` (Postgres :5433, Redis, MinIO); nothing is running                   |

## Manual smoke list (journeys that work in the browser today, against the demo server)

Sign in with the "Sign in as" picker (`npm run dev` in `backend/demo-server` and `frontend`). These are the W1–W7
journeys from `frontend/docs/demo-workflows.md`, all covered by the Playwright specs above:

1. **W1 dealer bulk registration**: the dealer downloads the template, uploads the 25-row xlsx (22 valid, 3 errors),
   fixes rows inline and resubmits. The units appear as Active; the admin rejects the duplicate from the inbox; the
   dashboard's channel chart updates; the customer sees the new unit and a notification.
2. **W2 customer QR self-registration**: `/register?serial=&model=` is prefilled; the customer adds a purchase date and
   an invoice photo and gets Pending approval. The admin approves it next to the invoice. The unit shows part-wise
   warranties (1 / 10 / 5 years) and the customer downloads the certificate PDF.
3. **W3 complaint to claim**: the customer raises a complaint on the expired-unit, covered-compressor unit and sees
   the entitlement preview. The admin sends it to service, and the integration log shows the service request. The
   simulator returns a job result; the part is replaced and the Draft claim is created. The admin adds the RMA number
   and submits. The simulator's OEM approves; the admin marks it paid and the finance posting is logged. The customer's
   timeline shows Resolved.
4. **W4 dealer complaint**: the dealer finds its own unit, raises a complaint with a photo and the same entitlement
   preview. The admin sees source Dealer; the dealer tracks the complaint and the claim read-only.
5. **W5 void warranty**: the admin voids a unit with reason and note. The customer sees Void; the customer's complaint
   is chargeable, and no claim is created after service.
6. **W6 multi-channel intake**: the simulator sends an ERP invoice and a registration email; ERP and Email badges show
   in the inbox. The admin approves the emailed registration, which sends a CRM update, and the integration log shows
   in/out messages. The dashboard updates.
7. **W7 distributor oversight**: admin → Dealers & users shows NorthStar with 2 dealers. The distributor's home shows
   totals for both, filters by dealer, and filters My sold units to one dealer.
8. Cross-cutting: notification bell and mark-read, sign out, token refresh after expiry, 404 for out-of-scope
   records, role-based menus.

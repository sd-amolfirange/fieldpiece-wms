# ADR-011: The API implements the frontend's contract

- Status: accepted (2026-09-25)
- Deciders: developer (instruction: "follow the frontend implementation, change only the backend"), implemented by
  Claude Code
- Supersedes: `INSTRUCTIONS.md` §5.2 and the domain in `backend/FIELDPIECE_WARRANTY_BACKEND_INSTRUCTIONS.md`, where
  they disagree with the rows below

## Context

Phase 0 (`docs/integration/DISCOVERY.md`) found that the two sides described different systems. The frontend was
rebuilt around `frontend/docs/demo-workflows.md`: units with part-wise warranties, complaints, dealers,
distributors, customers, and a 5-step claim. It talked to an in-memory mock (`backend/demo-server`), and its contract
is written down in `frontend/docs/api-contract.md`. The first NestJS backend implemented the original backend spec
instead: technicians, claims agents, RMA, OIDC. The developer decided that the frontend is fixed and the backend
follows it.

## Decision

The API implements `frontend/docs/api-contract.md` exactly, on NestJS + PostgreSQL. The frontend code doesn't change.

| # | Topic | Decision |
| - | ----- | -------- |
| 1 | Domain | Units, part templates and part warranties, registrations inbox (5 channels, flags, merge), bulk import, complaints and entitlement, job results, 5-state claims, integration log, notifications, role-shaped dashboards, distributor -> dealer hierarchy. |
| 2 | Rules | Taken from `shared/wms-domain` (`@wms/domain`) at build time: warranty status, entitlement, registration row rules, claim transitions. Same code as the frontend. |
| 3 | Base path | `/api` (`API_PREFIX`). The API listens on 4000, where the frontend's dev proxy points by default. |
| 4 | Auth | `POST /auth/login {email,password}` returns an access JWT (HS256, 15 min) and sets the httpOnly `wms_refresh` cookie (random token, stored as SHA-256, 14-day idle expiry). `POST /auth/refresh` works with the cookie alone. Every request re-checks the session, so logout ends both tokens. An identity provider can replace the login later; no OIDC for now. |
| 5 | Cookie on file routes | The cookie authenticates `GET /files/:id`, the certificate PDF and the bulk templates only (`<img src>` can't send a bearer token). JSON endpoints need the bearer token. |
| 6 | Roles and scope | `admin`, `dealer`, `distributor`, `customer`, from our database. Scope rules as in api-contract §1; out-of-scope answers 404. |
| 7 | Errors | `{ code, message, fieldErrors?, requestId }`, with lowercase codes and `fieldErrors` as i18n keys. Validation is 422. `requestId` is new; the frontend ignores it. |
| 8 | Uploads | Multipart `POST /uploads` (images, videos, PDF; 15 MB) streamed to storage (local folder or S3). The magic bytes must match the declared type, and SVG is refused. File responses: `nosniff`, a sandboxed CSP (except PDF), `frame-ancestors 'self'`, so A03's `<object>` works. |
| 9 | Optimistic locking, idempotency | Not required, because the frontend sends neither `If-Match` nor `Idempotency-Key`. Status changes are compare-and-set on the current status, and units, registrations and complaints are row-locked while they change. |
| 10 | Demo features | `GET /auth/demo-accounts` and `POST /simulate/*` are mounted only with `DEMO_FEATURES_ENABLED=true`. The API refuses to start with it in production. |
| 11 | Ids | Readable ids (`REG-1001`, `CLM-1004`) from one Postgres sequence per prefix. |
| 12 | Dates | Business dates are `DATE` columns and `yyyy-MM-dd` strings. "Today" comes from `APP_TIMEZONE` (default `Asia/Kolkata`, [CONFIRM]), and the server clock is UTC. |
| 13 | Integrations | Outbound messages are recorded as delivered (`SUCCESS`) until real systems are connected ([CONFIRM]); retry marks them delivered. |
| 14 | Mock server | `backend/demo-server` stays: the frontend's Vitest suite runs on its core. |
| 15 | Not built | `POST /auth/forgot-password` (the frontend hides it in the demo build) and the legacy unrouted calls in api-contract §7. |

## Consequences

- The frontend runs unchanged against the real API. The proof is that the frontend's own Playwright suite
  (9 specs: a11y, screens, W1-W7) passes against it (`npm run test:ui` in `backend/`), and 292 GET responses across
  the four roles are identical to the mock's for the same seed.
- The original backend spec's features (RMA lifecycle, policies, failure categories, SLA, OIDC) are gone from the
  code. They're recoverable from commit `6c48202` if the product needs them again.
- `backend/openapi.json` is the machine-readable form of this ADR. Regenerate it with `npm run openapi:export`.

# ADR-012: Warranty core for the US Fieldpiece deployment

- Status: accepted (2026-09-28)
- Deciders: developer, on Fieldpiece's review feedback; implemented by Claude Code
- Supersedes: ADR-011 row 1 (domain) and row 12 (default time zone). The rest of ADR-011 stands: the API still
  implements `frontend/docs/api-contract.md`, which was rewritten for this change.

## Context

The first build followed `frontend/docs/demo-workflows.md` as written for an HVAC unit maker: units with part-wise
warranties (unit, compressor, PCB), a complaint that went to a service system, a job result, and a manufacturer (OEM)
claim with an RMA number and a Finance posting. Data was Indian (INR, `Asia/Kolkata`, made-up brands and models).

Fieldpiece reviewed the demo and asked for:

1. **US data and USD.** US customers, dealers and distributors with state and ZIP; money in USD; a US time zone.
2. **Real serial numbers.** Serials that look like the ones on Fieldpiece labels, not invented codes.
3. **The real product list.** Categories and models verified against fieldpiece.com (checked 2026-09-28): clamp
   meters, digital manifolds, Job Link probes, vacuum and recovery, leak detectors, refrigerant scales, airflow and
   temperature.
4. **Remove RMA.** No RMA numbers or RMA lifecycle.
5. **Focus on the warranty core**, not service jobs: register a product, know whether it's covered, handle a warranty
   claim.
6. **Multiple registration entry points**: not only the dealer screen and the customer portal, but a public web form,
   email, distributor ERPs, online marketplaces and retailers.
7. **A batch number with the serial**, so a claim can be traced to a production lot.

## Decision

| # | Topic | Decision |
| - | ----- | -------- |
| 1 | Warranty | **One product-level warranty per product**: from the date of purchase, for the model's `warrantyMonths`. Every Fieldpiece model has 12, per Fieldpiece's published policy ("All of our products have a 1 year warranty from date of purchase"). The end day is still covered. Part templates, part warranties and entitlement are removed. Shared rule: `shared/wms-domain/src/warranty.ts`. |
| 2 | Catalog | Product categories replace brands. Each model carries its category, description, warranty term and its own serial and batch formats (`serialPattern`, `batchPattern`), so a model with a different label can be added without code changes. |
| 3 | Serial and batch format | Assumed until Fieldpiece confirms the label: **serial = 9 digits, `yy` + `ww` (build year and week) + 5-digit sequence**, e.g. `243500101`; **batch = `yyww-Lnn`** (week and production line), e.g. `2435-L02`. **[CONFIRM]** Both are normalised (serial without spaces, upper-case). Batch is required from trusted senders and optional from customers (the label can be hard to read), but must match when given. |
| 4 | Warranty claim | **One `WarrantyClaim` entity** replaces complaint, service request, job result, RMA and OEM claim. Steps: `SUBMITTED` → `IN_REVIEW` → `APPROVED` (resolution `REPAIR`, `REPLACE` or `CREDIT`) → `CLOSED`, or `REJECTED` from `SUBMITTED` / `IN_REVIEW`. Customers, dealers and the desk file claims; **only the Fieldpiece warranty desk (admin) decides**. The coverage on the day of filing is stored on the claim. One open claim per product. Shared rule: `shared/wms-domain/src/claim-transitions.ts`. |
| 5 | Replacement | Closing a `REPLACE` claim registers the replacement serial for the same customer and dealer. **The replacement carries the rest of the original warranty** (it does not start a new year). **[CONFIRM]** The original product is marked replaced and is no longer covered. |
| 6 | Credit | Closing a `CREDIT` claim writes an outbound `FINANCE` / `credit_memo` message in USD. Finance posting on every claim, as in the OEM flow, is removed. |
| 7 | Channels | `DEALER`, `BULK`, `PORTAL`, `WEB`, `EMAIL`, `ERP`, `API`, `RETAIL`. **Auto-approved** (trusted senders; checked row by row against the catalog, clean rows registered at once, duplicate serials to review): `DEALER`, `BULK`, and partner API clients (`API`, `RETAIL`, `ERP`). **Always reviewed** by the desk: `PORTAL` (signed-in customer), `WEB` (public form), `EMAIL`, and ERP invoices. Approving a `WEB`, `EMAIL` or `RETAIL` registration sends a CRM customer update. |
| 8 | Public web form | `POST /public/registrations`, no account: multipart with proof of purchase, a honeypot field (`website`), and a per-IP limit (`PUBLIC_FORM_LIMIT_PER_HOUR`, default 20). |
| 9 | Partner API | `POST /partner/v1/registrations` with `X-Api-Key`. Keys are `fpk_` + 40 random characters, shown once when the admin creates the partner; **only their SHA-256 hash** (and a 12-character prefix for display) is stored. Admins can switch a key off. Up to 500 registrations per call; limit `PARTNER_API_LIMIT_PER_MINUTE`. |
| 10 | Email intake | Through the mail provider's **inbound webhook** (`POST /inbound/email`) with a **shared secret** in `X-Inbound-Secret` (`INBOUND_EMAIL_SECRET`, compared in constant time). The route answers 404 until the secret is set. The registration is read from the message text, attachments are kept as proof of purchase, and the result waits for review. No mailbox polling. |
| 11 | Locale | `APP_TIMEZONE=America/Los_Angeles` and `APP_CURRENCY=USD` by default. **[CONFIRM]** the business time zone. |
| 12 | Data | Fictional US people and companies: phone numbers in the 555-01xx range, `example.com` emails. Products and categories are real Fieldpiece ones. |

## Consequences

- Migration `20260928000000_warranty_core` **truncates all demo data** (units, registrations, complaints, claims,
  users, and the rest), drops the complaint, job, part and brand tables, and creates the new ones (categories,
  warranty claims, partner clients). `npm run db:seed` reloads the starting data. A live system would need a data
  migration instead of the `TRUNCATE`.
- The API surface changed: `/complaints`, `/units/:serial/entitlement`, `/brands`, `/simulate/job-result` and
  `/simulate/oem-decision` are gone; `/categories`, `/units/:serial/coverage`, `POST /claims`, `/intake`,
  `/public/*`, `/partner/v1/registrations`, `/inbound/email`, `/admin/partner-clients` and
  `/simulate/marketplace-order` are new. `frontend/docs/api-contract.md` describes it; `backend/openapi.json` must
  be regenerated with `npm run openapi:export`.
- The public, partner and inbound routes add unauthenticated surface (`npm run routes:public` lists it). Each has its
  own control: rate limit and honeypot, API key, or shared secret.
- Claims are simpler to review but lose the service-job detail (technician, parts replaced, sign-off). If Fieldpiece
  later wants repair tracking, it goes on the claim, not back into a separate job entity.
- Open items for Fieldpiece: the real serial and batch label format, the replacement warranty rule, the time zone,
  and the inbound email address and provider.

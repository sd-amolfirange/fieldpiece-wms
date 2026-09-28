# API contract: what the frontend expects from the backend

This document lists every endpoint of the warranty API for the US Fieldpiece deployment: the product catalog, registered
products with one product-level warranty, registrations from every channel (including the public web form, the partner
API and email intake), and the warranty claim. The frontend calls these endpoints; partner systems and the mail
provider call the intake endpoints. It describes the current behaviour only; nothing here changes code.

- Source of truth for the routes: the controllers in `backend/src/modules/**/*.controller.ts` (routes, roles, query
  parameters, bodies, status codes). The mock in `backend/demo-server/` serves the same routes for the frontend's unit
  tests.
- Source of truth for the shapes: `shared/wms-domain/src/types.ts` and `views.ts` (package `@wms/domain`). The field
  lists below are copied from there.
- Error codes: `backend/src/common/errors/app-error.ts`.
- Frontend callers: `frontend/src/features/*/api.ts`. Pages never call the API directly.
- Design decision: `docs/adr/ADR-012-warranty-core.md`.

## 1. Conventions

### Base path and format

- Every path below is relative to `/api` (backend `API_PREFIX`, frontend `VITE_API_BASE_URL=/api`).
- JSON in and out, except where a section says multipart or binary.
- Dates are `yyyy-MM-dd` strings (`IsoDate`). Timestamps are ISO 8601 strings (`IsoDateTime`).
- "Today" (warranty status, future-date checks, "this month") is the calendar day in `APP_TIMEZONE`
  (`America/Los_Angeles`).
- Money is a number in the account currency (`SessionUser.currency`, `"USD"`), with at most 2 decimals.

### Authentication

| Item          | Rule                                                                                                                                                                                                                                         |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Access token  | Returned in the body of `POST /auth/login` and `POST /auth/refresh`. The frontend keeps it in memory only and sends `Authorization: Bearer <token>`.                                                                                         |
| Refresh token | httpOnly cookie `wms_refresh`, `SameSite=Lax`, `Path=/api`, `Secure` on HTTPS. Set by login and refresh, cleared by logout.                                                                                                                  |
| Expiry        | Any call can answer `401`. The frontend then calls `POST /auth/refresh` once (single-flight) and retries. If refresh answers `401`, it signs the user out.                                                                                   |
| File links    | `GET /files/:id`, `GET /units/:serial/certificate.pdf` and `GET /bulk-imports/template.csv` / `.xlsx` also accept the refresh cookie, because `<img>`, `<object>` and plain links can't send a Bearer header.                                |
| Public routes | No sign-in: `/auth/*`, `GET /public/models`, `POST /public/registrations`, `POST /partner/v1/registrations` (`X-Api-Key`), `POST /inbound/email` (`X-Inbound-Secret`), `/health/*`, and `GET /auth/demo-accounts` when demo features are on. |

### Errors

Every error has the same body:

```json
{
  "code": "validation_error",
  "message": "Check the highlighted fields.",
  "fieldErrors": { "purchaseDate": "validation.date" },
  "requestId": "req-7f3a"
}
```

| Field         | Type                     | Notes                                                                                                                                     |
| ------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `code`        | string                   | Machine code, one of the list below.                                                                                                      |
| `message`     | string                   | Plain-language sentence. The frontend shows it in a toast.                                                                                |
| `fieldErrors` | `Record<string, string>` | Optional. Values are i18n keys (e.g. `validation.describeFault`, `rowErrors.invalid_batch`); the frontend puts each under its form field. |
| `requestId`   | string                   | For support and logs. The frontend ignores it.                                                                                            |

Codes:

| Area                 | Codes                                                                                                                                 |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| General              | `unauthenticated`, `invalid_credentials`, `forbidden`, `not_found`, `validation_error`, `bad_request`, `rate_limited`, `server_error` |
| Files                | `too_large`, `unsupported_type`, `upload_failed`, `invalid_attachment`, `empty_file`                                                  |
| Registrations        | `duplicate_serial`, `not_pending`, `unknown_model`, `nothing_to_merge`                                                                |
| Registered products  | `already_void`, `not_registered`                                                                                                      |
| Claims, integrations | `claim_open`, `invalid_transition`, `not_failed`                                                                                      |
| Partner API          | `invalid_api_key`                                                                                                                     |

Status codes used: `200`, `201` (uploads, bulk imports, new partner client), `202` (inbound email), `204` (logout),
`400` unreadable request or upload, `401` unauthenticated (also a wrong API key or inbound secret), `403` wrong role,
`404` not found **or not visible to this user** (scoping never reveals that a record exists), `409` state conflict,
`413` file too large, `415` unsupported file type, `422` validation, `429` rate limited (with `Retry-After`).

### Rate limits

| Limit                                       | Applies to                                              |
| ------------------------------------------- | ------------------------------------------------------- |
| 600 requests a minute, 120 of them writes   | Every route, per user (per IP when signed out)          |
| `AUTH_LOGIN_LIMIT_PER_MINUTE` (30) per IP   | `POST /auth/login`                                      |
| `PUBLIC_FORM_LIMIT_PER_HOUR` (20) per IP    | `POST /public/registrations`                            |
| `PARTNER_API_LIMIT_PER_MINUTE` (120) per IP | `POST /partner/v1/registrations`, `POST /inbound/email` |

### Lists

Paged list endpoints take `page` (from 1), `pageSize` (default 25, clamped to 100), `sort` (`"field"` ascending,
`"-field"` descending, from the endpoint's allow-list) and `q` (free-text search, up to 100 characters), plus the
filters listed per endpoint. They return:

```ts
interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}
```

### Scoping (applies to every endpoint)

The server decides which rows a user can see. The frontend only hides menus and buttons.

| Role        | Registered products, registrations, claims                           | Bulk imports  | Claim decisions | Admin data (org, partner clients, integrations, simulator) |
| ----------- | -------------------------------------------------------------------- | ------------- | --------------- | ---------------------------------------------------------- |
| admin       | Everything                                                           | Everything    | Yes             | Yes                                                        |
| distributor | Rows whose `dealerId` is one of its dealers (`Dealer.distributorId`) | Same rows     | No (`403`)      | No (`403`)                                                 |
| dealer      | Rows whose `dealerId` is its own                                     | Its own       | No (`403`)      | No (`403`)                                                 |
| customer    | Rows whose `customerId` is its own                                   | Never (`403`) | No (`403`)      | No (`403`)                                                 |

Everyone files and follows claims in their scope; only the warranty desk (admin) moves them on. A record outside the
user's scope answers `404`, not `403`.

## 2. Enums

| Name                   | Values                                                                                                                                                                                   |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Role`                 | `admin`, `dealer`, `distributor`, `customer`                                                                                                                                             |
| `WarrantyStatus`       | `ACTIVE`, `EXPIRING_SOON` (30 days or fewer left), `EXPIRED` (also a product that was replaced), `VOID`, `PENDING` (known serial, not registered yet)                                    |
| `VoidReason`           | `UNAUTHORIZED_REPAIR`, `MISUSE`, `PHYSICAL_DAMAGE`, `OTHER`                                                                                                                              |
| `UnitEventType`        | `registered`, `voided`, `claim_filed`, `claim_closed`, `replaced`, `note`                                                                                                                |
| `RegistrationChannel`  | `DEALER` (dealer form), `BULK` (dealer file upload), `PORTAL` (signed-in customer), `WEB` (public form), `EMAIL`, `ERP`, `API` (partner system), `RETAIL` (marketplace or retailer feed) |
| `RegistrationStatus`   | `PENDING`, `APPROVED`, `REJECTED`                                                                                                                                                        |
| `RegistrationFlag`     | `EXCEPTION`, `DUPLICATE`, `MODEL_MISMATCH`                                                                                                                                               |
| `BulkRowStatus`        | `REGISTERED`, `FIXED`, `ERROR`, `REVIEW`                                                                                                                                                 |
| `RowErrorCode`         | `required`, `invalid_serial`, `invalid_batch`, `unknown_model`, `duplicate_serial`, `duplicate_in_file`, `invalid_date`, `future_date`                                                   |
| `ClaimSource`          | `CUSTOMER`, `DEALER`, `ADMIN`                                                                                                                                                            |
| `ClaimStatus`          | `SUBMITTED`, `IN_REVIEW`, `APPROVED`, `REJECTED`, `CLOSED`                                                                                                                               |
| `IssueType`            | `NO_POWER`, `INACCURATE_READING`, `DISPLAY`, `CONNECTIVITY`, `LEAK_OR_PRESSURE`, `MECHANICAL`, `OTHER`                                                                                   |
| `Resolution`           | `REPAIR`, `REPLACE`, `CREDIT`                                                                                                                                                            |
| `CoverageReason`       | `IN_WARRANTY`, `EXPIRED`, `VOID`, `NOT_REGISTERED`                                                                                                                                       |
| `IntegrationSystem`    | `ERP`, `EMAIL`, `PARTNER`, `CRM`, `FINANCE`                                                                                                                                              |
| `IntegrationDirection` | `IN`, `OUT`                                                                                                                                                                              |
| `IntegrationStatus`    | `PENDING`, `SUCCESS`, `FAILED`                                                                                                                                                           |

Integration message `type` values the frontend has labels for: `erp_invoice`, `registration_email`,
`partner_registration`, `crm_update`, `credit_memo`. Other values are shown as-is.

Serial and batch formats are per model (`Model.serialPattern`, `batchPattern`). Every serial must also match
`^[A-Z0-9-]{6,20}$`. The assumed Fieldpiece label format, used by every seeded model, is a 9-digit serial (`yy` + `ww` +
5-digit sequence, e.g. `243500101`) and a batch `yyww-Lnn` (e.g. `2435-L02`). **[CONFIRM]** with Fieldpiece. Serials
are stored without spaces and upper-cased; batches trimmed and upper-cased.

## 3. Shapes

Optional fields end in `?`. "View" shapes are the stored record plus computed or looked-up fields.

```ts
interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  dealerId?: string;
  distributorId?: string;
  customerId?: string;
  orgName?: string; // dealer, distributor or customer display name
  currency: string; // ISO 4217, "USD"
}

interface Attachment {
  id: string;
  name: string;
  mime: string;
  size: number;
  url: string;
  uploadedBy: string;
  createdAt: IsoDateTime;
}

interface ProductCategory {
  id: string;
  name: string; // e.g. "Clamp meters"
}

interface ModelView {
  id: string;
  code: string; // model number as printed on the product, e.g. "SC680"
  categoryId: string;
  categoryName: string;
  name: string; // e.g. "Swivel Head Wireless Clamp Meter"
  description: string;
  warrantyMonths: number; // from the date of purchase; 12 for every Fieldpiece model
  serialPattern: string; // regular expression every serial of this model must match
  batchPattern: string; // regular expression every batch number of this model must match
}

interface UnitView {
  // A registered (or known, not yet registered) product
  serial: string;
  batchNumber?: string;
  modelId: string;
  dealerId?: string;
  customerId?: string;
  purchaseDate?: IsoDate;
  placeOfPurchase?: string; // when not bought from a dealer in the system, e.g. an online marketplace
  warrantyStart?: IsoDate; // empty until registered
  warrantyEnd?: IsoDate; // last covered day
  void?: { reason: VoidReason; note?: string; by: string; byName: string; at: IsoDateTime };
  registrationId?: string;
  replacesSerial?: string; // set on a replacement product
  replacedBySerial?: string; // set on a product replaced under warranty
  attachmentIds: string[];
  history: {
    at: IsoDateTime;
    type: UnitEventType;
    byName: string;
    text?: string;
    reason?: VoidReason;
    refId?: string;
  }[];
  modelCode: string;
  modelName: string;
  modelDescription: string;
  categoryName: string;
  dealerName?: string;
  customerName?: string;
  status: WarrantyStatus; // computed for today
  daysRemaining: number; // computed for today, 0 when not covered
}

interface Coverage {
  covered: boolean;
  reason: CoverageReason;
  warrantyEnd?: IsoDate;
}

interface RegistrationView {
  id: string;
  channel: RegistrationChannel;
  status: RegistrationStatus;
  flags: RegistrationFlag[];
  serial: string;
  batchNumber?: string;
  modelCode: string;
  customer: { name: string; phone?: string; email?: string; city?: string; state?: string; zip?: string };
  customerId?: string;
  dealerId?: string;
  purchaseDate?: IsoDate;
  invoiceNumber?: string;
  placeOfPurchase?: string;
  attachmentIds: string[];
  submittedBy: string; // user id, "public", "system" or "partner:<id>"
  submittedByName: string;
  submittedAt: IsoDateTime;
  duplicateOfSerial?: string;
  rejectReason?: string;
  reviewedByName?: string;
  reviewedAt?: IsoDateTime;
  importId?: string; // bulk upload this row came from
  dealerName?: string;
  duplicateOf?: UnitView; // the existing product, for the A03 comparison (admins only)
}

type RegistrationRowInput = {
  serial?: string;
  batchNumber?: string;
  modelCode?: string;
  purchaseDate?: string;
  customerName?: string;
  customerPhone?: string;
  customerEmail?: string;
  city?: string;
  state?: string; // two-letter US state
  zip?: string; // 5 digits, optional +4
  invoiceNumber?: string;
};

interface BulkImportView {
  id: string;
  fileName: string;
  dealerId: string;
  uploadedBy: string;
  uploadedByName: string;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  rows: {
    rowNumber: number; // sheet row, header = 1
    values: RegistrationRowInput;
    errors: Partial<
      Record<"serial" | "batchNumber" | "modelCode" | "purchaseDate" | "customerName", RowErrorCode>
    >;
    status: BulkRowStatus;
    registrationId?: string;
  }[];
  dealerName?: string;
  counts: { total: number; registered: number; errors: number; review: number };
}

interface WarrantyClaimView {
  id: string; // e.g. "CLM-1004"
  unitSerial: string;
  source: ClaimSource;
  raisedBy: string;
  raisedByName: string;
  dealerId?: string;
  customerId?: string;
  issueType: IssueType;
  description: string;
  attachmentIds: string[];
  status: ClaimStatus;
  coverage: Coverage; // when the claim was filed
  resolution?: Resolution;
  creditAmount?: number; // CREDIT resolution, in the account currency
  replacementSerial?: string; // REPLACE resolution, set on close
  replacementBatchNumber?: string;
  decisionNote?: string;
  rejectReason?: string;
  reviewedByName?: string;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  history: { at: IsoDateTime; status: ClaimStatus; byName: string; text?: string }[];
  batchNumber?: string; // the product's
  modelCode: string;
  modelName: string;
  categoryName: string;
  dealerName?: string;
  customerName?: string;
  purchaseDate?: IsoDate;
  warrantyEnd?: IsoDate;
  warrantyStatus: WarrantyStatus; // the product's status today
  attachments: Attachment[];
}

interface IntegrationMessage {
  id: string;
  system: IntegrationSystem;
  direction: IntegrationDirection;
  type: string;
  status: IntegrationStatus;
  payload: unknown;
  attempts: number;
  lastError?: string;
  refId?: string;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

interface Notification {
  id: string;
  userId: string;
  key: string; // i18n key under "notifications." in the frontend (list in section 5.13)
  params?: Record<string, string | number>;
  link?: string; // frontend route opened on click
  createdAt: IsoDateTime;
  read: boolean;
}

interface DealerView {
  id: string;
  name: string;
  city: string;
  state: string;
  distributorId?: string;
  distributorName?: string;
}

interface IntakeInfo {
  publicFormPath: string; // "/register-product"
  inboundEmail: string; // INBOUND_EMAIL_ADDRESS
  partnerApiPath: string; // "/api/partner/v1"
}

interface PartnerClientView {
  id: string;
  name: string;
  channel: "API" | "RETAIL" | "ERP";
  dealerId?: string;
  dealerName?: string;
  keyPrefix: string; // first 12 characters of the key, e.g. "fpk_seed_mar"
  active: boolean;
  lastUsedAt?: IsoDateTime;
}
```

## 4. Endpoint summary

| Feature          | Method and path                                    | Roles / auth                   | Screens                        |
| ---------------- | -------------------------------------------------- | ------------------------------ | ------------------------------ |
| Auth             | `GET /auth/demo-accounts`                          | Public (demo only)             | Sign-in                        |
|                  | `POST /auth/login`                                 | Public                         | Sign-in                        |
|                  | `POST /auth/refresh`                               | Refresh cookie                 | All                            |
|                  | `POST /auth/logout`                                | Any                            | Account menu                   |
| Products         | `GET /units`                                       | All                            | A04, DL04, CU02, claim pickers |
|                  | `GET /units/:serial`                               | All                            | A05, DL05, CU03                |
|                  | `GET /units/:serial/certificate.pdf`               | All (Bearer or cookie)         | A05, DL05, CU03                |
|                  | `GET /units/:serial/coverage`                      | All                            | New claim (CU04, DL06)         |
|                  | `POST /units/:serial/void`                         | admin                          | A05                            |
| Registrations    | `GET /registrations`                               | All                            | A02, CU02                      |
|                  | `GET /registrations/:id`                           | All                            | A03                            |
|                  | `POST /registrations`                              | All                            | CU01, DL03                     |
|                  | `POST /registrations/:id/approve`                  | admin                          | A03                            |
|                  | `POST /registrations/:id/reject`                   | admin                          | A03                            |
|                  | `POST /registrations/:id/merge`                    | admin                          | A03                            |
|                  | `POST /registrations/bulk-approve`                 | admin                          | A02                            |
| Bulk import      | `GET /bulk-imports/template.csv`, `.xlsx`          | All (Bearer or cookie)         | DL02                           |
|                  | `POST /bulk-imports` (multipart)                   | admin, dealer, distributor     | DL02                           |
|                  | `GET /bulk-imports`                                | admin, dealer, distributor     | DL02                           |
|                  | `GET /bulk-imports/:id`                            | admin, dealer, distributor     | DL02                           |
|                  | `PUT /bulk-imports/:id/rows`                       | admin, dealer, distributor     | DL02                           |
| Registration hub | `GET /intake`                                      | admin, dealer, distributor     | Registration hub               |
|                  | `GET /public/models`                               | Public                         | Public form                    |
|                  | `POST /public/registrations` (multipart)           | Public, rate-limited           | Public form                    |
|                  | `POST /partner/v1/registrations`                   | `X-Api-Key`                    | Partner systems                |
|                  | `POST /inbound/email`                              | `X-Inbound-Secret`             | Mail provider webhook          |
|                  | `GET /admin/partner-clients`, `POST`, `PATCH /:id` | admin                          | Registration hub               |
| Files            | `POST /uploads` (multipart)                        | All                            | CU01, DL03, new claim          |
|                  | `GET /files/:id`                                   | All (scoped; Bearer or cookie) | A03, A10, CU05                 |
| Catalog          | `GET /models`, `GET /categories`                   | All                            | A06, forms, filters            |
|                  | `GET /dealers`                                     | admin, dealer, distributor     | Filters, DL03, DL01            |
| Claims           | `GET /claims`, `GET /claims/counts`                | All                            | A09, DL07, my claims           |
|                  | `GET /claims/:id`                                  | All                            | A10, DL07, CU05                |
|                  | `POST /claims`                                     | All                            | CU04, DL06                     |
|                  | `POST /claims/:id/transitions`                     | admin                          | A10                            |
| Integrations     | `GET /integrations`                                | admin                          | A12, A13                       |
|                  | `POST /integrations/:id/retry`                     | admin                          | A12                            |
| Dashboard        | `GET /dashboard/summary`                           | All                            | A01, DL01, customer home       |
| Notifications    | `GET /notifications`, `POST /notifications/read`   | All                            | Header bell                    |
| Admin            | `GET /admin/org`                                   | admin                          | A11                            |
| Simulator        | `POST /simulate/*` (4 routes)                      | admin (demo only)              | A13                            |
| Health           | `GET /health/live`, `GET /health/ready`            | Public (internal network)      | None                           |

## 5. Endpoints by feature

### 5.1 Auth

**`GET /auth/demo-accounts`**: demo only. Response `{ email, label, password }[]` to fill the sign-in picker. Mounted
only with `DEMO_FEATURES_ENABLED=true`, which the API refuses in production.

**`POST /auth/login`**

- Body: `{ email: string; password: string }`
- `200`: `{ accessToken: string; user: SessionUser }` and sets the `wms_refresh` cookie.
- `401` `invalid_credentials` on a wrong email or password (same response time either way); `429` `rate_limited`.

**`POST /auth/refresh`**: no body; reads the cookie. `200` `{ accessToken; user: SessionUser }` and extends the
cookie; `401` `unauthenticated` when the session is gone.

**`POST /auth/logout`**: ends the session (both tokens), clears the cookie, `204`.

### 5.2 Registered products

**`GET /units`**: `Paginated<UnitView>`

- Query: list params; `status?: WarrantyStatus`; `dealerId?` (admin and distributor filters; a distributor can only
  pass its own dealers). `q` matches serial, batch number, customer name, dealer name and model code. Default sort
  `serial`.
- Scoped as in section 1. The new-claim product picker calls it with `pageSize=100&sort=serial`.

**`GET /units/:serial`**: `UnitView`, with `status` and `daysRemaining` computed for today. `404` if not visible.

**`GET /units/:serial/certificate.pdf`**: `application/pdf` download (`warranty-<serial>.pdf`) with the serial, batch
number, product, owner, purchase date, warranty start and end, and the replacement or void status. Bearer or refresh
cookie. `409` `not_registered` before registration.

**`GET /units/:serial/coverage`**: `Coverage` a claim on this product would get today (shown before submitting a
claim). Same result for every role that can see the product.

| Product state                                | `covered` | `reason`         |
| -------------------------------------------- | --------- | ---------------- |
| Registered, today on or before `warrantyEnd` | `true`    | `IN_WARRANTY`    |
| Registered, warranty ended, or replaced      | `false`   | `EXPIRED`        |
| Warranty voided                              | `false`   | `VOID`           |
| Known serial, not registered                 | `false`   | `NOT_REGISTERED` |

**`POST /units/:serial/void`** (admin)

- Body: `{ reason: VoidReason; note?: string }`
- `200`: updated `UnitView` with `void` set (`by`, `byName`, `at` from the signed-in admin and now),
  `status: "VOID"`, and a `voided` history event with `reason` and `text = note`.
- Notifies the product's customer, dealer and distributor (`unit_voided`).
- `422` `fieldErrors.reason = "validation.voidReason"`; `409` `already_void`; `409` `not_registered`.

### 5.3 Registrations

Every entry point goes through the same rules. There are two kinds of channel:

| Kind           | Channels                                                       | Result                                                                                                                                                                                                                                                                                                           |
| -------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Trusted sender | `DEALER`, `BULK`, and partner clients (`API`, `RETAIL`, `ERP`) | Each row is checked against the catalog. A clean row is **approved at once**; a serial that's already registered goes to admin review (`PENDING`, `DUPLICATE` + `EXCEPTION`); any other problem is returned as row errors and nothing is stored.                                                                 |
| Reviewed       | `PORTAL`, `WEB`, `EMAIL`, and ERP invoices (simulator)         | Always `PENDING` for the warranty desk. Flags: `EXCEPTION` when the serial is unknown (not for ERP invoices, where new serials are expected); `DUPLICATE` + `EXCEPTION` when already registered; `MODEL_MISMATCH` when the model differs from the known product. Admins are notified (`registration_submitted`). |

Row rules for trusted senders (`validateRegistrationRow` in `shared/wms-domain/src/registration-rules.ts`): model
required and in the catalog; serial required, matching the loose pattern and the model's `serialPattern`, not
registered, not repeated in the same file or request; batch number required and matching the model's `batchPattern`;
purchase date required, `yyyy-MM-dd`, not in the future; customer name required.

**`GET /registrations`**: `Paginated<RegistrationView>`

- Query: list params; `status?`, `channel?`, `flag?`. `q` matches serial, batch number, customer, model code and
  dealer. Newest first (`-submittedAt`) by default.
- Customers get only their own (CU02 shows their `PENDING` ones).

**`GET /registrations/:id`**: `RegistrationView`, including `duplicateOf` for admins when the serial is already
registered.

**`POST /registrations`**: `200` `RegistrationView`

- Body: `{ serial, batchNumber?, modelCode, purchaseDate, customerName?, customerPhone?, customerEmail?, city?, state?,
zip?, invoiceNumber?, placeOfPurchase?, dealerId?, attachmentIds?: string[] }`. Unknown fields are ignored.
- **Customer (CU01, channel `PORTAL`)**: needs `serial` and `modelCode` (`validation.required`,
  `rowErrors.unknown_model`, `rowErrors.invalid_serial`), `purchaseDate` (`validation.date`, not in the future:
  `rowErrors.future_date`) and at least one attachment (`attachmentIds: "validation.invoiceRequired"`). `batchNumber`
  is optional (a label can be hard to read) but must match the model when given (`rowErrors.invalid_batch`); `state`
  and `zip` must be US values when given (`validation.state`, `validation.zip`). The customer's name and contact come
  from their account. Always `PENDING`, flagged as above.
- **Dealer, distributor or admin (DL03, channel `DEALER`)**: trusted-sender rules. Problems answer `422` with
  `fieldErrors` as `rowErrors.<code>`. A dealer registers for itself; a distributor or admin must pass a `dealerId`
  it can see (`validation.pickDealer`).
- Attachments must be files the caller uploaded (`422` `invalid_attachment`).

**`POST /registrations/:id/approve`** (admin): creates or completes the product and starts its warranty **from the
purchase date (today when unknown) for the model's `warrantyMonths`**; the end day is still covered. Sets
`customerId` (matched by the last 10 digits of the phone or by email, else a new customer), adds a `registered`
history event, notifies customer, dealer and distributor (`registration_approved`). **A `WEB`, `EMAIL` or `RETAIL`
registration also writes an outbound `CRM` / `crm_update` integration message.** `409` `duplicate_serial` for
duplicates, `409` `not_pending`, `409` `unknown_model`.

**`POST /registrations/:id/reject`** (admin): body `{ reason: string }` (required, `validation.reasonRequired`).
Notifies the submitter and the customer (`registration_rejected`). `409` `not_pending`.

**`POST /registrations/:id/merge`** (admin): for a duplicate; adds this registration's attachments to the existing
product, adds a `note` history event and marks the registration `APPROVED`. `409` `nothing_to_merge`, `409`
`not_pending`.

**`POST /registrations/bulk-approve`** (admin): body `{ ids: string[] }` (up to 500), response `{ approved: number;
skipped: number }`. Skips duplicates, decided rows and unknown models.

### 5.4 Bulk import (DL02)

**`GET /bulk-imports/template.csv`** and **`template.xlsx`**: the template files, with the columns Serial number,
Batch number, Model, Purchase date, Customer name, Customer phone, Customer email, City, State, ZIP, Invoice number,
and one sample row. Uploaded columns are matched by header name, in any order (aliases such as "Lot number", "Model
number", "Date of purchase" and "Zip code" are accepted).

**`POST /bulk-imports`**: multipart, fields `file` (`.xlsx` or `.csv`, 5 MB and 5,000 rows by default), `name?` (file
name), `dealerId?` (distributor or admin). `201` `BulkImportView`, channel `BULK`. Every row is checked with the
trusted-sender rules:

| Rule                                                                                                      | Result for that row                              |
| --------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| Every check passes                                                                                        | `REGISTERED` (product registered at once)        |
| Serial already registered (and nothing else wrong)                                                        | `REVIEW`: a `PENDING` registration for the admin |
| Missing value, bad serial or batch format, unknown model, bad or future date, serial repeated in the file | `ERROR` with `errors[field] = RowErrorCode`      |

`415` `unsupported_type` for other or unreadable files; `413` `too_large`; `422` `empty_file` when there are no rows;
`422` `validation_error` for too many rows or no file. Notifies the uploader (`bulk_processed`).

**`GET /bulk-imports`**: `BulkImportView[]`, the caller's upload history (scoped by dealer), newest first.

**`GET /bulk-imports/:id`**: `BulkImportView`.

**`PUT /bulk-imports/:id/rows`**: body `{ rows: { rowNumber: number; values: RegistrationRowInput }[] }` with the
fixed rows only. Only rows in `ERROR` are checked again; fixed rows become `FIXED` and are registered. Response: the
updated `BulkImportView`.

### 5.5 Registration hub

The registration hub page shows where registrations can come in and manages partner keys.

**`GET /intake`** (admin, dealer, distributor): `IntakeInfo`.

#### Public registration form (channel `WEB`)

**`GET /public/models`**: no sign-in. `ModelView[]`, the same list as `GET /models`, for the form's model picker.

**`POST /public/registrations`**: no sign-in. Multipart:

| Field                                   | Rule                                                                                                                                      |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `serial`, `modelCode`                   | Required; checked as for CU01                                                                                                             |
| `batchNumber`                           | Optional; must match the model when given                                                                                                 |
| `purchaseDate`                          | Required, `yyyy-MM-dd`, not in the future                                                                                                 |
| `customerName`                          | Required (`validation.required`)                                                                                                          |
| `customerEmail`                         | Required, an email address (`validation.email`)                                                                                           |
| `customerPhone`, `city`, `state`, `zip` | Optional; `state` two letters, `zip` 5 digits (+4)                                                                                        |
| `placeOfPurchase`, `invoiceNumber`      | Optional                                                                                                                                  |
| `file`                                  | Required proof of purchase, photo or PDF, 15 MB (`attachmentIds: "validation.invoiceRequired"`)                                           |
| `website`                               | **Honeypot.** Hidden from people; a bot fills it in. When set, the answer is a success (`registrationId: "REG-0"`) and nothing is stored. |

Text fields are cut at 200 characters. `200` `{ registrationId: string; status: "PENDING" }`; the registration is
always reviewed by the warranty desk. `422` with `fieldErrors`; `413` / `415` for the file; `429` `rate_limited` after
`PUBLIC_FORM_LIMIT_PER_HOUR` submissions from one IP in an hour.

#### Partner API (channels `API`, `RETAIL`, `ERP`)

**`POST /partner/v1/registrations`**: for distributor ERPs, online marketplaces and retailers. No sign-in; header
`X-Api-Key: fpk_...` (`401` `invalid_api_key` when missing, wrong or switched off). The channel and dealer come from
the partner client.

- Body: one registration, or `{ registrations: [...] }` with 1 to 500 items (`422` otherwise). Each item:

```json
{
  "serial": "243500101",
  "batchNumber": "2435-L02",
  "modelCode": "SC680",
  "purchaseDate": "2026-09-15",
  "invoiceNumber": "INV-10001",
  "placeOfPurchase": "Example Tool Mart",
  "customer": {
    "name": "Alex Rivera",
    "email": "alex.rivera@example.com",
    "phone": "(713) 555-0100",
    "city": "Houston",
    "state": "TX",
    "zip": "77002"
  }
}
```

Flat `customerName`, `customerEmail`, `customerPhone`, `city`, `state`, `zip` are accepted too, as are `model` for
`modelCode` and `orderNumber` for `invoiceNumber`. For a `RETAIL` partner, `placeOfPurchase` defaults to the
partner's name.

- Each item follows the trusted-sender rules, in its own transaction.
- `200`: `{ results: { index: number; serial: string; status: "REGISTERED" | "REVIEW" | "ERROR"; registrationId?:
string; errors?: Partial<Record<RegistrationField, RowErrorCode>> }[] }`, one per item in order.
- Writes one inbound `PARTNER` (or `ERP` for an ERP partner) / `partner_registration` message with the counts and
  serials. `429` after `PARTNER_API_LIMIT_PER_MINUTE` calls in a minute.

#### Email intake (channel `EMAIL`)

**`POST /inbound/email`**: called by the mail provider's inbound webhook for every message to
`INBOUND_EMAIL_ADDRESS`. No sign-in; header `X-Inbound-Secret` must equal `INBOUND_EMAIL_SECRET` (`401` otherwise).
**Answers `404` while `INBOUND_EMAIL_SECRET` isn't set** (email intake off).

- Body: `{ from, to, subject, text, attachments: { filename, contentType, contentBase64 }[] }`.
- The registration is read from lines of the text such as `Serial number: 243500101`, `Batch: 2435-L02`,
  `Model: SC680`, `Purchased: 09/15/2026` (US or ISO dates), `Phone:`, `City:`, `State:`, `ZIP:`, `Invoice:`; the
  sender's name and email come from `from`. Up to 5 attachments are kept as proof of purchase (photos and PDF only;
  others, such as signature images in other formats, are skipped).
- `202` `{ status: "RECEIVED"; registrationId: string }`: a `PENDING` registration (reviewed channel) and an inbound
  `EMAIL` / `registration_email` message.
- `202` `{ status: "IGNORED" }` when no serial number is found: a `FAILED` inbound `EMAIL` / `registration_email`
  message for the desk to follow up.

#### Partner clients (admin)

**`GET /admin/partner-clients`**: `PartnerClientView[]`, oldest first.

**`POST /admin/partner-clients`**: body `{ name: string; channel: "API" | "RETAIL" | "ERP"; dealerId?: string }`.
`201` `{ client: PartnerClientView; apiKey: string }`. **The key (`fpk_` + 40 characters) is shown only in this
response**; the server keeps its SHA-256 and the first 12 characters. `422` `validation.required`,
`validation.channel`, `validation.pickDealer`.

**`PATCH /admin/partner-clients/:id`**: body `{ active: boolean }` turns the key on or off. `200`
`PartnerClientView`; `404` for an unknown id.

### 5.6 Files

**`POST /uploads`**: multipart, fields `file` and `name?`. Photos, videos and PDF only (the content must match the
type; SVG is refused), 15 MB by default (`UPLOAD_MAX_BYTES`). `201` `Attachment`. `413` `too_large`, `415`
`unsupported_type`, `422` `validation_error` (no file), `400` `upload_failed`. The frontend refuses HEIC photos before
uploading (they can't be displayed).

**`GET /files/:id`**: the file with its `Content-Type`, `Content-Disposition: inline`. Visible to the uploader,
admins and anyone who can see a record the file is attached to. Bearer or refresh cookie.

### 5.7 Catalog

**`GET /models`**: `ModelView[]`, the Fieldpiece models with category, warranty term and serial and batch formats
(A06 and every model picker).

**`GET /categories`**: `ProductCategory[]`.

**`GET /dealers`**: `DealerView[]` the caller may see (admin: all; distributor: its dealers; dealer: itself).

### 5.8 Warranty claims

One claim per product problem, filed by the customer, the dealer or the warranty desk, and decided by the warranty
desk. Status steps (the only place they are defined is `shared/wms-domain/src/claim-transitions.ts`):

```
SUBMITTED -start_review-> IN_REVIEW -approve-> APPROVED -close-> CLOSED
     └────────────── reject ───────────┴─────── reject -> REJECTED
```

| Action         | From                     | To          | Who   | Needs                                                                                  |
| -------------- | ------------------------ | ----------- | ----- | -------------------------------------------------------------------------------------- |
| `start_review` | `SUBMITTED`              | `IN_REVIEW` | admin |                                                                                        |
| `approve`      | `IN_REVIEW`              | `APPROVED`  | admin | `resolution`; `creditAmount` (> 0, up to 100,000) for `CREDIT`; `note` optional        |
| `reject`       | `SUBMITTED`, `IN_REVIEW` | `REJECTED`  | admin | `reason`                                                                               |
| `close`        | `APPROVED`               | `CLOSED`    | admin | `replacementSerial` for `REPLACE` (`replacementBatchNumber` optional); `note` optional |

**`GET /claims`**: `Paginated<WarrantyClaimView>`. Query: list params, `status?`, `source?`, `issueType?`. `q`
matches claim id, serial, batch number, model code, customer and dealer. Newest first (`-createdAt`). Scoped as in
section 1: customers see claims on their own products.

**`GET /claims/counts`**: `Record<ClaimStatus, number>` for the A09 count tiles (same scoping).

**`GET /claims/:id`**: `WarrantyClaimView` with the product's coverage, evidence (`attachments`) and history.

**`POST /claims`**: `200` `WarrantyClaimView`

- Body: `{ unitSerial: string; issueType: IssueType; description: string; attachmentIds?: string[] }` (up to 20
  attachments, uploaded by the caller).
- `source` comes from the caller's role: customer → `CUSTOMER`, dealer or distributor → `DEALER`, admin → `ADMIN`.
- `coverage` is decided by the server on the day of filing (`GET /units/:serial/coverage`). A claim on a product that
  isn't covered can still be filed; the desk sees the coverage and decides.
- Starts at `SUBMITTED`; adds `claim_filed` to the product history; notifies admins (`claim_submitted`).
- `422` `fieldErrors.issueType = "validation.issueType"`, `fieldErrors.description = "validation.describeFault"`
  (under 10 characters); `409` `not_registered` (`unitSerial: "claims.notRegistered"`); `409` `claim_open` when the
  product already has a `SUBMITTED`, `IN_REVIEW` or `APPROVED` claim (`unitSerial: "claims.alreadyOpen"`); `404`
  for a product outside the caller's scope.

**`POST /claims/:id/transitions`** (admin)

- Body: `{ action: "start_review" | "approve" | "reject" | "close"; resolution?: Resolution; creditAmount?: number;
reason?: string; note?: string; replacementSerial?: string; replacementBatchNumber?: string }`
- `200`: updated `WarrantyClaimView`, with a history event (`text` = the note or reason) and `reviewedByName`.
- `approve` stores `resolution`, `creditAmount` (CREDIT only) and `decisionNote`; notifies the customer, dealer and
  distributor (`claim_approved`).
- `reject` stores `rejectReason`; notifies them (`claim_rejected`).
- `close` settles the claim by its resolution and notifies them (`claim_closed`):
  - `REPAIR`: closes.
  - `REPLACE`: registers `replacementSerial` (same model, dealer, customer and purchase date) with **the rest of the
    original warranty** (start today, end = the original end, or today if that has passed) **[CONFIRM]**; sets
    `replacedBySerial` on the original (its status becomes `EXPIRED`) and `replacesSerial` on the new one; adds
    `replaced` and `registered` history events. `422` `replacementSerial: "validation.required"` or
    `"rowErrors.invalid_serial"` (wrong format for the model, or the same serial);
    `replacementBatchNumber: "rowErrors.invalid_batch"`; `409` `duplicate_serial` when that serial is already
    registered.
  - `CREDIT`: writes an outbound `FINANCE` / `credit_memo` message (claim, serial, model, amount, `"USD"`).
  - Every close adds `claim_closed` to the product history.
- `422` `validation.resolution`, `validation.amount`, `validation.reasonRequired`; `409` `invalid_transition` for an
  action not allowed from the current status, or when someone else moved the claim first.

### 5.9 Integration log (A12)

**`GET /integrations`** (admin): `Paginated<IntegrationMessage>`. Query: list params, `system?`, `direction?`,
`status?`. `q` matches id, type and reference. Newest first.

**`POST /integrations/:id/retry`** (admin): sends a `FAILED` message again; `attempts + 1`. Response: the updated
message. `409` `not_failed` for other messages. Until real systems are connected, outbound messages are recorded as
delivered and a retry always succeeds **[CONFIRM]**.

Messages written by the API:

| System            | Direction | Type                   | When                                                  |
| ----------------- | --------- | ---------------------- | ----------------------------------------------------- |
| `ERP`             | IN        | `erp_invoice`          | ERP sales invoice (simulator)                         |
| `EMAIL`           | IN        | `registration_email`   | Inbound email (`FAILED` when no serial was found)     |
| `PARTNER` / `ERP` | IN        | `partner_registration` | Each partner API call                                 |
| `CRM`             | OUT       | `crm_update`           | Approval of a `WEB`, `EMAIL` or `RETAIL` registration |
| `FINANCE`         | OUT       | `credit_memo`          | Closing a claim with a `CREDIT` resolution            |

### 5.10 Dashboard (A01, DL01, customer home)

**`GET /dashboard/summary`**: `DashboardSummary`, a union by role. Query: `dealerId?` (distributor only: narrows every
number to one of its dealers).

```ts
type DashboardSummary =
  | {
      role: "admin";
      units: number; // every product in the list = active + expiring30 + expired + pending + voided
      active: number;
      expiring30: number;
      expired: number;
      pending: number; // known serials not registered yet
      voided: number;
      openClaims: number; // SUBMITTED + IN_REVIEW + APPROVED
      pendingRegistrations: number; // waiting for review
      registrationsByChannel: {
        channel: "DEALER" | "PORTAL" | "WEB" | "EMAIL" | "ERP" | "API" | "RETAIL";
        count: number;
      }[]; // approved; BULK counts as DEALER
      claimsByStatus: { status: ClaimStatus; count: number }[];
      claimsByCategory: { categoryId: string; categoryName: string; count: number }[]; // all claims
      expiringSoon: {
        serial: string;
        modelName: string;
        customerName?: string;
        dealerName?: string;
        warrantyEnd: IsoDate;
        daysRemaining: number;
      }[]; // first 5 to expire
      recentActivity: (UnitEvent & { serial: string })[]; // latest 8 product events
    }
  | {
      role: "dealer" | "distributor";
      registrationsThisMonth: number;
      pending: number;
      rejected: number;
      openClaims: number;
      dealers: {
        dealerId: string;
        dealerName: string;
        registrationsThisMonth: number;
        pending: number;
        openClaims: number;
      }[]; // DL01 dealer comparison
    }
  | { role: "customer"; units: number; active: number; expiringSoon: number; openClaims: number };
```

### 5.11 Admin (A11)

**`GET /admin/org`** (admin):

```ts
{ distributors: (Distributor & { dealers: Dealer[] })[];   // Distributor and Dealer carry city and state
  directDealers: Dealer[];                                  // dealers without a distributor
  users: (User & { orgName?: string })[] }                  // every account and its login email
```

Partner clients are in section 5.5.

### 5.12 Simulator (A13, demo only)

Mounted only with `DEMO_FEATURES_ENABLED=true` (refused in production). These stand in for systems outside the WMS;
the email and marketplace routes go through the same code as the real email webhook and partner API.

| Endpoint                            | Body | Does                                                                                                                                                                                                                                                  | Response             |
| ----------------------------------- | ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| `POST /simulate/erp-invoice`        | none | A distributor ERP sales invoice with 3 new serials (SC480, SM482V, MG44): 3 `PENDING` registrations, channel `ERP`; inbound `ERP` / `erp_invoice` message; notifies admins (`erp_invoice_received`)                                                   | `RegistrationView[]` |
| `POST /simulate/registration-email` | none | A customer email with a PDF invoice attached, through the email intake: 1 `PENDING` registration, channel `EMAIL`, with the invoice as an attachment; inbound `EMAIL` / `registration_email` message; notifies admins (`registration_email_received`) | `RegistrationView`   |
| `POST /simulate/marketplace-order`  | none | Two online marketplace orders through the partner API as the seeded `RETAIL` partner: registered at once; inbound `PARTNER` / `partner_registration` message. `409` if that partner is missing or switched off                                        | `RegistrationView[]` |
| `POST /simulate/reset`              | none | Replaces all data with the starting data, dated from today                                                                                                                                                                                            | `{ ok: true }`       |

### 5.13 Notifications (header bell)

**`GET /notifications`**: `Notification[]`, the caller's latest 30, newest first.

**`POST /notifications/read`**: body `{ ids?: string[] }` (no ids = all). Response `{ ok: true }`.

Keys the frontend has text for, with their `params`:

| Key                           | Params                                   | Sent to                                           |
| ----------------------------- | ---------------------------------------- | ------------------------------------------------- |
| `registration_submitted`      | `serial`                                 | Admins                                            |
| `registration_approved`       | `serial`                                 | Customer, dealer, distributor (not for bulk rows) |
| `registration_rejected`       | `serial`, `reason`                       | Submitter, customer                               |
| `bulk_processed`              | `file`, `registered`, `errors`, `review` | Uploader                                          |
| `unit_voided`                 | `serial`                                 | Customer, dealer, distributor                     |
| `claim_submitted`             | `id`, `serial`                           | Admins                                            |
| `claim_approved`              | `id`, `resolution`                       | Customer, dealer, distributor                     |
| `claim_rejected`              | `id`, `reason`                           | Customer, dealer, distributor                     |
| `claim_closed`                | `id`, `resolution`                       | Customer, dealer, distributor                     |
| `erp_invoice_received`        | `invoice`, `count`                       | Admins (simulator)                                |
| `registration_email_received` | `serial`                                 | Admins (simulator)                                |

Only signed-in users get notifications; submitters such as `public`, `system` or a partner don't.

### 5.14 Health

**`GET /health/live`**: `{ status: "ok" }`. **`GET /health/ready`**: checks Postgres and Redis; `200` or `503`
`{ status, checks: { db, redis, shuttingDown } }`. Internal network only; not rate-limited, and the gateway shouldn't
expose them.

## 6. Server-side rules the frontend relies on

None of this is frontend logic.

1. **Authentication and sessions.** Short-lived access token in the response body, refresh token in an httpOnly
   cookie, `POST /auth/refresh` that works with the cookie alone, `401` when expired. The demo accounts and
   `GET /auth/demo-accounts` exist only with demo features on. The frontend only shows the "Sign in as" picker when
   it is built with `VITE_DEMO_MODE=true` or runs in development.
2. **Server-side scoping and roles** exactly as in section 1, on every endpoint including files, the PDF and the
   dashboard. Out-of-scope records answer `404`. Only admins change claims.
3. **Product catalog.** Fieldpiece categories and models, each with its warranty term and serial and batch formats.
4. **One product-level warranty.** Each registered product has one warranty, from the purchase date for the model's
   `warrantyMonths` (12: "1 year warranty from date of purchase"). `status` and `daysRemaining` are computed for today
   on every read (`EXPIRING_SOON` at 30 days or fewer; void overrides everything; a replaced product is no longer
   covered). Shared rules: `shared/wms-domain/src/warranty.ts`.
5. **Registration rules** (section 5.3): trusted senders approved at once unless the serial is a duplicate; reviewed
   channels always pending and flagged; customer matching by phone or email on approval; merge of a duplicate into the
   existing product. Shared row rules: `shared/wms-domain/src/registration-rules.ts`.
6. **Bulk import validation (DL02).** Excel and CSV templates; row-by-row checks with the `RowErrorCode` values;
   clean rows registered at once; duplicates to admin review; inline fix and resubmit of only the fixed rows; upload
   history per dealer.
7. **Registration hub.** Public form with honeypot and per-IP limit; partner API with per-partner keys (stored as
   SHA-256 hashes); email intake through the mail provider's webhook with a shared secret.
8. **Warranty certificate PDF** per product (`/units/:serial/certificate.pdf`), readable on a phone.
9. **QR label data.** The frontend draws the QR code itself. It encodes
   `<app origin>/register?serial=<serial>&model=<model code>&batch=<batch>`, and CU01 reads those parameters. The
   backend keeps "known but not registered" products (`status: PENDING`, no warranty dates) so a label can exist
   before registration, and CU01's registration accepts that serial.
10. **Coverage.** Decided by the backend for a product on a given day (`coverageFor` in
    `shared/wms-domain/src/warranty.ts`); returned by `/units/:serial/coverage` and stored on the claim.
11. **Void warranty** with reason, note, user and date, shown to every role that can see the product, and a history
    event.
12. **Warranty claim steps** as in section 5.8, including the replacement product and the Finance credit memo on
    close. One open claim per product.
13. **Integration log.** Every message in and out stored with system, direction, type, status, attempts, last error,
    reference and payload; retry for failed messages.
14. **Notifications** per user for the events in section 5.13, with a link to the record, and mark-as-read.
15. **Dashboards.** The admin summary (cards that add up to the products list, channel, claim status and category
    counts, expiring-soon list, recent activity) and the dealer / distributor summary with per-dealer comparison and
    the distributor's dealer filter.
16. **Organization (A11).** Distributor → dealer hierarchy and user accounts linked to a dealer, distributor or
    customer. Access follows from the hierarchy.
17. **Files.** Upload (photos, videos, PDF; 15 MB), scoped download that also accepts the refresh cookie.

## 7. Calls not served by the API

The frontend still contains code from screens that are out of scope and not routed. These calls are never made by the
routed screens and the API doesn't serve them. Listed so nobody builds them by mistake:

| Call                                                                 | From                                                                                                                         |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `GET /admin/users`, `GET /admin/policies`, `GET/PUT /admin/settings` | Legacy admin screens                                                                                                         |
| `GET /customers`, `GET /customers/:id`                               | Legacy customers screen                                                                                                      |
| `GET /reports/claims-over-time`                                      | Legacy reports screen                                                                                                        |
| `POST /auth/forgot-password`                                         | Forgot-password page. Hidden in the demo build (`VITE_SHOW_FORGOT_PASSWORD=false`); needs building if password reset is kept |

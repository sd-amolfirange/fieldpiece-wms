# API contract: what the frontend expects from the backend

This document lists every endpoint the demo frontend calls, as implemented today by the mock API in
`backend/demo-server/`. The real backend must provide the same endpoints, shapes and rules, or the frontend has to
change with it. It describes the current behaviour only; nothing here changes backend code.

- Source of truth for the shapes: `shared/wms-domain/src/types.ts` and `views.ts` (package `@wms/domain`). The field
  lists below are copied from there.
- Source of truth for the routes: `backend/demo-server/src/core/api.ts` (JSON routes) and
  `backend/demo-server/src/app.ts` (multipart uploads, file downloads, the PDF, and two simulator routes).
- Frontend callers: `frontend/src/features/*/api.ts`. Pages never call the API directly.

## 1. Conventions

### Base path and format

- Every path below is relative to `/api` (frontend setting `VITE_API_BASE_URL=/api`).
- JSON in and out, except where a section says multipart or binary.
- Dates are `yyyy-MM-dd` strings (`IsoDate`). Timestamps are ISO 8601 strings (`IsoDateTime`).
- Money is a whole number in the user's currency (`SessionUser.currency`, `"INR"` in the demo).

### Authentication

| Item          | Rule                                                                                                                                                                   |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Access token  | Returned in the body of `POST /auth/login` and `POST /auth/refresh`. The frontend keeps it in memory only and sends `Authorization: Bearer <token>`.                   |
| Refresh token | httpOnly cookie `wms_refresh`, `SameSite=Lax`, `Path=/api`, `Secure` on HTTPS. Set by login, cleared by logout.                                                        |
| Expiry        | Any call can answer `401`. The frontend then calls `POST /auth/refresh` once (single-flight) and retries. If refresh answers `401`, it signs the user out.             |
| File links    | `GET /files/:id` and `GET /units/:serial/certificate.pdf` must also accept the refresh cookie, because `<img>`, `<object>` and plain links can't send a Bearer header. |

### Errors

Every error has the same body:

```json
{
  "code": "validation_error",
  "message": "Check the highlighted fields.",
  "fieldErrors": { "purchaseDate": "validation.date" }
}
```

| Field         | Type                     | Notes                                                                                                                                       |
| ------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `code`        | string                   | Machine code, e.g. `unauthenticated`, `forbidden`, `not_found`, `validation_error`, `duplicate_serial`, `invalid_transition`, `not_failed`. |
| `message`     | string                   | Plain-language sentence. The frontend shows it in a toast.                                                                                  |
| `fieldErrors` | `Record<string, string>` | Optional. Values are i18n keys (e.g. `validation.describeFault`, `rowErrors.future_date`); the frontend puts each under its form field.     |

Status codes used: `200`, `201` (uploads and bulk imports), `204` (logout), `401` unauthenticated, `403` wrong role,
`404` not found **or not visible to this user** (scoping never reveals that a record exists), `409` state conflict,
`413` file too large, `415` unsupported file type, `422` validation.

### Lists

Paged list endpoints take `page` (from 1), `pageSize` (default 25, maximum 100), `sort` (`"field"` ascending,
`"-field"` descending, any field of the returned row) and `q` (free-text search), plus the filters listed per endpoint.
They return:

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

| Role        | Units, registrations, complaints, bulk imports                       | Claims                   | Admin data (org, integrations, simulator) |
| ----------- | -------------------------------------------------------------------- | ------------------------ | ----------------------------------------- |
| admin       | Everything                                                           | Everything               | Yes                                       |
| distributor | Rows whose `dealerId` is one of its dealers (`Dealer.distributorId`) | Same rows, **read-only** | No (`403`)                                |
| dealer      | Rows whose `dealerId` is its own                                     | Same rows, **read-only** | No (`403`)                                |
| customer    | Rows whose `customerId` is its own                                   | Never (`403`)            | No (`403`)                                |

A record outside the user's scope answers `404`, not `403`.

## 2. Enums

| Name                   | Values                                                                                                                |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `Role`                 | `admin`, `dealer`, `distributor`, `customer`                                                                          |
| `WarrantyStatus`       | `ACTIVE`, `EXPIRING_SOON` (30 days or fewer left), `EXPIRED`, `VOID`, `PENDING` (known unit, not registered yet)      |
| `PartType`             | `UNIT`, `COMPRESSOR`, `PCB`                                                                                           |
| `VoidReason`           | `UNAUTHORISED_REPAIR`, `MISSED_SERVICING`, `PHYSICAL_DAMAGE`, `OTHER`                                                 |
| `UnitEventType`        | `registered`, `part_replaced`, `voided`, `complaint_raised`, `claim_created`, `note`                                  |
| `RegistrationChannel`  | `DEALER`, `PORTAL`, `EMAIL`, `ERP`, `BULK`                                                                            |
| `RegistrationStatus`   | `PENDING`, `APPROVED`, `REJECTED`                                                                                     |
| `RegistrationFlag`     | `EXCEPTION`, `DUPLICATE`, `MODEL_MISMATCH`                                                                            |
| `BulkRowStatus`        | `REGISTERED`, `FIXED`, `ERROR`, `REVIEW`                                                                              |
| `RowErrorCode`         | `required`, `invalid_serial`, `unknown_model`, `duplicate_serial`, `duplicate_in_file`, `invalid_date`, `future_date` |
| `ComplaintSource`      | `CUSTOMER`, `DEALER`, `ADMIN`                                                                                         |
| `ComplaintStatus`      | `NEW`, `WITH_SERVICE`, `RESOLVED`                                                                                     |
| `Coverage`             | `COVERED`, `CHARGEABLE`                                                                                               |
| `EntitlementReason`    | `VOID`, `NOT_REGISTERED`, `NOTHING_ACTIVE`, `PARTIAL`, `FULL`                                                         |
| `ClaimStatus`          | `DRAFT`, `SUBMITTED`, `APPROVED`, `PAID`, `REJECTED`                                                                  |
| `FinancePostingStatus` | `NOT_POSTED`, `POSTED`, `FAILED`                                                                                      |
| `IntegrationSystem`    | `CRM`, `ERP`, `FINANCE`, `SERVICE`, `OEM`, `EMAIL`                                                                    |
| `IntegrationDirection` | `IN`, `OUT`                                                                                                           |
| `IntegrationStatus`    | `PENDING`, `SUCCESS`, `FAILED`                                                                                        |

Integration message `type` values the frontend has labels for: `service_request`, `job_result`, `claim_submission`,
`oem_decision`, `finance_posting`, `erp_invoice`, `crm_update`, `registration_email`. Other values are shown as-is.

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
  currency: string; // e.g. "INR"
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

interface UnitPartView {
  id: string;
  partType: PartType;
  serial?: string;
  warrantyStart: IsoDate;
  warrantyEnd: IsoDate;
  coversParts: boolean;
  coversLabour: boolean;
  replacedAt?: IsoDate;
  replacedBySerial?: string;
  replacesSerial?: string;
  status: WarrantyStatus; // computed for today
  daysRemaining: number; // computed for today, 0 when expired
}

interface UnitView {
  serial: string;
  modelId: string;
  brandId: string;
  dealerId?: string;
  customerId?: string;
  location?: string;
  installDate?: IsoDate;
  purchaseDate?: IsoDate;
  void?: { reason: VoidReason; note?: string; by: string; byName: string; at: IsoDateTime };
  registrationId?: string;
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
  capacity: string;
  unitType: string;
  brandName: string;
  dealerName?: string;
  customerName?: string;
  status: WarrantyStatus; // overall = the unit part's status (VOID when voided, PENDING when parts is empty)
  daysRemaining: number;
  parts: UnitPartView[]; // empty until registered
}

interface RegistrationView {
  id: string;
  channel: RegistrationChannel;
  status: RegistrationStatus;
  flags: RegistrationFlag[];
  serial: string;
  modelCode: string;
  customer: { name: string; phone?: string; email?: string; city?: string };
  customerId?: string;
  dealerId?: string;
  installDate?: IsoDate;
  purchaseDate?: IsoDate;
  invoiceNumber?: string;
  location?: string;
  attachmentIds: string[];
  submittedBy: string;
  submittedByName: string;
  submittedAt: IsoDateTime;
  duplicateOfSerial?: string;
  rejectReason?: string;
  reviewedByName?: string;
  reviewedAt?: IsoDateTime;
  batchId?: string;
  dealerName?: string;
  duplicateOf?: UnitView; // the existing unit, for the A03 comparison
}

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
    values: {
      serial?: string;
      modelCode?: string;
      installDate?: string;
      customerName?: string;
      customerPhone?: string;
      customerEmail?: string;
      city?: string;
      invoiceNumber?: string;
    };
    errors: Partial<
      Record<"serial" | "modelCode" | "installDate" | "customerName" | "customerPhone", RowErrorCode>
    >;
    status: BulkRowStatus;
    registrationId?: string;
  }[];
  dealerName?: string;
  counts: { total: number; registered: number; errors: number; review: number };
}

interface Entitlement {
  parts: Coverage;
  labour: Coverage;
  coveredPartTypes: PartType[];
  claimable: boolean; // false for void units and when nothing is covered: no claim will be raised
  reason: EntitlementReason;
}

interface JobResultView {
  id: string;
  complaintId: string;
  technician: string;
  completedAt: IsoDateTime;
  partsReplaced: { partType: PartType; oldSerial?: string; newSerial: string; newWarrantyEnd?: IsoDate }[];
  photoIds: string[];
  photos: Attachment[];
  signOffName: string;
  notes?: string;
}

interface ComplaintView {
  id: string;
  unitSerial: string;
  source: ComplaintSource;
  raisedBy: string;
  raisedByName: string;
  dealerId?: string;
  customerId?: string;
  description: string;
  attachmentIds: string[];
  status: ComplaintStatus;
  entitlement: Entitlement; // decided when raised; re-checked if the unit is voided later
  serviceRequestId?: string;
  jobResultId?: string;
  claimId?: string;
  createdAt: IsoDateTime;
  history: { at: IsoDateTime; status: ComplaintStatus; byName: string; text?: string }[];
  modelCode: string;
  modelName: string;
  brandName: string;
  dealerName?: string;
  customerName?: string;
  attachments: Attachment[];
  jobResult?: JobResultView;
  claimStatus?: ClaimStatus;
}

interface ClaimView {
  id: string;
  complaintId?: string;
  unitSerial: string;
  brandId: string;
  dealerId?: string;
  status: ClaimStatus;
  rmaNumber?: string;
  amount?: number;
  jobResultId?: string;
  photoIds: string[];
  partsReplaced: { partType: PartType; oldSerial?: string; newSerial: string }[];
  financePosting: FinancePostingStatus;
  rejectReason?: string;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  history: { at: IsoDateTime; status: ClaimStatus; byName: string; text?: string }[];
  brandName: string;
  dealerName?: string;
  modelCode: string;
  customerName?: string;
  complaintDescription?: string;
  jobResult?: JobResultView;
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
  key: string; // i18n key under "notifications." in the frontend (list in section 5.12)
  params?: Record<string, string | number>;
  link?: string; // frontend route opened on click
  createdAt: IsoDateTime;
  read: boolean;
}

interface ModelView {
  id: string;
  code: string;
  brandId: string;
  brandName: string;
  name: string;
  capacity: string;
  type: string;
  parts: {
    partType: PartType;
    warrantyMonths: number;
    coversParts: boolean;
    coversLabour: boolean;
    serialised: boolean;
  }[];
}
interface Brand {
  id: string;
  name: string;
}
interface DealerView {
  id: string;
  name: string;
  city: string;
  distributorId?: string;
  distributorName?: string;
}
```

## 4. Endpoint summary

| Feature       | Method and path                                  | Roles                      | Screens                     |
| ------------- | ------------------------------------------------ | -------------------------- | --------------------------- |
| Auth          | `GET /auth/demo-accounts`                        | Public (demo only)         | Sign-in                     |
|               | `POST /auth/login`                               | Public                     | Sign-in                     |
|               | `POST /auth/refresh`                             | Refresh cookie             | All                         |
|               | `POST /auth/logout`                              | Any                        | Account menu                |
| Units         | `GET /units`                                     | All                        | A04, DL04, CU02, CU04, DL06 |
|               | `GET /units/:serial`                             | All                        | A05, DL05, CU03             |
|               | `GET /units/:serial/certificate.pdf`             | All                        | A05, DL05, CU03             |
|               | `GET /units/:serial/entitlement`                 | All                        | CU04, DL06                  |
|               | `POST /units/:serial/void`                       | admin                      | A05                         |
| Registrations | `GET /registrations`                             | All                        | A02, CU02                   |
|               | `GET /registrations/:id`                         | All                        | A03                         |
|               | `POST /registrations`                            | All                        | CU01, DL03                  |
|               | `POST /registrations/:id/approve`                | admin                      | A03                         |
|               | `POST /registrations/:id/reject`                 | admin                      | A03                         |
|               | `POST /registrations/:id/merge`                  | admin                      | A03                         |
|               | `POST /registrations/bulk-approve`               | admin                      | A02                         |
| Bulk import   | `GET /bulk-imports/template.csv`, `.xlsx`        | Any signed-in              | DL02                        |
|               | `POST /bulk-imports` (multipart)                 | admin, dealer, distributor | DL02                        |
|               | `GET /bulk-imports`                              | admin, dealer, distributor | DL02                        |
|               | `GET /bulk-imports/:id`                          | admin, dealer, distributor | DL02                        |
|               | `PUT /bulk-imports/:id/rows`                     | admin, dealer, distributor | DL02                        |
| Files         | `POST /uploads` (multipart)                      | All                        | CU01, DL03, CU04, DL06      |
|               | `GET /files/:id`                                 | All (scoped)               | A03, A08, CU05              |
| Catalog       | `GET /models`, `GET /brands`                     | All                        | A06, forms, A09 filter      |
|               | `GET /dealers`                                   | admin, dealer, distributor | Filters, DL03, DL01         |
| Complaints    | `GET /complaints`                                | All                        | A07, DL07, CU05 list        |
|               | `GET /complaints/:id`                            | All                        | A08, DL07, CU05             |
|               | `POST /complaints`                               | All                        | CU04, DL06                  |
|               | `POST /complaints/:id/send-to-service`           | admin                      | A08                         |
| Claims        | `GET /claims`, `GET /claims/counts`              | admin, dealer, distributor | A09, DL07                   |
|               | `GET /claims/:id`                                | admin, dealer, distributor | A10                         |
|               | `POST /claims/:id/transitions`                   | admin                      | A10                         |
| Integrations  | `GET /integrations`                              | admin                      | A12, A13                    |
|               | `POST /integrations/:id/retry`                   | admin                      | A12                         |
| Dashboard     | `GET /dashboard/summary`                         | admin, dealer, distributor | A01, DL01                   |
| Notifications | `GET /notifications`, `POST /notifications/read` | All                        | Header bell                 |
| Admin         | `GET /admin/org`                                 | admin                      | A11                         |
| Simulator     | `POST /simulate/*` (5 routes)                    | admin                      | A13 (demo only)             |

## 5. Endpoints by feature

### 5.1 Auth

**`GET /auth/demo-accounts`**: demo only. Response `{ email, label, password }[]` to fill the sign-in picker. **Must
not exist in production** (section 6).

**`POST /auth/login`**

- Body: `{ email: string; password: string }`
- `200`: `{ accessToken: string; user: SessionUser }` and sets the `wms_refresh` cookie.
- `401` `invalid_credentials` on a wrong email or password.

**`POST /auth/refresh`**: no body; reads the cookie. `200` `{ accessToken; user: SessionUser }`; `401` when the
session is gone.

**`POST /auth/logout`**: ends both tokens, clears the cookie, `204`.

### 5.2 Units

**`GET /units`**: `Paginated<UnitView>`

- Query: list params; `status?: WarrantyStatus`; `dealerId?` (admin and distributor filters; a distributor can only
  pass its own dealers). `q` matches serial, customer name, dealer name and model code. Default sort `serial`.
- Scoped as in section 1. The CU04 / DL06 unit pickers call it with `pageSize=100&sort=serial` and hide `PENDING`
  units.

**`GET /units/:serial`**: `UnitView`, with part-wise `status` and `daysRemaining` computed for today. `404` if not
visible.

**`GET /units/:serial/certificate.pdf`**: `application/pdf` download (`warranty-<serial>.pdf`) with the unit, owner,
dealer and one line per part (start, end, cover). Bearer or refresh cookie.

**`GET /units/:serial/entitlement`**: `Entitlement` a complaint on this unit would get today (shown before
submitting on CU04 / DL06). Same result for every role that can see the unit.

**`POST /units/:serial/void`** (admin)

- Body: `{ reason: VoidReason; note?: string }`
- `200`: updated `UnitView` with `void` set (`by`, `byName`, `at` from the signed-in admin and now), every part
  `status: "VOID"`, and a `voided` history event with `reason` and `text = note`.
- Notifies the unit's customer, dealer and distributor (`unit_voided`).
- `422` `fieldErrors.reason = "validation.voidReason"`; `409` `already_void`; `409` `not_registered`.

### 5.3 Registrations

**`GET /registrations`**: `Paginated<RegistrationView>`

- Query: list params; `status?`, `channel?`, `flag?`. `q` matches serial, customer and dealer. Newest first by default.
- Customers get only their own (CU02 shows their `PENDING` ones).

**`GET /registrations/:id`**: `RegistrationView` including `duplicateOf` when the serial is already registered.

**`POST /registrations`**: `RegistrationView`

- Body: `{ serial, modelCode, installDate?, purchaseDate?, customerName?, customerPhone?, customerEmail?, city?,
invoiceNumber?, location?, dealerId?, attachmentIds?: string[] }`
- **Customer (CU01, channel `PORTAL`)**: needs `serial`, `modelCode`, `purchaseDate` (not in the future) and at least
  one attachment (`validation.invoiceRequired`). Always `PENDING`. Flags: `EXCEPTION` when the serial is unknown;
  `DUPLICATE` + `EXCEPTION` when already registered; `MODEL_MISMATCH` when the model differs from stock. Admins are
  notified (`registration_submitted`).
- **Dealer, distributor or admin (DL03, channel `DEALER`)**: row rules as in bulk import. A clean registration is
  **approved at once** (the unit gets its parts from the model template). A duplicate serial goes to admin review
  (`PENDING`, `DUPLICATE` + `EXCEPTION`). Other problems answer `422` with `fieldErrors` as `rowErrors.<code>`. A
  dealer's registrations use its own dealer; a distributor or admin must pass `dealerId`
  (`validation.pickDealer`).

**`POST /registrations/:id/approve`** (admin): creates or completes the unit, attaches the model's parts (warranty
starts on the install date, else the purchase date, else today), sets `customerId` (matched by phone or email, else a
new customer), notifies customer, dealer and distributor (`registration_approved`). **An `EMAIL` registration also
writes an outbound `CRM` / `crm_update` integration message.** `409` `duplicate_serial` for duplicates, `409`
`not_pending`, `409` `unknown_model`.

**`POST /registrations/:id/reject`** (admin): body `{ reason: string }` (required, `validation.reasonRequired`).
Notifies the submitter and customer (`registration_rejected`).

**`POST /registrations/:id/merge`** (admin): for a duplicate; adds this registration's attachments to the existing unit
and marks the registration `APPROVED`. `409` `nothing_to_merge`.

**`POST /registrations/bulk-approve`** (admin): body `{ ids: string[] }`, response `{ approved: number; skipped:
number }`. Skips duplicates, decided rows and unknown models.

### 5.4 Bulk import (DL02)

**`GET /bulk-imports/template.csv`** and **`template.xlsx`**: the template files, with the columns Serial number,
Model code, Customer name, Customer phone, Customer email, City, Install date, Invoice number (email and invoice number
optional).

**`POST /bulk-imports`**: multipart, fields `file` (`.xlsx` or `.csv`, 5 MB max), `name?` (file name), `dealerId?`
(distributor or admin). `201` `BulkImportView`. Every row is checked:

| Rule                                                                                             | Result for that row                              |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------ |
| Serial, model and install date present and valid                                                 | `REGISTERED` (unit registered at once)           |
| Serial already registered                                                                        | `REVIEW`: a `PENDING` registration for the admin |
| Missing value, bad serial format, unknown model, bad or future date, serial repeated in the file | `ERROR` with `errors[field] = RowErrorCode`      |

`415` `unsupported_type` for other files; `413` over 5 MB. Notifies the uploader (`bulk_processed`).

**`GET /bulk-imports`**: `BulkImportView[]`, the caller's upload history, newest first.

**`GET /bulk-imports/:id`**: `BulkImportView`.

**`PUT /bulk-imports/:id/rows`**: body `{ rows: { rowNumber: number; values: RegistrationRowInput }[] }` with the
fixed rows only. They are checked again; fixed rows become `FIXED` and are registered. Response: the updated
`BulkImportView`.

### 5.5 Files

**`POST /uploads`**: multipart, fields `file` and `name?`. Images, videos and PDF only, 15 MB max. `201`
`Attachment`. `413` `too_large`, `422` `validation_error` (no file), `415` `unsupported_type` for other types. The frontend refuses HEIC photos
before uploading (they can't be displayed).

**`GET /files/:id`**: the file with its `Content-Type`, `Content-Disposition: inline`. Visible to the uploader, admins
and anyone who can see the record the file is attached to. Bearer or refresh cookie.

### 5.6 Catalog

**`GET /models`**: `ModelView[]`, each with its part template (A06 and every model picker).

**`GET /brands`**: `Brand[]`.

**`GET /dealers`**: `DealerView[]` the caller may see (admin: all; distributor: its dealers; dealer: itself).

### 5.7 Complaints

**`GET /complaints`**: `Paginated<ComplaintView>`. Query: list params, `status?`, `source?`. `q` matches id, serial,
customer and dealer. Newest first by default.

**`GET /complaints/:id`**: `ComplaintView`.

**`POST /complaints`**

- Body: `{ unitSerial: string; description: string; attachmentIds?: string[] }`
- `source` comes from the caller's role: customer → `CUSTOMER`, dealer or distributor → `DEALER`, admin → `ADMIN`.
- `entitlement` is decided by the server when the complaint is raised.
- Adds `complaint_raised` to the unit history; notifies admins (`complaint_raised`).
- `422` `fieldErrors.description = "validation.describeFault"` (under 5 characters); `409` `not_registered`
  (`complaints.notRegistered`); `404` for a unit outside the caller's scope.

**`POST /complaints/:id/send-to-service`** (admin): `NEW` → `WITH_SERVICE`, sets `serviceRequestId`, writes an
outbound `SERVICE` / `service_request` message whose payload has the unit (serial, model, location), the part serials,
the customer and the entitlement. Re-checks the entitlement if the unit was voided after the complaint was raised.
Notifies customer, dealer and distributor (`complaint_with_service`). `409` if not `NEW`.

### 5.8 Claims

Claim status steps (the only place they are defined is `shared/wms-domain/src/claim-transitions.ts`):

| Action      | From        | To          | Who                        | Needs                              |
| ----------- | ----------- | ----------- | -------------------------- | ---------------------------------- |
| `submit`    | `DRAFT`     | `SUBMITTED` | admin                      | `amount` > 0; `rmaNumber` optional |
| `approve`   | `SUBMITTED` | `APPROVED`  | admin, or the OEM (system) |                                    |
| `reject`    | `SUBMITTED` | `REJECTED`  | admin, or the OEM (system) | `reason`                           |
| `mark_paid` | `APPROVED`  | `PAID`      | admin                      |                                    |

**`GET /claims`**: `Paginated<ClaimView>`. Query: list params, `status?`, `brandId?`. `q` matches id, serial, RMA
number and brand. Newest first. Dealers and distributors get their own claims, read-only; customers get `403`.

**`GET /claims/counts`**: `Record<ClaimStatus, number>` for the A09 count tiles (same scoping).

**`GET /claims/:id`**: `ClaimView` with `jobResult` (the evidence).

**`POST /claims/:id/transitions`** (admin)

- Body: `{ action: "submit" | "approve" | "reject" | "mark_paid"; rmaNumber?: string; amount?: number; reason?: string }`
- `200`: updated `ClaimView`, with a history event.
- `submit` writes an outbound `OEM` / `claim_submission` message (RMA number, amount, evidence).
- `mark_paid` sets `financePosting: "POSTED"` and writes an outbound `FINANCE` / `finance_posting` message.
- `422` `validation.amount` or `validation.reasonRequired`; `409` `invalid_transition`.

### 5.9 Integration log (A12)

**`GET /integrations`** (admin): `Paginated<IntegrationMessage>`. Query: list params, `system?`, `direction?`,
`status?`. Newest first.

**`POST /integrations/:id/retry`** (admin): sends a `FAILED` message again; `attempts + 1`. Response: the updated
message. `409` `not_failed` for other messages. In the mock a retry always succeeds.

### 5.10 Dashboard (A01, DL01)

**`GET /dashboard/summary`**: `DashboardSummary`, a union by role. Query: `dealerId?` (distributor only: narrows every
number to one of its dealers).

```ts
type DashboardSummary =
  | {
      role: "admin";
      units: number; // every unit in the Units list = active + expiring30 + expired + pending + voided
      active: number;
      expiring30: number;
      expired: number;
      pending: number;
      voided: number;
      openClaims: number; // DRAFT + SUBMITTED + APPROVED
      registrationsByChannel: { channel: "DEALER" | "PORTAL" | "EMAIL" | "ERP"; count: number }[]; // approved; BULK counts as DEALER
      claimsByBrand: { brandId: string; brandName: string; count: number }[];
      expiringSoon: {
        serial: string;
        modelName: string;
        customerName?: string;
        dealerName?: string;
        warrantyEnd: IsoDate;
        daysRemaining: number;
      }[]; // first 5 to expire
      recentActivity: (UnitEvent & { serial: string })[]; // latest 8 unit events
    }
  | {
      role: "dealer" | "distributor";
      registrationsThisMonth: number;
      pending: number;
      rejected: number;
      openComplaints: number;
      claimsInProgress: number;
      dealers: {
        dealerId: string;
        dealerName: string;
        registrationsThisMonth: number;
        pending: number;
        openComplaints: number;
      }[]; // DL01 dealer comparison
    }
  | { role: "customer"; units: number; active: number; expiringSoon: number; openComplaints: number };
```

### 5.11 Admin (A11)

**`GET /admin/org`** (admin):

```ts
{ distributors: (Distributor & { dealers: Dealer[] })[];
  directDealers: Dealer[];                               // dealers without a distributor
  users: (User & { orgName?: string })[] }               // every account and its login email
```

### 5.12 Notifications (header bell)

**`GET /notifications`**: `Notification[]`, the caller's latest 30, newest first.

**`POST /notifications/read`**: body `{ ids?: string[] }` (no ids = all). Response `{ ok: true }`.

Keys the frontend has text for, with their `params`:

| Key                           | Params                                                          | Sent to                       |
| ----------------------------- | --------------------------------------------------------------- | ----------------------------- |
| `registration_submitted`      | `serial`                                                        | Admins                        |
| `registration_approved`       | `serial`                                                        | Customer, dealer, distributor |
| `registration_rejected`       | `serial`, `reason`                                              | Submitter, customer           |
| `bulk_processed`              | `file`, `registered`, `errors`, `review`                        | Uploader                      |
| `complaint_raised`            | `id`, `serial`                                                  | Admins                        |
| `complaint_with_service`      | `id`                                                            | Customer, dealer, distributor |
| `complaint_resolved`          | `id`, `part`, `date` (new part's warranty end; not shown today) | Customer, dealer, distributor |
| `claim_draft_created`         | `id`, `serial`                                                  | Admins                        |
| `claim_approved_by_oem`       | `id`                                                            | Admins                        |
| `claim_rejected_by_oem`       | `id`                                                            | Admins                        |
| `unit_voided`                 | `serial`                                                        | Customer, dealer, distributor |
| `erp_invoice_received`        | `invoice`, `count`                                              | Admins                        |
| `registration_email_received` | `serial`                                                        | Admins                        |

### 5.13 Simulator (A13, demo only)

These stand in for systems outside the WMS. The real backend replaces each with a real integration (section 6); the
frontend's A13 screen is removed or hidden in production.

| Endpoint                            | Body                                                                       | Does                                                                                                                                                                     | Response             |
| ----------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------- |
| `POST /simulate/erp-invoice`        | none                                                                       | One ERP sales invoice with 3 new serials: 3 `PENDING` registrations, channel `ERP`; inbound `ERP` / `erp_invoice` message                                                | `RegistrationView[]` |
| `POST /simulate/registration-email` | none                                                                       | A customer email with the invoice attached: 1 `PENDING` registration, channel `EMAIL`, with the invoice as an attachment; inbound `EMAIL` / `registration_email` message | `RegistrationView`   |
| `POST /simulate/job-result`         | `{ complaintId: string; partType?: "COMPRESSOR" \| "PCB" }`                | The service system's job result for a `WITH_SERVICE` complaint (see "Job result" in section 6)                                                                           | `ComplaintView`      |
| `POST /simulate/oem-decision`       | `{ claimId: string; decision: "APPROVED" \| "REJECTED"; reason?: string }` | The manufacturer's decision on a `SUBMITTED` claim; inbound `OEM` / `oem_decision` message                                                                               | `ClaimView`          |
| `POST /simulate/reset`              | none                                                                       | Replaces all data with the seed, dated from today                                                                                                                        | `{ ok: true }`       |

## 6. Must exist in the real backend

Everything below is done by the mock today and the frontend depends on it. None of it is frontend logic.

1. **Authentication and sessions.** Short-lived access token in the response body, refresh token in an httpOnly cookie,
   `POST /auth/refresh` that works with the cookie alone, `401` when expired. Replace the demo accounts: **remove
   `GET /auth/demo-accounts`** and the shared demo password. The frontend only shows the "Sign in as" picker when
   it is built with `VITE_DEMO_MODE=true` (the demo build) or runs in development; a production build shows plain
   email and password.
2. **Server-side scoping and roles** exactly as in section 1, on every endpoint including files, the PDF and the
   dashboard. Out-of-scope records answer `404`. Dealers and distributors may read claims but never change them.
3. **Part-wise warranty computation.** Each unit has one part per model template line (unit, compressor, PCB…), each
   with its own start, end, cover (parts / labour) and serial. `status` and `daysRemaining` are computed for today on
   every read (`EXPIRING_SOON` at 30 days or fewer). The shared rules are in `shared/wms-domain/src/warranty.ts`.
4. **Model templates (A06).** Parts, warranty months and cover per model. Registration copies them onto the unit.
5. **Registration rules.** Channel by source; customer registrations always pending; dealer registrations approved at
   once unless the serial is a duplicate; duplicate, unknown-serial and model-mismatch flags; customer matching by
   phone or email on approval; merge of a duplicate into the existing unit.
6. **Bulk import validation (DL02).** Excel and CSV templates; row-by-row checks with the `RowErrorCode` values;
   clean rows registered at once; duplicates to admin review; inline fix and resubmit of only the fixed rows; upload
   history per dealer. Shared row rules: `shared/wms-domain/src/registration-rules.ts`.
7. **Warranty certificate PDF** per unit (`/units/:serial/certificate.pdf`), readable on a phone.
8. **QR label data.** The frontend draws the QR code itself. It encodes
   `<app origin>/register?serial=<serial>&model=<model code>`, and CU01 reads those two parameters. The backend must
   keep "known but not registered" units (`status: PENDING`, empty `parts`) so a label can exist before registration,
   and CU01's registration must accept that serial.
9. **Entitlement.** Decided by the backend for a unit on a given day. While the unit's own (UNIT) warranty is active
   it covers every part, and labour if its template line covers labour. After that, a part is covered while its own
   warranty is active and covers parts; labour follows the UNIT part only. A void or unregistered unit is fully
   chargeable. `claimable` is true when anything is covered. Returned by `/units/:serial/entitlement` (preview) and stored on the complaint; re-checked when
   the unit is voided later. Shared rule: `entitlementFor` in `shared/wms-domain/src/entitlement.ts`.
10. **Void warranty** with reason, note, user and date, shown to every role that can see the unit, and a history event.
11. **Complaint to service hand-off.** Outbound service request with unit, part serials and entitlement; complaint
    `NEW` → `WITH_SERVICE`.
12. **Job result from the service system, and the auto Draft claim.** When a job result arrives: record technician,
    completion time, parts replaced (old and new serials), photos and customer sign-off; replace each part on the unit
    so **the new part's warranty starts that day** (its period from the model template); add a `part_replaced` history
    event; mark the complaint `RESOLVED`; and, **only if the complaint is claimable (and the unit isn't void), create a
    `DRAFT` claim for the unit's brand** with the job result as evidence (parts, serials, photos), add
    `claim_created` to the unit history, and notify admins.
13. **Claim status steps** as in section 5.8, including the outbound OEM submission, the OEM decision coming back in,
    and the Finance posting on `mark_paid` (`financePosting` status on the claim).
14. **Integration log.** Every message in and out (CRM, ERP, Finance, service system, OEM, email) stored with system,
    direction, type, status, attempts, last error, reference and payload; retry for failed messages. In particular:
    ERP sales invoices and registration emails create `ERP` and `EMAIL` registrations in the same inbox, and approving
    an emailed registration sends a CRM customer update.
15. **Notifications** per user for the events in section 5.12, with a link to the record, and mark-as-read.
16. **Dashboards.** The admin summary (cards that add up to the Units list, channel and brand counts, expiring-soon
    list, recent activity) and the dealer / distributor summary with per-dealer comparison and the distributor's dealer
    filter.
17. **Organisation (A11).** Distributor → dealer hierarchy and user accounts linked to a dealer, distributor or
    customer. Access follows from the hierarchy.
18. **Files.** Upload (images, videos, PDF; 15 MB), scoped download that also accepts the refresh cookie.

## 7. Calls not used by the demo screens

The frontend still contains code from screens that are out of scope and not routed. These calls are never made in the
demo and the mock doesn't serve them. Listed so nobody builds them by mistake:

| Call                                                                     | From                                                                                     |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| `GET /admin/users`, `GET /admin/policies`, `GET/PUT /admin/settings`     | Legacy admin screens                                                                     |
| `GET /customers`, `GET /customers/:id`                                   | Legacy customers screen                                                                  |
| `GET /reports/claims-over-time`                                          | Legacy reports screen                                                                    |
| `GET /rma`, `GET /rma/:id`, `PATCH /rma/:id`, `POST /rma/:id/inspection` | Legacy RMA screens                                                                       |
| `POST /auth/forgot-password`                                             | Forgot-password page (routed, but the mock has no endpoint; see the verification report) |

# Demo verification report

What was checked before hand-over, how, and what is left for a person to check on the day. Scope and wording follow
`docs/demo-workflows.md`. The demo is supported on **Google Chrome only**; every check below ran in Chrome/Chromium.

## 1. Summary

| Check                                                              | Result                                             |
| ------------------------------------------------------------------ | -------------------------------------------------- |
| All 7 workflows, 47 steps, in the demo running order after a reset | **47 / 47 Pass**                                   |
| Every screen's "must contain" list (25 screens, 65 items)          | **65 / 65 Present**                                |
| Playwright specs (Chromium): W1–W7, screens, accessibility         | **9 / 9 pass**                                     |
| Accessibility scan (axe, WCAG 2.2 AA) on 28 screen/role views      | **No violations**                                  |
| Frontend unit and integration tests (Vitest)                       | 93 pass                                            |
| `shared/wms-domain` tests / `backend/demo-server` tests            | 26 pass / 21 pass                                  |
| Typecheck, lint, build in all three packages                       | Pass                                               |
| Production bundle contains no seed data, demo emails or password   | Pass (zero matches in `dist/`)                     |
| Pre-demo checklist can be followed as written                      | Yes, with 3 items only a person can do (section 5) |

### How the workflows were run

1. Demo build served by the demo server (`npm run demo` set-up), fresh data folder.
2. **Reset demo data** through the app: Admin → Simulate → Reset demo data → confirm (pre-demo checklist step 1).
3. Workflows in the running order **W1, W2, W3, W4, W6, W5, W7**, one after another on the same data, each step with
   the login the document names. Each role used its own browser context (like its own Chrome profile). Viewports:
   admin and distributor 1440 × 900, dealer 1024 × 768 (tablet), customer 390 × 844 (phone).
4. Test photos: real JPEGs, including a 12-megapixel phone-size photo (5.6 MB) on CU04.

The same steps are also automated as Playwright specs (`frontend/e2e/w1…w7-*.spec.ts`, section 4). Those reset the
data before each workflow, so each can run alone.

## 2. Workflows

Evidence is what the run read from the screen.

### W1 – Dealer bulk registration

| #   | Login                        | Screen                  | Result | Evidence                                                                                                                                |
| --- | ---------------------------- | ----------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Dealer CoolAir               | DL01 Dealer home        | Pass   | Cards: Registrations this month, Pending, Rejected, Open complaints, Claims in progress. Menu has no admin items.                       |
| 2   | Dealer CoolAir               | DL02 Bulk import        | Pass   | CSV and Excel templates download. `coolair_sales_week38.xlsx`: "25 rows checked: 22 registered, 2 need fixing, 1 sent to admin review." |
| 3   | Dealer CoolAir               | DL02 Bulk import        | Pass   | Model code and date fixed inline, resubmitted without re-upload: "24 registered, 0 need fixing, 1 sent to admin review."                |
| 4   | Dealer CoolAir               | DL04 My sold units      | Pass   | 24 new units Active; AER-SPL15-260901 has Unit 1 year, Compressor 10 years, PCB 5 years.                                                |
| 5   | Admin                        | A02 Registration inbox  | Pass   | Filter Exceptions: 1 row, AER-SPL15-250301, Bulk, Duplicate, Pending.                                                                   |
| 6   | Admin                        | A03 Registration review | Pass   | Existing record shows S. Deshpande; rejected with reason "Duplicate: serial AER-SPL15-250301 is already registered."                    |
| 7   | Admin                        | A04 Units               | Pass   | Filter CoolAir Traders: 31 results (7 seeded + 24 imported), same as the dealer's list.                                                 |
| 8   | Admin                        | A01 Admin dashboard     | Pass   | Registrations by channel, Dealer bar 8 → 32 (+24).                                                                                      |
| 9   | Customer R. Kulkarni (phone) | CU02 My units           | Pass   | Card AER-SPL15-260901 on My units; bell: "AER-SPL15-260901 is registered and under warranty."                                           |

### W2 – Customer self-registration by QR

| #   | Login            | Screen                  | Result | Evidence                                                                                                                                                                                          |
| --- | ---------------- | ----------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Customer (phone) | CU01 Register a product | Pass   | The printed QR label (A05) decodes to `…/register?serial=AER-SPL15-240917&model=AER-SPL15`; CU01 opens with serial and "Aeris Split 1.5 TR (AER-SPL15)" filled in. Real camera: manual check 6.1. |
| 2   | Customer (phone) | CU01 Register a product | Pass   | Purchase date and invoice photo; "Registration sent", Pending badge and pending-approval message.                                                                                                 |
| 3   | Admin            | A02 Registration inbox  | Pass   | Row AER-SPL15-240917, R. Kulkarni, CoolAir Traders, **Portal**, Pending.                                                                                                                          |
| 4   | Admin            | A03 Registration review | Pass   | Invoice image served next to the data; approved.                                                                                                                                                  |
| 5   | Admin            | A05 Unit detail         | Pass   | Unit to 2027, Compressor to 2036, PCB to 2031 (1 / 10 / 5 years); QR label shown; certificate PDF downloads.                                                                                      |
| 6   | Admin            | A06 Models & parts      | Pass   | Template: Unit 1 year parts and labour; Compressor 10 years parts only; PCB 5 years parts only.                                                                                                   |
| 7   | Customer (phone) | CU03 Unit detail        | Pass   | `warranty-AER-SPL15-240917.pdf` downloads on the phone layout. Opening it on a real phone: manual check 6.4.                                                                                      |

### W3 – Customer complaint, service hand-off and manufacturer claim

| #   | Login             | Screen                  | Result | Evidence                                                                                                        |
| --- | ----------------- | ----------------------- | ------ | --------------------------------------------------------------------------------------------------------------- |
| 1   | Customer (phone)  | CU03 Unit detail        | Pass   | AER-SPL15-210311 "Expired"; "Compressor covered until 11 Mar 2031".                                             |
| 2   | Customer (phone)  | CU04 Raise complaint    | Pass   | Before submitting: "Covered: Compressor." and "Labour is chargeable."; 12 MP photo attached; CMP-1008 raised.   |
| 3   | Admin             | A07 Complaints          | Pass   | Top row CMP-1008, AER-SPL15-210311, source Customer, status New.                                                |
| 4   | Admin             | A08 Complaint detail    | Pass   | Entitlement panel; Send to service system → With service, service request SR-1007.                              |
| 5   | Admin             | A12 Integration log     | Pass   | Service system · Outbound · Service request · Sent; payload has the unit, compressor serial and entitlement.    |
| 6   | Admin (simulator) | A13 Simulate panel      | Pass   | Job result sent; "Draft claim CLM-1006 created".                                                                |
| 7   | Admin             | A08 Complaint detail    | Pass   | Compressor CP-210311 → CP-260924-01, new warranty until 24 Sep 2036; photos; "Signed by R. Kulkarni".           |
| 8   | Admin             | A05 Unit detail         | Pass   | "Replaced on 24 Sep 2026 by CP-260924-01"; history "replaced a part" and link "created claim CLM-1006".         |
| 9   | Admin             | A09 Claims              | Pass   | Top row CLM-1006, Aeris, Draft; counts Draft 1, Submitted 1, Approved 1, Paid 2, Rejected 1.                    |
| 10  | Admin             | A10 Claim detail        | Pass   | Evidence from the job result; RMA-AER-7781, ₹8,500; status Submitted.                                           |
| 11  | Admin (simulator) | A13 Simulate panel      | Pass   | CLM-1006 approved by the manufacturer.                                                                          |
| 12  | Admin             | A10 Claim detail        | Pass   | Mark paid → Paid, "Posted to Finance"; Integration log: Finance · Outbound · Finance posting · CLM-1006 · Sent. |
| 13  | Customer (phone)  | CU05 Complaint tracking | Pass   | Raised → With service → Resolved; "New Compressor CP-260924-01 is under warranty until 24 Sep 2036."            |

### W4 – Dealer complaint on behalf of a customer

| #   | Login                   | Screen                   | Result | Evidence                                                                                                                                                                  |
| --- | ----------------------- | ------------------------ | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Dealer CoolAir (tablet) | DL04 My sold units       | Pass   | AER-SPL18-251120 found; Breeze Point's KEL-CAS30-240220 not found.                                                                                                        |
| 2   | Dealer CoolAir (tablet) | DL05 Unit detail         | Pass   | Unit, compressor and PCB each with its status; no Void button (read-only).                                                                                                |
| 3   | Dealer CoolAir (tablet) | DL06 Raise complaint     | Pass   | CMP-1009 raised with a photo; entitlement preview text identical for dealer and admin.                                                                                    |
| 4   | Admin                   | A07 Complaints           | Pass   | Top row CMP-1009, source **Dealer · CoolAir Traders**; admin sends it to service; the dealer has no Send button.                                                          |
| 5   | Dealer CoolAir (tablet) | DL07 Complaints & claims | Pass   | Tracker Raised > **With service** > Resolved; Claims tab: CLM-1006 and CLM-1001, view only, no action buttons or links. Run exactly as written, without extra simulation. |

### W6 – Multi-channel intake and integrations

| #   | Login             | Screen                  | Result | Evidence                                                                                                                                                        |
| --- | ----------------- | ----------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Admin (simulator) | A13 Simulate panel      | Pass   | ERP invoice: AER-SPL15-260904, AER-SPL18-260901, AER-SPL18-260902. Email: POL-SPL12-260901 with invoice.                                                        |
| 2   | Admin             | A02 Registration inbox  | Pass   | All four Pending, with **ERP** and **Email** badges.                                                                                                            |
| 3   | Admin             | A03 Registration review | Pass   | Emailed invoice shown next to the data; approved.                                                                                                               |
| 4   | Admin             | A12 Integration log     | Pass   | ERP Inbound "ERP sales invoice"; Email Inbound "Registration email"; CRM **Outbound** "CRM update" (payload has the serial). Retry available on the failed row. |
| 5   | Admin             | A01 Admin dashboard     | Pass   | Email bar 2 → 3.                                                                                                                                                |

### W5 – Void warranty and chargeable repair

| #   | Login            | Screen               | Result | Evidence                                                                                                                                                                                                                        |
| --- | ---------------- | -------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Admin            | A05 Unit detail      | Pass   | Void warranty, "Unauthorised repair" + note. Banner: "Warranty void: unauthorised repair. PCB cover opened by a local technician, warranty seal broken. Voided by WMS office admin on 24 Sep 2026, 18:18"; same in the history. |
| 2   | Customer (phone) | CU03 Unit detail     | Pass   | Void badge and the same banner with the reason.                                                                                                                                                                                 |
| 3   | Customer (phone) | CU04 Raise complaint | Pass   | "The warranty on this unit is void. The visit is chargeable."; parts and labour Chargeable; CMP-1010 raised.                                                                                                                    |
| 4   | Admin            | A08 Complaint detail | Pass   | Parts and labour Chargeable, "Nothing to claim from the manufacturer"; sent to service; after the job result, no claim was created.                                                                                             |

### W7 – Distributor oversight

| #   | Login                 | Screen              | Result | Evidence                                                                                       |
| --- | --------------------- | ------------------- | ------ | ---------------------------------------------------------------------------------------------- |
| 1   | Admin                 | A11 Dealers & users | Pass   | NorthStar Distribution: CoolAir Traders (Pune), Breeze Point (Nashik); 6 accounts with logins. |
| 2   | Distributor NorthStar | DL01 Dealer home    | Pass   | Comparison CoolAir 27 / Breeze Point 3; "Registrations this month" card = 30 (the sum).        |
| 3   | Distributor NorthStar | DL01 Dealer home    | Pass   | Filter Breeze Point: cards match its row (3 registrations, 3 pending, 1 open complaint).       |
| 4   | Distributor NorthStar | DL04 My sold units  | Pass   | 25 units across both dealers → 4 after filtering to Breeze Point.                              |

### Checks across roles

| Check                            | Result | Evidence                                                                                                                                                                                                                                           |
| -------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Each role sees only its own menu | Pass   | Admin: Dashboard, Registrations, Units, Models & parts, Complaints, Claims, Administration. Dealer and distributor: Home, Register a unit, Bulk import, My sold units, Complaints & claims. Customer: My units, Register a product, My complaints. |
| Notifications for every role     | Pass   | After the run: admin 9, dealer 8, distributor 5, customer 4, each with a link to the record.                                                                                                                                                       |
| Each role sees only its own data | Pass   | Server-side scoping tests (backend, 21 tests) and W1.1, W4.1, W4.5, W7.2–W7.4 above; out-of-scope records answer "not found".                                                                                                                      |
| A01 cards open their lists       | Pass   | Units → /units; Active → ?status=ACTIVE; Expiring within 30 days → ?status=EXPIRING_SOON; Expired → ?status=EXPIRED; Void → ?status=VOID; Open claims → /claims.                                                                                   |

## 3. Screens: "must contain"

Checked by `frontend/e2e/screens.spec.ts` on fresh seed data, with the login that uses each screen. All items
Present.

| Screen                       | Item                                                           | Status  | Where / how it shows                                                                   |
| ---------------------------- | -------------------------------------------------------------- | ------- | -------------------------------------------------------------------------------------- |
| A01 Admin dashboard          | Cards: units, active, expiring 30 days, expired, open claims   | Present | Five cards (plus Awaiting registration and Void when non-zero); each links to its list |
|                              | Registrations by channel chart                                 | Present | Bar chart with "View data" table                                                       |
|                              | Claims by brand chart                                          | Present | Bar chart with "View data" table                                                       |
|                              | Expiring-soon list, recent activity                            | Present | Two cards under the charts                                                             |
| A02 Registration inbox       | Queue from every channel with source badge                     | Present | Source column: Dealer, Portal, Email, ERP, Bulk                                        |
|                              | Filters: pending, exceptions, duplicates                       | Present | Status, source and exception filters (Exceptions, Duplicates, Model mismatches)        |
|                              | Bulk approve                                                   | Present | Row checkboxes → "Approve N selected"                                                  |
| A03 Registration review      | Submitted data next to invoice image                           | Present | Two cards side by side                                                                 |
|                              | Duplicate / model-mismatch warnings                            | Present | Warning banners and an "Existing record" card                                          |
|                              | Approve, reject with reason, merge                             | Present | Approve (not offered for duplicates), Reject with reason, Merge into existing record   |
| A04 Units                    | Search by serial, customer, dealer                             | Present | One search box matching serial, customer, dealer and model                             |
|                              | Status pill per unit                                           | Present | Status column                                                                          |
|                              | Manual add, bulk upload                                        | Present | "Add unit" and "Bulk upload" buttons                                                   |
| A05 Unit detail              | Part-wise warranty table with status pills                     | Present | One row per part with its status                                                       |
|                              | QR label, certificate PDF                                      | Present | QR label card with Print label; Warranty certificate (PDF) button                      |
|                              | Service & claim history                                        | Present | "Service & claim history" tab                                                          |
|                              | Void warranty with reason                                      | Present | Void warranty button → reason and note                                                 |
| A06 Models & parts           | Model list by brand                                            | Present | Model cards with brand                                                                 |
|                              | Model template: parts, warranty months, parts/labour coverage  | Present | Template table; periods are shown as years/months (e.g. "10 years")                    |
| A07 Complaints               | List with source (Customer / Dealer / Admin)                   | Present | Source column; Dealer shows the dealer's name                                          |
|                              | Status: New → With service → Resolved                          | Present | Status column and filter                                                               |
| A08 Complaint detail         | Entitlement panel: parts / labour free or chargeable           | Present | "What's covered" panel                                                                 |
|                              | Send to service system                                         | Present | Button on New complaints                                                               |
|                              | Job result: parts replaced, serials, photos, sign-off          | Present | Job result card                                                                        |
| A09 Claims                   | List by brand and status                                       | Present | Table with brand and status filters                                                    |
|                              | Submitted, Approved, Paid, Rejected counts                     | Present | Count cards (plus Draft), each opens the filtered list                                 |
| A10 Claim detail             | Evidence pulled from job result                                | Present | "Evidence from the job result" card                                                    |
|                              | RMA number, amount                                             | Present | Claim details; entered on Submit                                                       |
|                              | Submit, approve, reject, mark paid                             | Present | Buttons by status (Draft: Submit; Submitted: Approve, Reject; Approved: Mark paid)     |
|                              | Finance posting status                                         | Present | Finance posting card and badge                                                         |
| A11 Dealers & users          | Distributor → dealer hierarchy                                 | Present | One card per distributor with its dealers; dealers without a distributor               |
|                              | Dealer accounts and logins                                     | Present | Accounts table with login emails and a role filter                                     |
| A12 Integration log          | Every message in/out: CRM, ERP, Finance, Service system, OEM   | Present | System filter and column (also Email)                                                  |
|                              | Direction, status, retry, payload view                         | Present | Direction and status badges, Retry on failed rows, View payload                        |
| A13 Simulate panel           | Demo-only: fire ERP invoice, email, job result, OEM decision   | Present | Four actions on three cards                                                            |
|                              | Reset demo data                                                | Present | Reset card with confirmation                                                           |
| DL01 Dealer home             | Registrations this month, pending, rejected                    | Present | Cards                                                                                  |
|                              | Open complaints, claims in progress                            | Present | Cards (link to Complaints & claims)                                                    |
|                              | Distributor: filter by dealer, dealer comparison               | Present | "Show" filter and Dealer comparison table                                              |
| DL02 Bulk import             | Download Excel / CSV template                                  | Present | Two template links                                                                     |
|                              | Upload → row-by-row validation                                 | Present | Rows table with result and problem per row                                             |
|                              | Error report, fix inline, resubmit                             | Present | "Rows that need attention" filter, inline cells, Resubmit                              |
|                              | Upload history                                                 | Present | Upload history table                                                                   |
| DL03 Register a unit         | Single form or QR scan                                         | Present | Three-step form and "Scan QR label"                                                    |
|                              | Customer details, serial, model, install date, invoice         | Present | Form fields                                                                            |
| DL04 My sold units           | Units registered by this dealer (distributor: all its dealers) | Present | Scoped list; distributor has a dealer filter                                           |
|                              | Search, status pills                                           | Present | Search box and status column                                                           |
| DL05 Unit detail (read-only) | Part-wise warranty status                                      | Present | Parts table                                                                            |
|                              | Certificate download for the customer                          | Present | Warranty certificate (PDF)                                                             |
| DL06 Raise complaint         | On behalf of the customer, with photo                          | Present | Unit picker (dealer's units, with customer name), fault, photo                         |
|                              | Entitlement preview                                            | Present | Same "What's covered" panel as the admin's                                             |
| DL07 Complaints & claims     | Status tracker per complaint                                   | Present | Progress column: Raised > With service > Resolved                                      |
|                              | Claim status (view only)                                       | Present | Claims tab, no actions                                                                 |
| CU01 Register a product      | Opens from QR with serial and model pre-filled                 | Present | "Details read from the QR label on your unit."                                         |
|                              | Purchase date, invoice upload                                  | Present | Form fields                                                                            |
|                              | Pending approval message                                       | Present | "Registration sent" with Pending                                                       |
| CU02 My units                | Cards per unit with overall status                             | Present | One card per unit                                                                      |
|                              | Expiry countdown                                               | Present | "Covered for N more days" / "Compressor covered until …"                               |
| CU03 Unit detail             | Part-wise warranty: unit, compressor, PCB…                     | Present | One card per part on the phone                                                         |
|                              | Download warranty certificate                                  | Present | Button                                                                                 |
|                              | Service history                                                | Present | "Service & claim history" tab                                                          |
| CU04 Raise complaint         | Pick unit, describe fault, add photo                           | Present | Form                                                                                   |
|                              | Shows what is covered before submitting                        | Present | "What's covered for <serial>" panel                                                    |
| CU05 Complaint tracking      | Timeline: raised → with service → resolved                     | Present | Progress timeline                                                                      |
|                              | New part warranty shown after repair                           | Present | Green banner (checked in W3 step 13)                                                   |

## 4. Automated tests

| Suite                 | Where                          | Count    | What it covers                                                                                                                                                      |
| --------------------- | ------------------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Playwright (Chromium) | `frontend/e2e/`                | 9 specs  | W1–W7 one spec each; `screens.spec.ts` (all "must contain" items); `a11y.spec.ts` (axe WCAG 2.2 AA on 28 screen/role views). Run with `npm run e2e` in `frontend/`. |
| Vitest                | `frontend/src/**/*.test.ts(x)` | 93 tests | Components, schemas, uploads (incl. HEIC refusal), routing and role homes, and workflow tests W1–W7 through the real pages against the demo core                    |
| Vitest                | `shared/wms-domain`            | 26 tests | Part-wise warranty, dates, entitlement, registration row rules, claim status steps                                                                                  |
| Vitest                | `backend/demo-server`          | 21 tests | Seed, auth, scoping per role, dashboards, attachments, reset                                                                                                        |

The accessibility scan found four issues during Phase 6, all fixed without visual changes: definition lists wrapped
`dt`/`dd` in an extra element (unit, complaint and claim detail); the bulk upload file input had no label; the
horizontally scrolling table area wasn't reachable by keyboard.

## 5. Pre-demo checklist

| #   | Step (from `docs/demo-workflows.md`)              | Can be followed as written?                                                                                                                              |
| --- | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Run Reset demo data (Admin → Simulate)            | Yes. Administration → Simulate tab → Reset demo data → confirm. Verified.                                                                                |
| 2   | Open four windows, each signed in                 | Yes, with four **Chrome profiles** (one sign-in cookie per profile). Verified with four separate browser contexts; with real profiles: manual check 6.6. |
| 3   | Keep `coolair_sales_week38.xlsx` ready            | Yes. It is in `demo-assets/`; W1 uses it.                                                                                                                |
| 4   | Print or show the QR label for `AER-SPL15-240917` | Yes. Units → AER-SPL15-240917 → QR label card → Print label. Printing on paper: manual check 6.3.                                                        |
| 5   | Have a fault photo on the phone                   | Person only. Manual check 6.5.                                                                                                                           |
| 6   | Demo URL opens over HTTPS on the phone            | Person only (needs the tunnel and a real phone). Manual check 6.1.                                                                                       |

`docs/demo-setup.md`, section "Demo day", has the full start order.

## 6. Manual checks for a human before the demo

Automated tests can't prove these. Do them in **Chrome only**, on the demo laptop and the demo phone, after starting
the server and the tunnel as in `docs/demo-setup.md`.

### 6.1 QR scan with the phone camera over the HTTPS tunnel

1. On the laptop: `cd backend/demo-server` → `npm run demo`; in a second terminal `cloudflared tunnel --url
http://localhost:4000`. Note the `https://…trycloudflare.com` address.
2. Laptop, Admin Chrome profile: open the tunnel address, sign in as Admin, reset demo data, then open Units →
   **AER-SPL15-240917**. The QR label card shows the code.
3. Phone, Chrome: open the tunnel address, sign in as **Customer: R. Kulkarni**.
4. Phone: menu → **Register a product** → **Scan the QR label**. Allow the camera if asked. Point it at the QR code
   on the laptop screen.
5. Expected: the form shows "Details read from the QR label on your unit.", serial **AER-SPL15-240917** and model
   **Aeris Split 1.5 TR (AER-SPL15)**, with nothing typed.

### 6.2 Camera permission prompt, and the typed-serial fallback

1. Phone, Chrome, signed in as the customer: Register a product → **Scan the QR label**.
2. First time: Chrome asks to use the camera. Tap **Allow**; the camera view starts. (If it was allowed before, it
   starts at once.)
3. To check the fallback: close the scanner, tap the lock icon in Chrome's address bar → **Permissions** → Camera →
   **Block**, reload, and open the scanner again.
4. Expected: "Camera access is blocked. Allow it in the browser, or type the serial below." Type
   `AER-SPL15-240917` in **Or type the serial number** → **Use this serial**; the form fills the serial.
5. Set the camera permission back to **Allow** before the demo.
6. Optional, on the laptop at `http://` (not the tunnel): the scanner says "The camera only works on a secure (https)
   page. Type the serial below instead."

### 6.3 Printing the QR label on a real printer

1. Laptop, Admin profile: Units → **AER-SPL15-240917** → QR label card → **Print label**.
2. In Chrome's print dialog choose the real printer (not "Save as PDF"), scale 100%, and print.
3. Check the printout: the QR code and the serial are sharp and the code is at least about 3 cm wide.
4. Scan the **paper** label with the phone as in 6.1, steps 3–5. Expected: the same pre-filled form.

### 6.4 Certificate PDF opening on the phone

1. Phone, Chrome, signed in as the customer, after W2 (or on any registered unit, e.g. **AER-SPL15-210311**): My
   units → open the unit → **Warranty certificate (PDF)**.
2. Expected: Chrome downloads `warranty-<serial>.pdf` and offers **Open**. Tap it; the PDF opens and shows the unit,
   owner, dealer and one line per part with start and end dates.
3. If nothing opens, check Chrome → Downloads on the phone.

### 6.5 Uploading a real phone photo on CU04

1. Phone: take a photo with the phone camera (or keep one in the gallery). If it's an iPhone, set Settings → Camera
   → Formats → **Most Compatible** so photos are JPEG.
2. Chrome, signed in as the customer: My complaints → **Raise complaint** → pick **AER-SPL15-210311** → type "No
   cooling" → **Photos or video** → choose **Camera** (take a new photo) or the gallery photo.
3. Expected: the file appears in the list with its progress; **Raise complaint** submits and opens the complaint.
   Under **Photos or video** the thumbnail shows the photo.
4. Laptop, Admin profile: Complaints → open the same complaint. Expected: the same photo is shown on A08.
5. A HEIC file (iPhone "High efficiency") is refused with: "… is a HEIC photo, which can't be shown here. Send it as a
   JPEG instead …". That is intended.

### 6.6 Each role in its own Chrome profile at the same time

1. Create four Chrome profiles once (profile icon → **Add** → "Continue without an account"): Admin, Dealer,
   Distributor, Customer.
2. Open the tunnel address in each and sign in: Admin → **Admin: WMS office admin**; Dealer → **Dealer: CoolAir
   Traders, Pune**; Distributor → **Distributor: NorthStar Distribution**; Customer → **Customer: R. Kulkarni**.
3. Reload every window (F5). Expected: each still shows its own role (name in the account menu, its own menu items).
4. In the Admin window reset demo data. Expected: the other three stay signed in.
5. Quick cross-check: in the Customer window raise a complaint; within a few seconds the Admin window's bell shows
   "New complaint … for …".

## 7. Known limitations

| Area                  | Limitation                                                                                                                                                                                                                                             |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Backend               | `backend/demo-server` is a mock API for the demo: data in a JSON file, sessions in a file, one shared demo password, simulated external systems (A13). It isn't meant for production. `docs/api-contract.md` lists what the real backend must provide. |
| Browser               | Supported on Google Chrome only (desktop and phone). No other browser was tested.                                                                                                                                                                      |
| QR scan               | The automated run decodes the printed label's image, not a camera feed. The real camera needs manual checks 6.1–6.3.                                                                                                                                   |
| Photos                | HEIC photos are refused with a message, not converted. Uploads are limited to 10 MB per file in the form (15 MB on the server).                                                                                                                        |
| Integration retry     | In the mock, Retry always succeeds.                                                                                                                                                                                                                    |
| Seed dates            | Units are dated from the day of the reset (for example "expiring within 30 days"). Reset on the morning of the demo.                                                                                                                                   |
| Sample bulk file      | `coolair_sales_week38.xlsx` has fixed serials (`…-2609xx`) and dates. Uploading it twice without a reset flags its serials as duplicates.                                                                                                              |
| Forgot password       | The demo server has no password reset. The demo build hides the "Forgot password" link (`VITE_SHOW_FORGOT_PASSWORD=false` in `.env.showcase`); opening `/forgot-password` directly shows "Please contact your administrator."                          |
| Tablet (DL07)         | Below 1280 px wide, the dealer's complaints list hides Received, Source, Status and Cover so it fits a 1024 px tablet without sideways scrolling; the progress tracker still shows the status.                                                         |
| Out-of-scope code     | Screens from the earlier product (RMA, customers, reports, policies, settings, public warranty check) are kept in the code but not routed.                                                                                                             |
| Currency and language | English only; amounts in INR.                                                                                                                                                                                                                          |

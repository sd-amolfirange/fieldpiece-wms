# HVAC Warranty Management – Demo Workflows and Screens (Source of Truth)

Demo feature set, revision 3. Roles: Admin, Dealer / Distributor, Customer. A Simulator (Admin → Simulate) stands in for external systems (ERP, email, service system, OEM, CRM, Finance).

Sample names, serials and files are fictional seed data.

## Demo logins (seed data)

| Role        | Sample account          | Login                   | Scope                                                                                                      |
| ----------- | ----------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------- |
| Admin       | WMS office admin        | admin@demo.wms          | Warranty desk at the brand / service company. Sees everything.                                             |
| Dealer      | CoolAir Traders, Pune   | dealer.coolair@demo.wms | Sells and installs units; registers them and raises complaints for its customers. Sees only its own data.  |
| Distributor | NorthStar Distribution  | dist.northstar@demo.wms | Has two dealers (CoolAir Traders, Breeze Point); sees both.                                                |
| Customer    | R. Kulkarni (homeowner) | customer.rk@demo.wms    | Owns a 1.5-ton split AC bought from CoolAir Traders. Phone layout.                                         |
| Simulator   | Admin → Simulate panel  | –                       | Fires inbound events: ERP invoice, registration email, service-system job result, OEM decision. Demo only. |

All roles: Login, Notifications (bell icon with recent in-app messages), Profile / sign out. Each role sees only its own menu and data.

## Seed data required

- Bulk file `coolair_sales_week38.xlsx`: 25 rows, 3 deliberate errors (unknown model code, duplicate serial, missing install date).
- Unit `AER-SPL15-240917`: new unit with printable QR label, used for customer QR self-registration.
- Unit `AER-SPL15-210311`: unit warranty expired, compressor covered until 2031.
- Unit `AER-SPL18-230502`: has an unauthorised-repair note (for voiding).
- Model template with parts: unit 1 year, compressor 10 years, PCB 5 years.
- Distributor NorthStar with dealers CoolAir Traders and Breeze Point.
- Admin → Simulate → Reset demo data restores this seed state.

## Screens by role

### Admin (13 screens, Web · desktop layout)

| Code | Screen              | Must contain                                                                                                                                             |
| ---- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A01  | Admin dashboard     | Cards: units, active, expiring 30 days, expired, open claims; Registrations by channel chart; Claims by brand chart; Expiring-soon list, recent activity |
| A02  | Registration inbox  | Queue from every channel with source badge (Dealer, Portal, Email, ERP…); Filters: pending, exceptions, duplicates; Bulk approve                         |
| A03  | Registration review | Submitted data next to invoice image; Duplicate / model-mismatch warnings; Approve, reject with reason, merge                                            |
| A04  | Units               | Search by serial, customer, dealer; Status pill per unit; Manual add, bulk upload                                                                        |
| A05  | Unit detail         | Part-wise warranty table with status pills; QR label, certificate PDF; Service & claim history; Void warranty with reason                                |
| A06  | Models & parts      | Model list by brand; Model template: parts, warranty months, parts/labour coverage                                                                       |
| A07  | Complaints          | List with source (Customer / Dealer / Admin); Status: New → With service → Resolved                                                                      |
| A08  | Complaint detail    | Entitlement panel: parts / labour free or chargeable; Send to service system; Job result: parts replaced, serials, photos, sign-off                      |
| A09  | Claims              | List by brand and status; Submitted, Approved, Paid, Rejected counts                                                                                     |
| A10  | Claim detail        | Evidence pulled from job result; RMA number, amount; Submit, approve, reject, mark paid; Finance posting status                                          |
| A11  | Dealers & users     | Distributor → dealer hierarchy; Dealer accounts and logins                                                                                               |
| A12  | Integration log     | Every message in/out: CRM, ERP, Finance, Service system, OEM; Direction, status, retry, payload view                                                     |
| A13  | Simulate panel      | Demo-only: fire ERP invoice, email, job result, OEM decision; Reset demo data                                                                            |

### Dealer / Distributor (7 screens, Web · desktop & tablet)

| Code | Screen                  | Must contain                                                                                                                       |
| ---- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| DL01 | Dealer home             | Registrations this month, pending, rejected; Open complaints, claims in progress; Distributor: filter by dealer, dealer comparison |
| DL02 | Bulk import             | Download Excel / CSV template; Upload → row-by-row validation; Error report, fix inline, resubmit; Upload history                  |
| DL03 | Register a unit         | Single form or QR scan; Customer details, serial, model, install date, invoice                                                     |
| DL04 | My sold units           | Units registered by this dealer (distributor: all its dealers); Search, status pills                                               |
| DL05 | Unit detail (read-only) | Part-wise warranty status; Certificate download for the customer                                                                   |
| DL06 | Raise complaint         | On behalf of the customer, with photo; Entitlement preview                                                                         |
| DL07 | Complaints & claims     | Status tracker per complaint; Claim status (view only)                                                                             |

### Customer (5 screens, Web · phone layout)

| Code | Screen             | Must contain                                                                                            |
| ---- | ------------------ | ------------------------------------------------------------------------------------------------------- |
| CU01 | Register a product | Opens from QR with serial and model pre-filled; Purchase date, invoice upload; Pending approval message |
| CU02 | My units           | Cards per unit with overall status; Expiry countdown                                                    |
| CU03 | Unit detail        | Part-wise warranty: unit, compressor, PCB…; Download warranty certificate; Service history              |
| CU04 | Raise complaint    | Pick unit, describe fault, add photo; Shows what is covered before submitting                           |
| CU05 | Complaint tracking | Timeline: raised → with service → resolved; New part warranty shown after repair                        |

## Workflows

Suggested demo running order: W1, W2, W3, W4, W6, W5, W7 (about 25 minutes).

### W1 – Dealer bulk registration

**Duration:** 5 min  
**Roles:** Dealer / Distributor, Admin, Customer  
**Goal:** Show how a dealer registers a week's sales in one go, how bad rows are caught, and how clean rows become warranty records without admin effort.  
**Set-up:** Sample file coolair_sales_week38.xlsx — 25 rows, 3 errors: unknown model code, duplicate serial, missing install date.

| #   | Role                 | Screen                  | Action                                                                       | Expected result / what to show                                                        |
| --- | -------------------- | ----------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| 1   | Dealer / Distributor | DL01 Dealer home        | Log in as CoolAir Traders and open Dealer home.                              | Dealer sees only its own registrations, complaints and claims.                        |
| 2   | Dealer / Distributor | DL02 Bulk import        | Download the template, then upload coolair_sales_week38.xlsx.                | Every row is checked against the product master: 22 valid, 3 flagged with the reason. |
| 3   | Dealer / Distributor | DL02 Bulk import        | Fix the missing date and the model code inline; resubmit.                    | Errors are fixed in place — no re-upload of the whole file.                           |
| 4   | Dealer / Distributor | DL04 My sold units      | Open My sold units — the new units appear as Active.                         | Parts and their warranty periods were attached automatically from the model.          |
| 5   | Admin                | A02 Registration inbox  | Switch to Admin; open Registration inbox, filter Exceptions.                 | Only the duplicate-serial row needs a human; clean dealer rows were auto-approved.    |
| 6   | Admin                | A03 Registration review | Open the duplicate; compare with the existing record and reject with reason. | Duplicate check protects against double claims on the same unit.                      |
| 7   | Admin                | A04 Units               | Open Units and filter by dealer CoolAir Traders.                             | Admin sees the same units the dealer sees, plus every other channel.                  |
| 8   | Admin                | A01 Admin dashboard     | Open the dashboard.                                                          | Registrations by channel: the Dealer bar has jumped by 24.                            |
| 9   | Customer             | CU02 My units           | Switch to Customer; the new unit is in My units with a notification.         | Customer gets the warranty record without filling anything in.                        |

### W2 – Customer self-registration by QR

**Duration:** 4 min  
**Roles:** Customer, Admin  
**Goal:** Show the end customer registering a product from the label on the unit, and the part-level warranty they get back.  
**Set-up:** Phone signed in as the customer; printed QR for serial AER-SPL15-240917; invoice photo on the phone.

| #   | Role     | Screen                  | Action                                                                               | Expected result / what to show                                                                         |
| --- | -------- | ----------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| 1   | Customer | CU01 Register a product | Scan the QR on the unit with the phone; the form opens with serial and model filled. | No typing of serial numbers — the most common source of bad data.                                      |
| 2   | Customer | CU01 Register a product | Enter purchase date, upload invoice photo, submit.                                   | Status shows Pending approval.                                                                         |
| 3   | Admin    | A02 Registration inbox  | On Admin, the registration appears in the inbox with a Portal badge.                 | One inbox for every channel.                                                                           |
| 4   | Admin    | A03 Registration review | Open it: invoice image next to the data; approve.                                    | Admin can verify against the invoice before the warranty starts.                                       |
| 5   | Admin    | A05 Unit detail         | Open the unit detail.                                                                | Unit 1 year, compressor 10 years, PCB 5 years — each tracked separately. QR and certificate generated. |
| 6   | Admin    | A06 Models & parts      | Open Models & parts for this model.                                                  | The part warranty periods come from the model template — set once, applied to every unit.              |
| 7   | Customer | CU03 Unit detail        | Back on the phone: open the unit and download the warranty certificate.              | Customer has the certificate on the phone within a minute of registering.                              |

### W3 – Warranty complaint to claim settlement (core workflow)

**Duration:** 7 min  
**Roles:** Customer, Admin, Simulator  
**Goal:** The core story: a fault on an old unit, a covered part, hand-off to the service system, and a claim recovered from the manufacturer.  
**Set-up:** Seeded unit AER-SPL15-210311: unit warranty expired, compressor covered until 2031.

| #   | Role      | Screen                  | Action                                                                                              | Expected result / what to show                                                     |
| --- | --------- | ----------------------- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| 1   | Customer  | CU03 Unit detail        | Customer opens the older unit.                                                                      | Unit warranty expired — but the compressor is still covered for years.             |
| 2   | Customer  | CU04 Raise complaint    | Raise a complaint: 'no cooling', add a photo.                                                       | Before submitting, the customer sees: compressor parts covered, labour chargeable. |
| 3   | Admin     | A07 Complaints          | Admin opens Complaints; the new one is on top with source Customer.                                 | –                                                                                  |
| 4   | Admin     | A08 Complaint detail    | Open the complaint and check the entitlement panel; click Send to service system.                   | The WMS decides what is covered; the service system does the visit.                |
| 5   | Admin     | A12 Integration log     | Open the Integration log.                                                                           | Outbound service request with unit, part serials and entitlement.                  |
| 6   | Simulator | A13 Simulate panel      | Simulate: service system returns the job result.                                                    | In production this arrives from the service system automatically.                  |
| 7   | Admin     | A08 Complaint detail    | Back on the complaint: job result shows compressor replaced, old and new serials, photos, sign-off. | The new compressor's warranty starts today.                                        |
| 8   | Admin     | A05 Unit detail         | Open the unit detail.                                                                               | Part history shows the replacement; claim link added.                              |
| 9   | Admin     | A09 Claims              | Open Claims: the new claim is at the top, status Draft.                                             | Claims list by brand shows what is receivable from each manufacturer.              |
| 10  | Admin     | A10 Claim detail        | Open the claim that was auto-created; add RMA number and submit to the manufacturer.                | No re-keying: the evidence came from the job result.                               |
| 11  | Simulator | A13 Simulate panel      | Simulate: OEM approves the claim.                                                                   | –                                                                                  |
| 12  | Admin     | A10 Claim detail        | Mark approved → paid; settlement posted to Finance.                                                 | Integration log shows the posting to Finance / ERP.                                |
| 13  | Customer  | CU05 Complaint tracking | Customer's complaint timeline shows Resolved with the new part warranty.                            | –                                                                                  |

### W4 – Dealer complaint on behalf of customer

**Duration:** 3 min  
**Roles:** Dealer / Distributor, Admin  
**Goal:** Show that the dealer — often the customer's first call — can check warranty and raise a complaint without calling the brand.  
**Set-up:** Use a unit sold by CoolAir Traders with an active warranty.

| #   | Role                 | Screen                       | Action                                                             | Expected result / what to show                            |
| --- | -------------------- | ---------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------- |
| 1   | Dealer / Distributor | DL04 My sold units           | As CoolAir Traders, search the customer's serial in My sold units. | Dealer can only find units it sold.                       |
| 2   | Dealer / Distributor | DL05 Unit detail (read-only) | Open the unit: part-wise status is visible.                        | Instant answer on the phone call — in or out of warranty. |
| 3   | Dealer / Distributor | DL06 Raise complaint         | Raise a complaint on the customer's behalf with a photo.           | Entitlement preview is the same the admin sees.           |
| 4   | Admin                | A07 Complaints               | On Admin, the complaint shows source Dealer — CoolAir Traders.     | Admin, not the dealer, hands it to the service system.    |
| 5   | Dealer / Distributor | DL07 Complaints & claims     | Back as dealer, track the complaint and the claim status.          | Dealer sees progress but cannot change the claim.         |

### W5 – Void warranty and chargeable repair

**Duration:** 3 min  
**Roles:** Admin, Customer  
**Goal:** Show that the rules also say no: a voided warranty turns a complaint into chargeable work and no claim is raised.  
**Set-up:** Seeded unit AER-SPL18-230502 with an unauthorised-repair note.

| #   | Role     | Screen               | Action                                                                           | Expected result / what to show                           |
| --- | -------- | -------------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------- |
| 1   | Admin    | A05 Unit detail      | Open the unit; click Void warranty and choose 'Unauthorised repair', add a note. | Void is recorded with reason, user and date — auditable. |
| 2   | Customer | CU03 Unit detail     | Customer sees the unit marked Void with the reason.                              | Terms are communicated clearly to the customer.          |
| 3   | Customer | CU04 Raise complaint | Customer raises a complaint.                                                     | The form shows the visit is chargeable.                  |
| 4   | Admin    | A08 Complaint detail | Admin opens it: entitlement shows Chargeable; send to service.                   | No claim will be created for this job.                   |

### W6 – Multi-channel intake and integrations

**Duration:** 3 min  
**Roles:** Simulator, Admin  
**Goal:** Show that registrations arrive from systems as well as people, and that every exchange with CRM, ERP and Finance is traceable.  
**Set-up:** Nothing extra — uses the simulate panel.

| #   | Role      | Screen                  | Action                                                                                          | Expected result / what to show                          |
| --- | --------- | ----------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| 1   | Simulator | A13 Simulate panel      | Simulate an ERP sales invoice with 3 serials and a registration email with an invoice attached. | Stand-ins for the real ERP feed and mailbox.            |
| 2   | Admin     | A02 Registration inbox  | Open the Registration inbox: new items with ERP and Email badges.                               | Same validation and approval for every channel.         |
| 3   | Admin     | A03 Registration review | Approve the emailed registration.                                                               | Customer record is updated in CRM on approval.          |
| 4   | Admin     | A12 Integration log     | Open the Integration log: inbound ERP and email, outbound CRM update.                           | Every message is logged with status and can be retried. |
| 5   | Admin     | A01 Admin dashboard     | Back on the dashboard: channel chart updated.                                                   | –                                                       |

### W7 – Distributor oversight

**Duration:** 2 min  
**Roles:** Admin, Dealer / Distributor  
**Goal:** Show the distributor view: one login that sees all its dealers.  
**Set-up:** Distributor NorthStar has dealers CoolAir Traders and Breeze Point.

| #   | Role                 | Screen              | Action                                                                       | Expected result / what to show                                    |
| --- | -------------------- | ------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| 1   | Admin                | A11 Dealers & users | On Admin, open Dealers & users: NorthStar with its two dealers.              | Hierarchy is set once by the admin; access follows from it.       |
| 2   | Dealer / Distributor | DL01 Dealer home    | Log in as NorthStar Distribution; Dealer home shows totals for both dealers. | Distributor sees across its network, dealers see only themselves. |
| 3   | Dealer / Distributor | DL01 Dealer home    | Filter by dealer; compare registrations and open complaints.                 | Spot dealers who are behind on registering sales.                 |
| 4   | Dealer / Distributor | DL04 My sold units  | Open My sold units, filtered to Breeze Point.                                | –                                                                 |

## Pre-demo checklist

1. Run Reset demo data (Admin → Simulate) so counts and statuses start clean.
2. Open four windows: Admin, Dealer, Distributor, Customer, each already signed in.
3. Keep the sample bulk file `coolair_sales_week38.xlsx` ready.
4. Print or show the QR label for serial `AER-SPL15-240917` for the phone scan.
5. Have a sample fault photo ready on the phone for the complaint step.
6. Check the demo URL opens over HTTPS on the phone (needed for the camera).

# Fieldpiece Warranty Management – Workflows and Screens (Source of Truth)

Feature set, revision 4 (warranty core, US). Roles: Admin (Fieldpiece warranty desk), Dealer / Distributor, Customer. System events (Admin → System events) stand in for the systems that send registrations: a distributor ERP, the registration mailbox and an online marketplace.

Revision 4 follows the client feedback: US users and addresses, amounts in US dollars, Fieldpiece serial numbers with batch numbers, the product list checked against fieldpiece.com, no RMA, less service/job workflow and more warranty core, and several registration entry points.

Sample people, dealers, serials and files are fictional seed data. Fieldpiece models are real; the serial and batch formats are assumed until Fieldpiece confirms them [CONFIRM].

## Logins (seed data)

| Role        | Sample account                                    | Login                     | Scope                                                                                              |
| ----------- | ------------------------------------------------- | ------------------------- | -------------------------------------------------------------------------------------------------- |
| Admin       | Fieldpiece warranty desk                          | admin@wms.local           | Reviews registrations and decides warranty claims. Sees everything.                                |
| Dealer      | Lone Star Refrigeration Supply, Houston TX        | dealer.lonestar@wms.local | Sells Fieldpiece tools; registers them and files claims for its customers. Sees only its own data. |
| Dealer      | Bayou Air Parts, Baton Rouge LA                   | dealer.bayou@wms.local    | Second dealer under the same distributor.                                                          |
| Distributor | Gulf States HVAC Distribution                     | dist.gulfstates@wms.local | Has two dealers (Lone Star, Bayou Air Parts); sees both.                                           |
| Customer    | Marcus Reed (HVAC technician)                     | customer.mreed@wms.local  | Owns an SC680 clamp meter, a VP87 vacuum pump and a DR82 leak detector. Phone layout.              |
| Visitor     | Anyone, no account                                | –                         | Registers a product on the website form (`/register-product`).                                     |
| Systems     | Admin → System events; partner API; email webhook | –                         | Distributor ERP invoice, registration email, marketplace orders; partner systems with API keys.    |

All signed-in roles: Notifications (bell), Profile / sign out. Each role sees only its own menu and data.

## Warranty rules

- One warranty per product: **1 year from the date of purchase** (Fieldpiece: "All of our products have a 1 year warranty from date of purchase."), kept per model in the product catalog.
- Warranty ends on purchase date + 12 months − 1 day. Status: Active, Expiring soon (≤ 30 days), Expired, Void, Pending registration.
- Serial: 9 digits, year + week + 5-digit sequence (e.g. `SC680-251406233`). Batch: year + week + line (e.g. `2514-L03`). Stored per model so real formats can be set later [CONFIRM].
- A replacement under warranty is registered to the same customer and carries the rest of the original warranty [CONFIRM].
- Currency USD, time zone America/Los_Angeles, US dates ("Sep 28, 2026").

## Registration channels

| Channel         | Who / what                                        | Result                                                     |
| --------------- | ------------------------------------------------- | ---------------------------------------------------------- |
| Dealer          | Dealer form, single product or QR scan            | Approved at once when clean; a known serial goes to review |
| Bulk upload     | Dealer Excel / CSV file                           | Same, per row; rows with problems are fixed inline         |
| Customer portal | Signed-in customer, from the QR label             | Reviewed by the warranty desk                              |
| Web form        | Anyone on the website, with a receipt             | Reviewed                                                   |
| Email           | Receipt emailed to the registration mailbox       | Reviewed                                                   |
| Distributor ERP | Sales invoice from a distributor's ERP            | Reviewed                                                   |
| Partner API     | Point-of-sale system with its own API key         | Approved at once when clean                                |
| Marketplace     | Online marketplace orders through the partner API | Approved at once when clean                                |

## Seed data

- Bulk file `demo-assets/lonestar_sales_week38.xlsx`: 25 rows, 3 deliberate errors (unknown model SC690 on row 8, serial MG44-252811902 already registered on row 14, missing purchase date on row 20).
- Product `SM482V-261804517` (SM482V, batch `2618-L02`): shipped to Lone Star on an ERP invoice, not registered; has a printable QR label (W2). Sample labels in `demo-assets/qr-samples/`.
- Marcus Reed: `SC680-251406233` SC680 (active), `VP87-243208841` VP87 (expired), `DR82-252207119` DR82 (third-party repair note, voided in W5).
- 12 Fieldpiece models in 7 categories; 15 products; claims CLM-1001..1007 in every status (repair, replacement, $139.00 credit, rejected, approved, in review, submitted).
- Partner systems: Desert Peak HVAC Supply point of sale (Partner API) and an online marketplace.
- Admin → System events → Reset data restores this state.

## Screens by role

### Admin (Web · desktop layout)

| Code | Screen              | Must contain                                                                                                                                                                                                              |
| ---- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A01  | Admin dashboard     | Cards: registered products, active, ending within 30 days, expired, open claims, registrations to review; Registrations by channel; Claims by status; Claims by product category; Warranties ending soon; Recent activity |
| A02  | Registration inbox  | Queue from every channel with a channel badge; batch number; filters: status, exceptions, duplicates, channel; bulk approve                                                                                               |
| A03  | Registration review | Submitted data (serial, batch, model, purchase date, place of purchase, US address) next to the receipt; duplicate / model-mismatch warnings; approve, reject, merge                                                      |
| A04  | Registered products | Search by serial, batch, model, customer, dealer; batch, purchase date, warranty end, status pill; manual add, bulk upload                                                                                                |
| A05  | Product detail      | Warranty (term, start, end, days left, what's covered); claims on the product; history; QR label with batch; certificate PDF; void warranty with reason                                                                   |
| A06  | Product catalog     | Fieldpiece models by category with warranty term; model page: warranty, serial and batch label format                                                                                                                     |
| A09  | Warranty claims     | Counts per status (Submitted, In review, Approved, Closed, Rejected); filters: status, issue, who filed it; File a claim                                                                                                  |
| A10  | Claim detail        | Coverage when filed; product (serial, batch, purchase date, warranty today); evidence; progress; Start review, Approve (repair / replace / credit in USD), Reject, Close (replacement serial and batch)                   |
| A11  | Dealers & users     | Distributor → dealer hierarchy; dealer accounts and logins                                                                                                                                                                |
| A12  | Integration log     | Every message: Distributor ERP, Email, Partner API, CRM, Finance (credit memos); direction, status, retry, payload; partner systems and API keys (add, turn on/off)                                                       |
| A13  | System events       | Distributor ERP invoice (3 serials), registration email with receipt, marketplace orders (2 serials); Reset data                                                                                                          |

### Dealer / Distributor (Web · desktop & tablet)

| Code | Screen                     | Must contain                                                                                                                                                                                                                               |
| ---- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| DL01 | Dealer home                | Registrations this month, pending, rejected, open claims; distributor: filter by dealer, dealer comparison                                                                                                                                 |
| DL02 | Bulk import                | Excel / CSV template; upload → row checks (model, serial and batch format, date); fix inline, resubmit; history                                                                                                                            |
| DL03 | Register a product         | Single form or QR scan; serial, batch, model, purchase date, invoice; customer with US state and ZIP                                                                                                                                       |
| DL04 | Sold products              | Products this dealer sold (distributor: all its dealers); search, status pills                                                                                                                                                             |
| DL05 | Product detail (read-only) | Warranty; certificate download; File a claim                                                                                                                                                                                               |
| DL06 | File a claim               | For the customer, with photos, video or receipt; coverage shown before submitting                                                                                                                                                          |
| DL07 | Warranty claims            | Progress tracker per claim; resolution and credit amount; view only                                                                                                                                                                        |
| HUB  | Registration channels      | Every entry point for this dealer/distributor: at the counter, bulk upload, website form (link and QR), email address, customer portal, partner API sample. Not shown to admin: partner keys are managed from A12 Integration log instead. |

### Customer (Web · phone layout)

| Code | Screen             | Must contain                                                                                                      |
| ---- | ------------------ | ----------------------------------------------------------------------------------------------------------------- |
| CU01 | Register a product | Opens from QR with serial, model and batch filled in; purchase date, place of purchase, receipt; Pending approval |
| CU02 | My products        | Card per product with serial, batch, status and countdown                                                         |
| CU03 | Product detail     | Warranty; certificate; File a claim                                                                               |
| CU04 | File a claim       | Pick product, issue type, description, photos; coverage shown before submitting                                   |
| CU05 | Claim tracking     | Submitted → In review → Approved → Closed (or Rejected with reason); outcome (repair, replacement serial, credit) |

### Visitor (no account)

| Code | Screen                | Must contain                                                                                                                      |
| ---- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| WEB  | Register your product | Scan QR label or enter model, serial, batch manually; purchase date, where bought, receipt, name, email, state, ZIP; confirmation |

## Workflows

Suggested running order: W1, W2, W6, W3, W4, W5, W7 (about 25 minutes).

### W1 – Dealer bulk registration

**Duration:** 5 min · **Roles:** Dealer, Admin  
**Goal:** A dealer registers a week's sales in one go; bad rows are caught; clean rows become warranties without admin effort.  
**Set-up:** `lonestar_sales_week38.xlsx`.

| #   | Role   | Screen                  | Action                                                                 | Expected result                                                             |
| --- | ------ | ----------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| 1   | Dealer | DL01 Dealer home        | Sign in as Lone Star.                                                  | Own numbers only; no admin menus.                                           |
| 2   | Dealer | DL02 Bulk import        | Download the template; upload the file.                                | 25 rows checked: 22 registered, 2 need fixing, 1 sent to the warranty desk. |
| 3   | Dealer | DL02 Bulk import        | Fix the model on row 8 and the date on row 20 inline; resubmit.        | 24 registered, 0 need fixing — no re-upload.                                |
| 4   | Dealer | DL04 Sold products      | Search `2635`.                                                         | 24 new products, Active, with batch numbers; 1-year warranty from purchase. |
| 5   | Admin  | A02 Registration inbox  | Filter Duplicates.                                                     | Only serial MG44-252811902 needs a human.                                   |
| 6   | Admin  | A03 Registration review | Compare with the existing record (James Nguyen); reject with a reason. | The duplicate check protects against double claims.                         |
| 7   | Admin  | A04 Registered products | Filter by dealer Lone Star.                                            | 31 products.                                                                |
| 8   | Admin  | A01 Admin dashboard     | Registrations by channel.                                              | Dealer bar +24.                                                             |
| 9   | Dealer | Notifications           | Open the bell.                                                         | Upload result: 22 registered, 2 to fix, 1 sent to the warranty desk.        |

### W2 – Customer self-registration by QR

**Duration:** 4 min · **Roles:** Customer (phone), Admin  
**Set-up:** QR label for `SM482V-261804517` (A05 → Print label, or `demo-assets/qr-samples`).

| #   | Role     | Screen                  | Action                                 | Expected result                                                     |
| --- | -------- | ----------------------- | -------------------------------------- | ------------------------------------------------------------------- |
| 1   | Customer | CU01 Register a product | Scan the label.                        | Serial, model (SM482V) and batch 2618-L02 filled in.                |
| 2   | Customer | CU01 Register a product | Purchase date, receipt photo, submit.  | Pending approval.                                                   |
| 3   | Admin    | A02 Registration inbox  | Open the inbox.                        | Customer portal badge, batch shown.                                 |
| 4   | Admin    | A03 Registration review | Receipt next to the data; approve.     | Warranty starts from the purchase date.                             |
| 5   | Admin    | A05 Product detail      | Open the product.                      | 1 year from purchase date, end date, days left; QR and certificate. |
| 6   | Admin    | A06 Product catalog     | Open SM482V.                           | 12-month warranty; serial and batch label format.                   |
| 7   | Customer | CU03 Product detail     | Download the certificate on the phone. | PDF with serial, batch and warranty dates.                          |

### W3 – Warranty claim settled by replacement (core workflow)

**Duration:** 5 min · **Roles:** Customer (phone), Admin  
**Set-up:** Marcus Reed's SC680 `SC680-251406233` is in warranty.

| #   | Role     | Screen              | Action                                                                | Expected result                                                                           |
| --- | -------- | ------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| 1   | Customer | CU04 File a claim   | Pick the SC680; see coverage; issue "Display problem"; photo; submit. | "In warranty until … The claim is covered." Claim Submitted.                              |
| 2   | Admin    | A09 Warranty claims | Open the list.                                                        | New claim counted under Submitted, source Customer.                                       |
| 3   | Admin    | A10 Claim detail    | Coverage when filed, evidence; Start review; Approve → Replace.       | Approved for replacement.                                                                 |
| 4   | Admin    | A10 Claim detail    | Close with replacement serial 263899901, batch 2638-L01.              | New product registered to Marcus with the rest of the warranty; original marked replaced. |
| 5   | Customer | CU05 Claim tracking | Open the claim and My products.                                       | Closed, "Replaced under warranty with 263899901"; notification.                           |

### W4 – Dealer claim settled by credit

**Duration:** 3 min · **Roles:** Dealer, Admin

| #   | Role   | Screen               | Action                                                                   | Expected result                                    |
| --- | ------ | -------------------- | ------------------------------------------------------------------------ | -------------------------------------------------- |
| 1   | Dealer | DL05 → DL06          | On MG44 `MG44-252811902`, File a claim: Bluetooth / Job Link connection. | Coverage shown; claim Submitted, source Dealer.    |
| 2   | Dealer | DL07 Warranty claims | Follow the claim.                                                        | Progress tracker; no decision buttons.             |
| 3   | Admin  | A10 Claim detail     | Start review; Approve → Credit $89.50; Close.                            | "Credit of $89.50 issued."                         |
| 4   | Admin  | A12 Integration log  | Open the latest Finance message.                                         | Outbound credit memo with the claim id and amount. |
| 5   | Dealer | DL07 Warranty claims | Back as dealer.                                                          | Credit, $89.50.                                    |

### W5 – Void warranty

**Duration:** 3 min · **Roles:** Admin, Customer (phone)  
**Set-up:** DR82 `DR82-252207119` has a note: opened by a third-party repair shop.

| #   | Role     | Screen              | Action                                                | Expected result                                  |
| --- | -------- | ------------------- | ----------------------------------------------------- | ------------------------------------------------ |
| 1   | Admin    | A05 Product detail  | Void warranty: Unauthorized repair, with a note.      | Reason, user and date recorded; History entry.   |
| 2   | Customer | CU03 Product detail | Open the product.                                     | Marked Void with the reason.                     |
| 3   | Customer | CU04 File a claim   | Try to file a claim on it.                            | Coverage: void, not covered — before submitting. |
| 4   | Admin    | A10 Claim detail    | Coverage when filed shows void; Reject with a reason. | Customer sees the decision.                      |

### W6 – Registration channels

**Duration:** 5 min · **Roles:** Admin, Visitor  
**Goal:** Registrations arrive from people and systems through one inbox; every exchange is logged.

| #   | Role    | Screen                    | Action                                                                                                | Expected result                                                           |
| --- | ------- | ------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| 1   | Admin   | A13 System events         | Distributor ERP invoice (3 serials), registration email with receipt, marketplace orders (2).         | ERP and email wait for review; marketplace orders are registered at once. |
| 2   | Visitor | WEB Register your product | Open `/register-product` (no account); scan the QR label or fill in manually; attach receipt; submit. | Confirmation; the registration waits for review.                          |
| 3   | Admin   | A02 Registration inbox    | Pending: Email, Web form, Distributor ERP badges; channel filter Marketplace.                         | One inbox for every channel.                                              |
| 4   | Admin   | A03 Registration review   | Approve the emailed registration (receipt read from the email).                                       | CRM update sent.                                                          |
| 5   | Admin   | A12 Integration log       | Add a partner system.                                                                                 | API key shown once; a registration sent with it is registered at once.    |
| 6   | Admin   | A12 Integration log       | Inbound ERP, email, partner; outbound CRM.                                                            | Payload view, retry.                                                      |
| 7   | Admin   | A01 Admin dashboard       | Channel chart.                                                                                        | Email +1, Marketplace +2.                                                 |

### W7 – Distributor oversight

**Duration:** 2 min · **Roles:** Admin, Distributor

| #   | Role        | Screen               | Action                                              | Expected result                           |
| --- | ----------- | -------------------- | --------------------------------------------------- | ----------------------------------------- |
| 1   | Admin       | A11 Dealers & users  | Gulf States with its two dealers.                   | Hierarchy set once by the admin.          |
| 2   | Distributor | DL01 Dealer home     | Totals for both dealers; dealer comparison.         | Sees across its network.                  |
| 3   | Distributor | DL01 Dealer home     | Filter Bayou Air Parts: registrations, open claims. | Spot dealers behind on registering sales. |
| 4   | Distributor | DL04 Sold products   | Filter to Bayou Air Parts.                          | –                                         |
| 5   | Distributor | DL07 Warranty claims | Open a claim.                                       | Only its dealers' claims; view only.      |

## Pre-demo checklist

1. Reset data (Admin → System events).
2. Open windows for Admin, Dealer, Distributor, Customer (phone), each signed in, plus a private window for the website form.
3. Keep `demo-assets/lonestar_sales_week38.xlsx` ready.
4. Print or show the QR label for `SM482V-261804517`.
5. Have a receipt photo ready on the phone.
6. Check the app opens over HTTPS on the phone (needed for the camera).

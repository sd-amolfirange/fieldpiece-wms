---
title: Registering a Fieldpiece product
audience: all
---

## Why register

Registering a product records its purchase date, which starts the warranty. An unregistered product has no warranty
dates (status Pending) and a claim on it cannot be covered until it is registered.

## Serial number and batch number

The serial number is printed on the product label and inside the QR code. In the portal it is shown as the model
code, a dash and the 9-digit number, for example SC680-251406233. The 9 digits are the build year and week
followed by a 5-digit sequence. You can type just the 9 digits: the model you pick is added in front
automatically. The batch number (production lot) looks like 2514-L01: build year and week, then the production line.
Serial numbers are not case sensitive and spaces are ignored.

## Register with an account (customers)

Sign in, open "Register a product", then either scan the QR label on the product with your phone camera ("Scan the
QR label") or type the model, serial number and batch number. Add the purchase date, where you bought it, and a
photo or PDF of the receipt, then choose "Register product". The registration goes to the Fieldpiece warranty desk
for review; you get a notification when it is approved.

## Register without an account (public website form)

On the sign-in page choose "Bought a Fieldpiece product? Register it", or open /register-product. Scan the QR
label or enter the model, serial, batch and purchase date, your name and email, and attach the receipt. Website
registrations are always reviewed by the warranty desk before the warranty starts.

## Dealers: register a sale

Dealers sign in and open "Register a sale" to register one product for a customer (model, serial, batch number,
purchase date and customer details). A clean dealer registration is approved at once. A serial that is already
registered is sent to the warranty desk for review.

## Dealers: bulk upload

Dealers can register many sales at once from an Excel (.xlsx) or CSV file under "Bulk upload". Download the template
first. Columns: serial, batch, model, purchase date, customer name, phone, email, city, state, ZIP and invoice.
The purchase date can be yyyy-mm-dd or mm/dd/yyyy. Every row is checked: clean rows are registered, rows with errors
(unknown model, invalid serial, missing or future purchase date) can be fixed inline and resubmitted, and rows whose
serial is already registered go to the warranty desk.

## Other ways registrations arrive

Registrations also come in from a distributor's ERP sales feed, from emails with the invoice attached sent to the
registration mailbox, from partners such as online marketplaces through the partner API, and from Fieldpiece's own
apps: Job Link (technicians register the probes and tools they use on the job) and Overwatch. Registrations from
the ERP feed and email are reviewed by the warranty desk; trusted partner registrations are approved at once
when they pass all checks. Registrations from Job Link and Overwatch are also approved at once when clean. Every
product shows which channel it was registered through ("Registered via").

## Common registration errors

- Unknown model: the model code is not in the Fieldpiece catalog. Check the label (for example SC680, not SC690).
- Invalid serial: the number doesn't match the label format for that model, or it starts with a different model's
  code.
- Already registered: that serial is registered to someone else. The warranty desk reviews it (it may be a
  duplicate or a typo).
- Future purchase date: the purchase date cannot be after today.
- Model mismatch: we know this label number under another model. The warranty desk checks which one is right.

## Registration statuses

- Pending: waiting for the warranty desk.
- Approved: registered; the warranty is active from the purchase date.
- Rejected: not registered; the reason is shown on the registration.

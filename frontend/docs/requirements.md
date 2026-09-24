HVAC Warranty Management Application – Requirements Summary

1. Purpose
   • A single application to manage HVAC products sold, their warranties (unit-level and part-level), service and repair work, warranty claims with manufacturers, inventory, warranty budget, and compliance.
   • Available as a web app (for office/admin) and a mobile app (for technicians and customers).
2. User Roles and Functionality
   Admin (Owner / Office Staff) – full control
   • View the complete dashboard: all units, warranty status, claims, budget, technician performance, revenue.
   • Manage the product and parts master (brands, models, parts, warranty periods).
   • Add sold units (manual, Excel import, or billing software sync) and link them to customers.
   • Manage customers and technicians; assign complaints to technicians.
   • Approve or reject warranty claims, submit claims to manufacturers, void warranties with a recorded reason.
   • Create AMC contracts, quotations, and bills for out-of-warranty work.
   • Set warranty budgets and monitor budget vs. actual.
   • Access all reports and exports.
   • Manage users, roles, access rights, reminder settings, and SMS/WhatsApp/email templates.
   Technician (Field Staff) – mainly mobile app, sees only assigned work
   • View assigned jobs with customer address, phone number, and map directions.
   • Scan unit QR/barcode to see unit and part-wise warranty status and service history.
   • Record new installations (serial number scan, installation date, photos, location), which starts the warranty.
   • Update jobs: problem found, work done, parts replaced (old and new serial numbers), before/after photos, refrigerant used.
   • See whether the job is free (under warranty) or chargeable, and show an estimate to the customer.
   • Capture customer digital signature or OTP confirmation.
   • Work offline and sync later.
   • Cannot change prices, approve claims, view other technicians' jobs, or access budgets, reports, or settings.
   Customer – sees only their own data
   • View their units with model, serial number, and location.
   • Check warranty status for each unit and part; download warranty certificates and invoices.
   • Register complaints with photos/videos and track their status.
   • Book preventive maintenance or service visits.
   • Receive reminders for warranty expiry, service due dates, and technician visits.
   • View and renew AMC, or buy extended warranty.
   • View service history and bills; rate technicians.
   • Self-register new products by uploading the invoice (subject to Admin approval).
   Permission Summary
   Functionality Admin Technician Customer
   Dashboard and reports Full Own jobs only Own units only
   Product/parts master setup Yes No No
   Add new unit Yes Yes (at installation) Registration request
   View warranty status All units Assigned units Own units
   Register complaint Yes Yes Yes
   Assign complaint Yes No No
   Job update / part replacement entry Yes Yes No
   Approve/reject claims Yes No No
   Void warranty Yes No No
   Billing and AMC Create Show estimate View and renew
   Warranty budget Full No access No access
   Users and settings Yes No No
3. Equipment / Asset Management
   • Record for every unit: brand, model, serial number, capacity (Ton/BTU), type (Split, VRF/VRV, Chiller, AHU, FCU, Package unit, etc.).
   • Installation date and location (site, building, floor, room).
   • Unit photo and QR code/barcode for instant lookup.
4. Product Master and Parts Structure
   • Product Master (model template): each model is predefined with its parts and the warranty period of each part, so selecting a model automatically attaches all parts and their warranties to a new unit.
   • Parent–child structure: the unit is the parent and its parts are children; key parts (compressor, PCB) have their own serial numbers.
   • Separate part warranties: for example, the unit may have 1 year, the compressor 10 years, and the PCB 5 years; the app shows each separately.
   • Part replacement history: records the old and new part serial numbers, replacement date, and the new part's warranty (either a fresh warranty or the remaining original period, configurable per brand).
   • Parts vs. labour coverage: clearly indicates whether parts, labour, or both are covered.
5. How Sales Data Enters the App
   • Integration with billing/accounting software (e.g., Tally, Zoho) so invoice data flows in automatically.
   • Technician entry at installation via barcode/QR scan (warranty usually starts from the installation date).
   • Bulk Excel import for existing historical data.
   • Manual entry through a form.
   • Customer self-registration by uploading the invoice.
6. Warranty Management
   • Store warranty start date, end date, and type (standard, extended, compressor, parts-only, labour-only).
   • Record which components are covered.
   • Upload warranty terms (with version), certificates, and invoices.
   • Status logic: Warranty end date = start date + warranty period; compared with today's date.
   • Status indicators:
   o 🟢 Active (with days remaining)
   o 🟡 Expiring soon (within 30/60 days)
   o 🔴 Expired
   o ⚪ Void (terms violated, e.g., unauthorized repair or missed servicing)
   • Instant status lookup by serial number or QR scan, for both the unit and each part.
7. Alerts and Reminders
   • Warranty expiry reminders 30/60/90 days in advance via SMS, email, WhatsApp, and app notification.
   • Extended warranty suggestions.
   • Preventive maintenance due reminders (often required to keep warranty valid).
   • Low stock, calibration due, certificate expiry, and budget threshold alerts.
8. Complaint, Repair, and Replacement Workflow
9. Complaint registered by the customer, call center, or Admin.
10. App checks unit and part warranty status automatically.
11. Technician visits and records the diagnosis with photos.
12. Repair (work done, time, consumables) or replacement (old and new part serial numbers; new part deducted from inventory; old part moved to defective stock).
13. Warranty claim is generated automatically with unit serial, part serial, failure reason, photos, job sheet, and customer signature.
14. Unit history is updated, including any new part warranty.
15. Warranty Claims and Settlement with Manufacturers
    What is tracked
    • Parts reimbursement or replacement (free part or credit note).
    • Labour charges per job as per the manufacturer's rate card.
    • Travel or visit charges, where applicable.
    • Defective part return: whether it was sent, courier docket number, and receipt by the company.
    • Claim rejections with reasons and re-submission.
    • RMA (Return Merchandise Authorization) numbers for companies that use them, such as US brands like Fieldpiece.
    Module features
    • Claim list and status by brand (Submitted → Approved → Paid / Rejected).
    • Company ledger showing how much is receivable from each brand.
    • Credit note and payment entries matched to claims (reconciliation).
    • Aging report for claims pending 30/60/90 days.
    • Monthly claim statements for each brand (Excel/PDF).
16. Inventory Management
    • Units for sale: stock by model and serial number; moved to the customer's account when sold (warranty starts).
    • Spare parts: stock, cost, and location (warehouse or technician's van).
    • Tools: which technician holds which tool, and calibration status.
    • Stock in (purchase) and stock out (used in jobs).
    • Minimum stock alerts for reordering.
    • Serial-number tracking for important parts.
    • Technician van stock.
    • Separation of warranty stock and paid stock (free parts from manufacturer vs. purchased parts).
    • Defective parts stock awaiting return to the manufacturer.
17. Warranty Budget and Cost Tracking
    • A warranty budget (warranty reserve/provision) is set aside from sales to cover expected warranty costs; for example, 2% of sales of ₹40,00,000 gives a budget of ₹80,000.
    • Important: the budget is for planning and monitoring only. A valid warranty claim cannot be refused because the budget is exhausted.
    • Actual costs include technician labour, travel, gas refilling, consumables, and claims rejected or delayed by the manufacturer.
    • Budget can be set by year/month, brand, or model (as a total amount, per unit, or percentage of sales).
    • Every warranty job cost is recorded and deducted from the budget automatically.
    • Dashboard shows budget, spent, remaining, and percentage used with a green/yellow/red progress bar.
    • Alerts at 75% and 90% budget usage.
    • Manufacturer recoveries are deducted to show the net warranty cost.
    • Analysis: average cost per unit, failure rate, costliest brand/model/part, and complaints linked to specific technicians' installations.
    • If the budget is exceeded: investigate repeat failures, installation quality, unsent claims, and adjust next year's budget or pricing.
    • Budget and cost data are visible only to the Admin.
18. AMC (Annual Maintenance Contract)
    • Create and renew AMC contracts.
    • Unlike warranty, AMC limits can be set by contract (e.g., 4 visits per year, parts free up to ₹5,000, beyond that chargeable).
19. Vendor / Dealer / Manufacturer Management
    • Contact details of manufacturers, dealers, installers, and service centers.
    • Link each unit to the responsible vendor.
    • Vendor performance: number of claims and resolution speed.
20. Compliance Module
    HVAC units (India)
    • BIS certification (Quality Control Order for ACs and certain parts such as compressors): license number and validity.
    • BEE star rating for room ACs: rating and validity.
    • Refrigerant rules (HCFC phase-out under the Montreal Protocol, HFC phase-down under the Kigali Amendment): refrigerant type, quantity charged, and recovery records.
    • E-Waste Management Rules 2022 (EPR): disposal records for replaced parts through authorized recyclers.
    Test tools (e.g., Fieldpiece, a US company based in California that makes HVAC/R test and measurement tools)
    • Electrical safety ratings (IEC 61010, CAT III/IV).
    • WPC approval for Bluetooth/wireless tools in India.
    • Calibration certificates (often NIST-traceable) and due dates.
    • Legal Metrology labelling for imported products (MRP, importer details).
    • US certifications such as UL/ETL and FCC, obtained from the distributor.
    • Manufacturer warranty policy, including coverage only through authorized distributors (grey-market products may be refused).
    General
    • Consumer Protection Act 2019: warranty terms must be clearly communicated.
    • Import documents (IEC code, Bill of Entry) where applicable.
    • GST-compliant invoices for paid work, AMC, and parts.
    • Customer data protection under the DPDP Act 2023 (secure storage, consent, role-based access).
    • Technician certifications (e.g., refrigerant handling) with expiry tracking.
    App features: certificate storage per model/tool, validity tracking, expiry alerts, refrigerant logging in jobs, e-waste disposal records, and warranty terms version linked to each unit.
    Note: compliance requirements should be confirmed with a CA, legal/compliance consultant, or the brand's Indian distributor.
21. Dashboard
    • Summary cards: total units, active warranties, expiring within 30 days, expired, open claims.
    • Urgent alerts: warranties expiring soon and service due.
    • Charts: warranty status breakdown, monthly claims, brand-wise breakdown.
    • Warranty budget card: budget vs. spent with progress bar (Admin only).
    • Recent activity: new claims, recent service visits, warranty updates.
    • Quick actions: add new unit, register claim, scan QR.
    • Every card is clickable to open the detailed list.
22. Reports
    • Warranty expiry, claims (open/closed), brand-wise and model-wise failures.
    • Maintenance and warranty cost (monthly/yearly), budget vs. actual.
    • Technician performance and revenue.
    • Claim settlement, company ledger, and aging.
    • Inventory and defective stock.
    • Export to Excel/PDF.
23. Document Management
    • Store invoices, warranty cards, installation reports, manuals, AMC agreements, certificates, and service reports in one place.
    • Search and filter by serial number, customer name, or site.
24. Technical Requirements
    • Mobile app (Android/iOS) and web app.
    • Offline mode with sync.
    • Cloud backup and data security.
    • Integration with ERP/accounting software (e.g., Tally).
    • Multi-language support (Marathi, Hindi, English).
    • Role-based access control.
25. Advanced / Optional Features
    • IoT sensors for live monitoring (temperature, current, running hours).
    • Maintenance alerts based on running hours.
    • Identification of frequently failing units to support replacement decisions.

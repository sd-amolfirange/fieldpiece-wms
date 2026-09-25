import {
  addDaysIso,
  buildUnitParts,
  entitlementFor,
  replacePart,
  type Brand,
  type Claim,
  type ClaimStatus,
  type Complaint,
  type ComplaintSource,
  type Customer,
  type Dealer,
  type Distributor,
  type IntegrationMessage,
  type IsoDate,
  type JobResult,
  type Model,
  type PartType,
  type Registration,
  type RegistrationChannel,
  type Unit,
  type User,
} from "@wms/domain";

// Demo data from frontend/docs/demo-workflows.md ("Seed data required" and "Demo logins"). Names, serials and
// phone numbers are fictional. The named units' dates follow their serials; the filler units are placed relative
// to `today`, so "expiring soon" and "active" hold whenever the demo runs. Admin -> Simulate -> Reset calls this
// again. Pure: builds the records in memory; seed.service.ts writes them.

/** Accounts offered on the sign-in page ("Sign in as"), in this order. */
export const DEMO_ACCOUNTS = [
  { email: "admin@demo.wms", label: "Admin: WMS office admin" },
  { email: "dealer.coolair@demo.wms", label: "Dealer: CoolAir Traders, Pune" },
  { email: "dist.northstar@demo.wms", label: "Distributor: NorthStar Distribution" },
  { email: "customer.rk@demo.wms", label: "Customer: R. Kulkarni" },
  { email: "dealer.breeze@demo.wms", label: "Dealer: Breeze Point, Nashik" },
] as const;

export interface SeedState {
  brands: Brand[];
  models: Model[];
  distributors: Distributor[];
  dealers: Dealer[];
  customers: Customer[];
  users: User[];
  units: Unit[];
  registrations: Registration[];
  complaints: Complaint[];
  jobResults: JobResult[];
  claims: Claim[];
  integrations: IntegrationMessage[];
  /** Last value used per id prefix (REG, CMP, ...), so the id sequences continue after the seed. */
  counters: Record<string, number>;
}

const ts = (date: IsoDate, time = "10:00:00") => `${date}T${time}.000Z`;

/** Model template from the workflows doc: unit 1 year, compressor 10 years, PCB 5 years. */
const AERIS_TEMPLATE: Model["parts"] = [
  { partType: "UNIT", warrantyMonths: 12, coversParts: true, coversLabour: true, serialised: false },
  { partType: "COMPRESSOR", warrantyMonths: 120, coversParts: true, coversLabour: false, serialised: true },
  { partType: "PCB", warrantyMonths: 60, coversParts: true, coversLabour: false, serialised: true },
];

export function createSeed(today: IsoDate): SeedState {
  const daysAgo = (days: number) => addDaysIso(today, -days);
  const counters: Record<string, number> = {};
  const nextId = (prefix: string) => {
    counters[prefix] = (counters[prefix] ?? 1000) + 1;
    return `${prefix}-${counters[prefix]}`;
  };

  const state: SeedState = {
    brands: [
      { id: "b-aer", name: "Aeris" },
      { id: "b-pol", name: "Polar Air" },
      { id: "b-kel", name: "Kelvin" },
    ],
    models: [
      { id: "m-aer-spl15", code: "AER-SPL15", brandId: "b-aer", name: "Aeris Split 1.5 TR", capacity: "1.5 TR", type: "Split", parts: AERIS_TEMPLATE },
      { id: "m-aer-spl18", code: "AER-SPL18", brandId: "b-aer", name: "Aeris Split 1.8 TR", capacity: "1.8 TR", type: "Split", parts: AERIS_TEMPLATE },
      {
        id: "m-pol-spl12",
        code: "POL-SPL12",
        brandId: "b-pol",
        name: "Polar Split 1.0 TR",
        capacity: "1.0 TR",
        type: "Split",
        parts: [
          { partType: "UNIT", warrantyMonths: 12, coversParts: true, coversLabour: true, serialised: false },
          { partType: "COMPRESSOR", warrantyMonths: 60, coversParts: true, coversLabour: false, serialised: true },
          { partType: "PCB", warrantyMonths: 36, coversParts: true, coversLabour: false, serialised: true },
        ],
      },
      {
        id: "m-kel-cas30",
        code: "KEL-CAS30",
        brandId: "b-kel",
        name: "Kelvin Cassette 2.5 TR",
        capacity: "2.5 TR",
        type: "Cassette",
        parts: [
          { partType: "UNIT", warrantyMonths: 24, coversParts: true, coversLabour: true, serialised: false },
          { partType: "COMPRESSOR", warrantyMonths: 84, coversParts: true, coversLabour: false, serialised: true },
          { partType: "PCB", warrantyMonths: 60, coversParts: true, coversLabour: false, serialised: true },
        ],
      },
    ],
    distributors: [{ id: "dist-northstar", name: "NorthStar Distribution", city: "Pune" }],
    dealers: [
      { id: "d-coolair", name: "CoolAir Traders", city: "Pune", distributorId: "dist-northstar" },
      { id: "d-breeze", name: "Breeze Point", city: "Nashik", distributorId: "dist-northstar" },
      { id: "d-arctic", name: "Arctic Home Solutions", city: "Mumbai" },
    ],
    customers: [
      { id: "c-rk", name: "R. Kulkarni", phone: "+91 90000 00101", email: "customer.rk@demo.wms", city: "Pune" },
      { id: "c-aj", name: "A. Joshi", phone: "+91 90000 00102", city: "Pune" },
      { id: "c-sd", name: "S. Deshpande", phone: "+91 90000 00103", city: "Pune" },
      { id: "c-kk", name: "K. Kale", phone: "+91 90000 00104", city: "Pune" },
      { id: "c-pm", name: "P. More", phone: "+91 90000 00105", city: "Pune" },
      { id: "c-mp", name: "M. Patil", phone: "+91 90000 00106", city: "Nashik" },
      { id: "c-sc", name: "Sunrise Clinic", phone: "+91 90000 00107", city: "Nashik" },
      { id: "c-np", name: "N. Pawar", phone: "+91 90000 00108", city: "Nashik" },
      { id: "c-rg", name: "R. Gite", phone: "+91 90000 00109", city: "Nashik" },
      { id: "c-hs", name: "H. Shah", phone: "+91 90000 00110", city: "Mumbai" },
      { id: "c-ho", name: "Harbour Offices", phone: "+91 90000 00111", city: "Mumbai" },
      { id: "c-vr", name: "V. Rao", phone: "+91 90000 00112", city: "Mumbai" },
      { id: "c-fk", name: "F. Khan", phone: "+91 90000 00113", city: "Mumbai" },
    ],
    users: [
      { id: "u-admin", name: "WMS office admin", email: "admin@demo.wms", role: "admin" },
      { id: "u-coolair", name: "CoolAir Traders", email: "dealer.coolair@demo.wms", role: "dealer", dealerId: "d-coolair" },
      { id: "u-breeze", name: "Breeze Point", email: "dealer.breeze@demo.wms", role: "dealer", dealerId: "d-breeze" },
      { id: "u-arctic", name: "Arctic Home Solutions", email: "dealer.arctic@demo.wms", role: "dealer", dealerId: "d-arctic" },
      {
        id: "u-northstar",
        name: "NorthStar Distribution",
        email: "dist.northstar@demo.wms",
        role: "distributor",
        distributorId: "dist-northstar",
      },
      { id: "u-rk", name: "R. Kulkarni", email: "customer.rk@demo.wms", role: "customer", customerId: "c-rk" },
    ],
    units: [],
    registrations: [],
    complaints: [],
    jobResults: [],
    claims: [],
    integrations: [],
    counters,
  };

  const model = (id: string) => state.models.find((m) => m.id === id)!;
  const dealerUser = (dealerId: string) => state.users.find((u) => u.dealerId === dealerId)!;

  function registerUnit(spec: {
    serial: string;
    modelId: string;
    dealerId: string;
    customerId: string;
    installDate: IsoDate;
    location: string;
    channel: RegistrationChannel;
  }): Unit {
    const m = model(spec.modelId);
    const customer = state.customers.find((c) => c.id === spec.customerId)!;
    const suffix = spec.serial.slice(-6);
    const submitter = spec.channel === "PORTAL" ? { id: customer.id, name: customer.name } : dealerUser(spec.dealerId);
    const registrationId = nextId("REG");
    state.registrations.push({
      id: registrationId,
      channel: spec.channel,
      status: "APPROVED",
      flags: [],
      serial: spec.serial,
      modelCode: m.code,
      customer: { name: customer.name, phone: customer.phone, city: customer.city },
      customerId: customer.id,
      dealerId: spec.dealerId,
      installDate: spec.installDate,
      purchaseDate: spec.installDate,
      attachmentIds: [],
      submittedBy: spec.channel === "ERP" || spec.channel === "EMAIL" ? "system" : submitter.id,
      submittedByName:
        spec.channel === "ERP" ? "ERP feed" : spec.channel === "EMAIL" ? "Registration mailbox" : submitter.name,
      submittedAt: ts(spec.installDate, "09:00:00"),
      reviewedByName: "WMS office admin",
      reviewedAt: ts(spec.installDate, "15:00:00"),
    });
    const unit: Unit = {
      serial: spec.serial,
      modelId: m.id,
      brandId: m.brandId,
      dealerId: spec.dealerId,
      customerId: customer.id,
      location: spec.location,
      installDate: spec.installDate,
      purchaseDate: spec.installDate,
      parts: buildUnitParts(m, spec.installDate, {
        idPrefix: spec.serial,
        serials: { COMPRESSOR: `CP-${suffix}`, PCB: `PCB-${suffix}` },
      }),
      registrationId,
      attachmentIds: [],
      history: [{ at: ts(spec.installDate, "15:00:00"), type: "registered", byName: "WMS office admin", refId: registrationId }],
    };
    state.units.push(unit);
    return unit;
  }

  // Named units from the workflows doc.
  // New unit with a printable QR label; the customer self-registers it in W2 (not registered yet).
  state.units.push({
    serial: "AER-SPL15-240917",
    modelId: "m-aer-spl15",
    brandId: "b-aer",
    dealerId: "d-coolair",
    parts: [],
    attachmentIds: [],
    history: [{ at: ts(daysAgo(10)), type: "note", byName: "CoolAir Traders", text: "Sold, QR label printed" }],
  });
  // Unit warranty expired, compressor covered until 2031 (W3).
  registerUnit({
    serial: "AER-SPL15-210311",
    modelId: "m-aer-spl15",
    dealerId: "d-coolair",
    customerId: "c-rk",
    installDate: "2021-03-11",
    location: "Kothrud, Pune: living room",
    channel: "DEALER",
  });
  // Has an unauthorised-repair note, used for voiding (W5).
  const voidCandidate = registerUnit({
    serial: "AER-SPL18-230502",
    modelId: "m-aer-spl18",
    dealerId: "d-coolair",
    customerId: "c-rk",
    installDate: "2023-05-02",
    location: "Kothrud, Pune: bedroom",
    channel: "DEALER",
  });
  voidCandidate.history.push({
    at: ts(daysAgo(20)),
    type: "note",
    byName: "WMS office admin",
    text: "Unauthorised repair: PCB cover opened by a local technician, warranty seal broken.",
  });

  // Filler units. CoolAir Traders (Pune):
  registerUnit({ serial: "AER-SPL18-251120", modelId: "m-aer-spl18", dealerId: "d-coolair", customerId: "c-aj", installDate: daysAgo(120), location: "Baner, Pune", channel: "DEALER" });
  registerUnit({ serial: "AER-SPL15-250301", modelId: "m-aer-spl15", dealerId: "d-coolair", customerId: "c-sd", installDate: daysAgo(200), location: "Aundh, Pune", channel: "BULK" });
  registerUnit({ serial: "AER-SPL15-250912", modelId: "m-aer-spl15", dealerId: "d-coolair", customerId: "c-kk", installDate: daysAgo(355), location: "Hadapsar, Pune", channel: "DEALER" });
  registerUnit({ serial: "POL-SPL12-240605", modelId: "m-pol-spl12", dealerId: "d-coolair", customerId: "c-pm", installDate: daysAgo(800), location: "Wakad, Pune", channel: "DEALER" });
  // Breeze Point (Nashik):
  registerUnit({ serial: "AER-SPL15-250418", modelId: "m-aer-spl15", dealerId: "d-breeze", customerId: "c-mp", installDate: daysAgo(160), location: "College Road, Nashik", channel: "PORTAL" });
  registerUnit({ serial: "KEL-CAS30-240220", modelId: "m-kel-cas30", dealerId: "d-breeze", customerId: "c-sc", installDate: daysAgo(580), location: "Sunrise Clinic, Nashik: reception", channel: "ERP" });
  registerUnit({ serial: "AER-SPL18-250805", modelId: "m-aer-spl18", dealerId: "d-breeze", customerId: "c-np", installDate: daysAgo(340), location: "Indira Nagar, Nashik", channel: "EMAIL" });
  registerUnit({ serial: "POL-SPL12-230910", modelId: "m-pol-spl12", dealerId: "d-breeze", customerId: "c-rg", installDate: daysAgo(1100), location: "Panchavati, Nashik", channel: "DEALER" });
  // Arctic Home Solutions (Mumbai, no distributor):
  registerUnit({ serial: "AER-SPL15-251002", modelId: "m-aer-spl15", dealerId: "d-arctic", customerId: "c-hs", installDate: daysAgo(90), location: "Andheri, Mumbai", channel: "DEALER" });
  registerUnit({ serial: "KEL-CAS30-230115", modelId: "m-kel-cas30", dealerId: "d-arctic", customerId: "c-ho", installDate: daysAgo(990), location: "Harbour Offices, Mumbai: 3rd floor", channel: "ERP" });
  registerUnit({ serial: "POL-SPL12-250720", modelId: "m-pol-spl12", dealerId: "d-arctic", customerId: "c-vr", installDate: daysAgo(60), location: "Powai, Mumbai", channel: "PORTAL" });
  registerUnit({ serial: "AER-SPL18-240110", modelId: "m-aer-spl18", dealerId: "d-arctic", customerId: "c-fk", installDate: daysAgo(620), location: "Bandra, Mumbai", channel: "EMAIL" });

  // Complaint and claim history.
  function message(partial: Omit<IntegrationMessage, "id" | "attempts" | "createdAt" | "updatedAt"> & { at: string }) {
    const { at, ...rest } = partial;
    state.integrations.push({ id: nextId("MSG"), attempts: 1, createdAt: at, updatedAt: at, ...rest });
  }

  function history(spec: {
    serial: string;
    source: ComplaintSource;
    raisedDaysAgo: number;
    description: string;
    replaced?: { partType: PartType; daysAgo: number };
    claim?: { status: ClaimStatus; amount: number; rmaNumber?: string; rejectReason?: string };
  }) {
    const unit = state.units.find((u) => u.serial === spec.serial)!;
    const m = model(unit.modelId);
    const customer = state.customers.find((c) => c.id === unit.customerId)!;
    const raised = daysAgo(spec.raisedDaysAgo);
    const complaintId = nextId("CMP");
    const raisedBy = spec.source === "DEALER" ? dealerUser(unit.dealerId!) : { id: "u-admin", name: "WMS office admin" };
    const serviceRequestId = nextId("SR");

    message({
      system: "SERVICE",
      direction: "OUT",
      type: "service_request",
      status: "SUCCESS",
      refId: complaintId,
      payload: { serviceRequestId, complaintId, unitSerial: unit.serial },
      at: ts(raised, "11:00:00"),
    });

    const complaint: Complaint = {
      id: complaintId,
      unitSerial: unit.serial,
      source: spec.source,
      raisedBy: raisedBy.id,
      raisedByName: spec.source === "CUSTOMER" ? customer.name : raisedBy.name,
      dealerId: unit.dealerId,
      customerId: unit.customerId,
      description: spec.description,
      attachmentIds: [],
      status: spec.replaced ? "RESOLVED" : "WITH_SERVICE",
      entitlement: entitlementFor(unit, raised),
      serviceRequestId,
      createdAt: ts(raised),
      history: [
        { at: ts(raised), status: "NEW", byName: spec.source === "CUSTOMER" ? customer.name : raisedBy.name },
        { at: ts(raised, "11:00:00"), status: "WITH_SERVICE", byName: "WMS office admin" },
      ],
    };
    unit.history.push({ at: ts(raised), type: "complaint_raised", byName: complaint.raisedByName, refId: complaintId });
    state.complaints.push(complaint);

    if (!spec.replaced) return;
    const fixed = daysAgo(spec.replaced.daysAgo);
    const line = m.parts.find((p) => p.partType === spec.replaced!.partType)!;
    const old = unit.parts.find((p) => p.partType === line.partType && !p.replacedAt);
    const newSerial = `${line.partType === "PCB" ? "PCB" : "CP"}-R${fixed.replace(/-/g, "").slice(2)}`;
    unit.parts = replacePart(unit.parts, line, {
      newSerial,
      date: fixed,
      newId: `${unit.serial}-${line.partType.toLowerCase()}-r1`,
    });
    unit.history.push({
      at: ts(fixed, "16:00:00"),
      type: "part_replaced",
      byName: "Service partner",
      text: `${line.partType}: ${old?.serial ?? "-"} -> ${newSerial}`,
    });

    const jobId = nextId("JOB");
    const partsReplaced = [{ partType: line.partType, oldSerial: old?.serial, newSerial }];
    state.jobResults.push({
      id: jobId,
      complaintId,
      technician: "S. Pawar (CoolFix Services)",
      completedAt: ts(fixed, "16:00:00"),
      partsReplaced,
      photoIds: [],
      signOffName: customer.name,
      notes: "Part replaced and unit tested: cooling normal.",
    });
    message({
      system: "SERVICE",
      direction: "IN",
      type: "job_result",
      status: "SUCCESS",
      refId: complaintId,
      payload: { jobId, complaintId, partsReplaced },
      at: ts(fixed, "16:05:00"),
    });
    complaint.jobResultId = jobId;
    complaint.history.push({ at: ts(fixed, "16:05:00"), status: "RESOLVED", byName: "Service partner" });

    if (!spec.claim || !complaint.entitlement.claimable) return;
    const claimId = nextId("CLM");
    const claim: Claim = {
      id: claimId,
      complaintId,
      unitSerial: unit.serial,
      brandId: unit.brandId,
      dealerId: unit.dealerId,
      status: spec.claim.status,
      rmaNumber: spec.claim.rmaNumber,
      amount: spec.claim.amount,
      jobResultId: jobId,
      photoIds: [],
      partsReplaced,
      financePosting: spec.claim.status === "PAID" ? "POSTED" : "NOT_POSTED",
      rejectReason: spec.claim.rejectReason,
      createdAt: ts(fixed, "16:10:00"),
      updatedAt: ts(addDaysIso(fixed, 5)),
      history: [{ at: ts(fixed, "16:10:00"), status: "DRAFT", byName: "System" }],
    };
    const submitted = addDaysIso(fixed, 1);
    if (spec.claim.status !== "DRAFT") {
      claim.history.push({ at: ts(submitted), status: "SUBMITTED", byName: "WMS office admin" });
      message({
        system: "OEM",
        direction: "OUT",
        type: "claim_submission",
        status: "SUCCESS",
        refId: claimId,
        payload: { claimId, brandId: unit.brandId, amount: spec.claim.amount, rmaNumber: spec.claim.rmaNumber },
        at: ts(submitted, "10:30:00"),
      });
    }
    if (spec.claim.status === "APPROVED" || spec.claim.status === "PAID" || spec.claim.status === "REJECTED") {
      const decided = addDaysIso(fixed, 4);
      const decision = spec.claim.status === "REJECTED" ? "REJECTED" : "APPROVED";
      claim.history.push({ at: ts(decided), status: decision, byName: "OEM", text: spec.claim.rejectReason });
      message({
        system: "OEM",
        direction: "IN",
        type: "oem_decision",
        status: "SUCCESS",
        refId: claimId,
        payload: { claimId, decision, reason: spec.claim.rejectReason },
        at: ts(decided),
      });
    }
    if (spec.claim.status === "PAID") {
      const paid = addDaysIso(fixed, 5);
      claim.history.push({ at: ts(paid), status: "PAID", byName: "WMS office admin" });
      message({
        system: "FINANCE",
        direction: "OUT",
        type: "finance_posting",
        status: "SUCCESS",
        refId: claimId,
        payload: { claimId, amount: spec.claim.amount, account: "Warranty recoveries" },
        at: ts(paid, "12:00:00"),
      });
    }
    unit.history.push({ at: claim.createdAt, type: "claim_created", byName: "System", refId: claimId });
    complaint.claimId = claimId;
    state.claims.push(claim);
  }

  history({
    serial: "POL-SPL12-240605",
    source: "DEALER",
    raisedDaysAgo: 40,
    description: "Compressor noisy and not cooling.",
    replaced: { partType: "COMPRESSOR", daysAgo: 35 },
    claim: { status: "PAID", amount: 5400 },
  });
  history({
    serial: "KEL-CAS30-240220",
    source: "ADMIN",
    raisedDaysAgo: 25,
    description: "Display blank, unit not starting.",
    replaced: { partType: "PCB", daysAgo: 20 },
    claim: { status: "SUBMITTED", amount: 12800, rmaNumber: "KEL-RMA-55210" },
  });
  history({
    serial: "AER-SPL15-250418",
    source: "DEALER",
    raisedDaysAgo: 30,
    description: "Unit switches off randomly.",
    replaced: { partType: "PCB", daysAgo: 27 },
    claim: { status: "APPROVED", amount: 6500, rmaNumber: "AER-RMA-10233" },
  });
  history({
    serial: "KEL-CAS30-230115",
    source: "ADMIN",
    raisedDaysAgo: 70,
    description: "Compressor tripping on overload.",
    replaced: { partType: "COMPRESSOR", daysAgo: 64 },
    claim: { status: "REJECTED", amount: 18200, rejectReason: "Installation not done by an authorised installer." },
  });
  history({
    serial: "AER-SPL18-240110",
    source: "DEALER",
    raisedDaysAgo: 100,
    description: "No cooling, compressor not starting.",
    replaced: { partType: "COMPRESSOR", daysAgo: 95 },
    claim: { status: "PAID", amount: 7200, rmaNumber: "AER-RMA-09871" },
  });
  history({
    serial: "AER-SPL15-251002",
    source: "DEALER",
    raisedDaysAgo: 6,
    description: "Unit trips after about 10 minutes of running.",
  });

  // One open complaint straight from a customer, not yet sent to service.
  {
    const unit = state.units.find((u) => u.serial === "AER-SPL18-250805")!;
    const raised = daysAgo(3);
    const id = nextId("CMP");
    state.complaints.push({
      id,
      unitSerial: unit.serial,
      source: "CUSTOMER",
      raisedBy: "c-np",
      raisedByName: "N. Pawar",
      dealerId: unit.dealerId,
      customerId: unit.customerId,
      description: "Water dripping from the indoor unit.",
      attachmentIds: [],
      status: "NEW",
      entitlement: entitlementFor(unit, raised),
      createdAt: ts(raised),
      history: [{ at: ts(raised), status: "NEW", byName: "N. Pawar" }],
    });
    unit.history.push({ at: ts(raised), type: "complaint_raised", byName: "N. Pawar", refId: id });
  }

  // Integration log: an ERP feed and a failed CRM update that can be retried.
  const erpRegistration = state.registrations.find((r) => r.serial === "KEL-CAS30-240220")!;
  message({
    system: "ERP",
    direction: "IN",
    type: "erp_invoice",
    status: "SUCCESS",
    refId: erpRegistration.id,
    payload: { invoice: "INV-24-0220", serials: ["KEL-CAS30-240220"] },
    at: ts(daysAgo(580), "08:30:00"),
  });
  message({
    system: "CRM",
    direction: "OUT",
    type: "crm_update",
    status: "FAILED",
    lastError: "CRM did not respond within 30 s.",
    refId: "c-vr",
    payload: { customerId: "c-vr", units: ["POL-SPL12-250720"] },
    at: ts(daysAgo(60), "15:05:00"),
  });

  return state;
}

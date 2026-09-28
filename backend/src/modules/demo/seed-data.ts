import {
  addDaysIso,
  coverageFor,
  DEFAULT_BATCH_PATTERN,
  DEFAULT_SERIAL_PATTERN,
  warrantyEndFor,
  type ClaimSource,
  type ClaimStatus,
  type Customer,
  type Dealer,
  type Distributor,
  type IntegrationMessage,
  type IsoDate,
  type IssueType,
  type Model,
  type ProductCategory,
  type Registration,
  type RegistrationChannel,
  type Resolution,
  type Unit,
  type User,
  type WarrantyClaim,
} from "@wms/domain";

// Starting data for the Fieldpiece warranty system (frontend/docs/demo-workflows.md).
// - Products: real Fieldpiece models and categories from fieldpiece.com (checked 2026-09-28), with Fieldpiece's
//   published term: "All of our products have a 1 year warranty from date of purchase."
// - People and companies: fictional, in the United States. Phone numbers use the 555-01xx range reserved for
//   fiction; emails use example.com.
// - Serial and batch numbers: the assumed label format (yy + ww + 5-digit sequence; yyww-L + line). [CONFIRM]
// Named products keep fixed serials (so printed QR labels stay valid); purchase dates are placed relative to `today`,
// so "expiring soon", "active" and "expired" hold whenever the data is loaded. Pure: seed-writer.ts writes it.

/** Accounts offered on the sign-in page ("Sign in as"), in this order. */
export const DEMO_ACCOUNTS = [
  { email: "admin@wms.local", label: "Admin: Fieldpiece warranty desk" },
  { email: "dealer.lonestar@wms.local", label: "Dealer: Lone Star Refrigeration Supply, Houston TX" },
  { email: "dist.gulfstates@wms.local", label: "Distributor: Gulf States HVAC Distribution" },
  { email: "customer.mreed@wms.local", label: "Customer: Marcus Reed" },
  { email: "dealer.bayou@wms.local", label: "Dealer: Bayou Air Parts, Baton Rouge LA" },
] as const;

/** Partner systems with known API keys, for trying the partner API against starting data. Never used in production. */
export const DEMO_PARTNER_KEYS = {
  "pc-desertpeak-pos": "fpk_seed_desertpeak_pos_7Qm2Xv9LwR4t",
  "pc-marketplace": "fpk_seed_marketplace_4Hs8Tn3KpZ6c",
} as const;

export interface SeedPartnerClient {
  id: keyof typeof DEMO_PARTNER_KEYS;
  name: string;
  channel: "API" | "RETAIL" | "ERP";
  dealerId?: string;
}

export interface SeedState {
  categories: ProductCategory[];
  models: Model[];
  distributors: Distributor[];
  dealers: Dealer[];
  customers: Customer[];
  users: User[];
  units: Unit[];
  registrations: Registration[];
  claims: WarrantyClaim[];
  integrations: IntegrationMessage[];
  partnerClients: SeedPartnerClient[];
  /** Last value used per id prefix (REG, CLM, MSG, ...), so the id sequences continue after the seed. */
  counters: Record<string, number>;
}

const ts = (date: IsoDate, time = "10:00:00") => `${date}T${time}.000Z`;

// Model codes with a real product photo saved to frontend/public/products/<code>.png (Fieldpiece's own image,
// kept for internal demo use — see demo-assets/product-images/SOURCES.md for provenance). A code left out here
// shows a placeholder icon instead of a broken image.
const PRODUCT_IMAGES = new Set<string>([
  "SC680",
  "SC480",
  "SC260",
  "SM482V",
  "SM382V",
  "JL3KH6",
  "VP87",
  "MR45",
  "MG44",
  "DR82",
  "SRS1",
  "STA2",
]);

// Product photos are Fieldpiece's own, saved under frontend/public/products/<code>.png for local demo use
// (see demo-assets/product-images/SOURCES.md for where each came from). A model with no image on disk falls
// back to a placeholder icon in the UI.
const model = (code: string, categoryId: string, name: string, description: string): Model => ({
  id: `m-${code.toLowerCase()}`,
  code,
  categoryId,
  name,
  description,
  imageUrl: PRODUCT_IMAGES.has(code) ? `/products/${code}.png` : undefined,
  warrantyMonths: 12,
  serialPattern: DEFAULT_SERIAL_PATTERN,
  batchPattern: DEFAULT_BATCH_PATTERN,
});

export function createSeed(today: IsoDate): SeedState {
  const daysAgo = (days: number) => addDaysIso(today, -days);
  const counters: Record<string, number> = {};
  const nextId = (prefix: string) => {
    counters[prefix] = (counters[prefix] ?? 1000) + 1;
    return `${prefix}-${counters[prefix]}`;
  };

  const state: SeedState = {
    categories: [
      { id: "cat-clamp", name: "Clamp meters" },
      { id: "cat-manifold", name: "Digital manifolds" },
      { id: "cat-joblink", name: "Job Link probes" },
      { id: "cat-vacuum", name: "Vacuum and recovery" },
      { id: "cat-leak", name: "Leak detectors" },
      { id: "cat-scale", name: "Refrigerant scales" },
      { id: "cat-airflow", name: "Airflow and temperature" },
    ],
    models: [
      model(
        "SC680",
        "cat-clamp",
        "Swivel Head Wireless Clamp Meter",
        "600A AC/DC swivel head clamp meter with Job Link wireless",
      ),
      model(
        "SC480",
        "cat-clamp",
        "Wireless Clamp Meter",
        "600A AC dual display power clamp meter with Job Link wireless",
      ),
      model("SC260", "cat-clamp", "Compact Clamp Meter", "400A compact True RMS clamp meter"),
      model(
        "SM482V",
        "cat-manifold",
        "SMAN Wireless 4-Port Digital Manifold",
        "4-port refrigerant manifold with built-in vacuum sensor",
      ),
      model(
        "SM382V",
        "cat-manifold",
        "SMAN Wireless 3-Port Digital Manifold",
        "3-port refrigerant manifold with built-in vacuum sensor",
      ),
      model(
        "JL3KH6",
        "cat-joblink",
        "Job Link Probes Charging and Air Kit",
        "Six wireless probes for charging and airflow",
      ),
      model(
        "VP87",
        "cat-vacuum",
        "8 CFM Vacuum Pump",
        "8 CFM vacuum pump, 15 micron ultimate vacuum, RunQuick oil change",
      ),
      model("MR45", "cat-vacuum", "Digital Recovery Machine", "Refrigerant recovery machine"),
      model("MG44", "cat-vacuum", "Wireless Micron Vacuum Gauge", "Wireless micron gauge with Job Link"),
      model("DR82", "cat-leak", "Infrared Refrigerant Leak Detector", "Infrared refrigerant leak detector"),
      model("SRS1", "cat-scale", "Refrigerant Scale", "Residential and light commercial refrigerant scale"),
      model("STA2", "cat-airflow", "In-Duct Hot Wire Anemometer", "In-duct hot wire anemometer"),
    ],
    distributors: [
      { id: "dist-gulfstates", name: "Gulf States HVAC Distribution", city: "Dallas", state: "TX" },
    ],
    dealers: [
      {
        id: "d-lonestar",
        name: "Lone Star Refrigeration Supply",
        city: "Houston",
        state: "TX",
        distributorId: "dist-gulfstates",
      },
      {
        id: "d-bayou",
        name: "Bayou Air Parts",
        city: "Baton Rouge",
        state: "LA",
        distributorId: "dist-gulfstates",
      },
      { id: "d-desertpeak", name: "Desert Peak HVAC Supply", city: "Phoenix", state: "AZ" },
    ],
    customers: [
      {
        id: "c-mreed",
        name: "Marcus Reed",
        phone: "(713) 555-0142",
        email: "marcus.reed@example.com",
        city: "Houston",
        state: "TX",
        zip: "77008",
      },
      {
        id: "c-aparker",
        name: "Alicia Parker",
        phone: "(713) 555-0117",
        city: "Katy",
        state: "TX",
        zip: "77494",
      },
      {
        id: "c-jnguyen",
        name: "James Nguyen",
        phone: "(281) 555-0163",
        city: "Sugar Land",
        state: "TX",
        zip: "77479",
      },
      {
        id: "c-tbrooks",
        name: "Tanya Brooks",
        phone: "(832) 555-0129",
        email: "tanya.brooks@example.com",
        city: "Houston",
        state: "TX",
        zip: "77019",
      },
      {
        id: "c-dmorales",
        name: "Diego Morales",
        phone: "(225) 555-0184",
        city: "Baton Rouge",
        state: "LA",
        zip: "70808",
      },
      {
        id: "c-kfontenot",
        name: "Kyle Fontenot",
        phone: "(337) 555-0156",
        city: "Lafayette",
        state: "LA",
        zip: "70503",
      },
      {
        id: "c-rcarter",
        name: "Renee Carter",
        phone: "(504) 555-0171",
        email: "renee.carter@example.com",
        city: "Metairie",
        state: "LA",
        zip: "70001",
      },
      {
        id: "c-bwalker",
        name: "Brian Walker",
        phone: "(602) 555-0138",
        city: "Phoenix",
        state: "AZ",
        zip: "85016",
      },
      {
        id: "c-lhernandez",
        name: "Lucia Hernandez",
        phone: "(480) 555-0192",
        city: "Mesa",
        state: "AZ",
        zip: "85201",
      },
      {
        id: "c-smitchell",
        name: "Scott Mitchell",
        phone: "(520) 555-0145",
        city: "Tucson",
        state: "AZ",
        zip: "85719",
      },
      {
        id: "c-comfortpro",
        name: "ComfortPro Mechanical LLC",
        phone: "(602) 555-0110",
        email: "service@comfortpro.example.com",
        city: "Tempe",
        state: "AZ",
        zip: "85281",
      },
    ],
    users: [
      { id: "u-admin", name: "Warranty Desk", email: "admin@wms.local", role: "admin" },
      {
        id: "u-lonestar",
        name: "Lone Star Refrigeration Supply",
        email: "dealer.lonestar@wms.local",
        role: "dealer",
        dealerId: "d-lonestar",
      },
      {
        id: "u-bayou",
        name: "Bayou Air Parts",
        email: "dealer.bayou@wms.local",
        role: "dealer",
        dealerId: "d-bayou",
      },
      {
        id: "u-desertpeak",
        name: "Desert Peak HVAC Supply",
        email: "dealer.desertpeak@wms.local",
        role: "dealer",
        dealerId: "d-desertpeak",
      },
      {
        id: "u-gulfstates",
        name: "Gulf States HVAC Distribution",
        email: "dist.gulfstates@wms.local",
        role: "distributor",
        distributorId: "dist-gulfstates",
      },
      {
        id: "u-mreed",
        name: "Marcus Reed",
        email: "customer.mreed@wms.local",
        role: "customer",
        customerId: "c-mreed",
      },
    ],
    units: [],
    registrations: [],
    claims: [],
    integrations: [],
    partnerClients: [
      {
        id: "pc-desertpeak-pos",
        name: "Desert Peak HVAC Supply (point of sale)",
        channel: "API",
        dealerId: "d-desertpeak",
      },
      { id: "pc-marketplace", name: "Online marketplace", channel: "RETAIL" },
    ],
    counters,
  };

  const modelByCode = (code: string) => state.models.find((m) => m.code === code)!;
  const dealerUser = (dealerId: string) => state.users.find((u) => u.dealerId === dealerId)!;
  const unitBySerial = (serial: string) => state.units.find((u) => u.serial === serial)!;

  function message(
    partial: Omit<IntegrationMessage, "id" | "attempts" | "createdAt" | "updatedAt"> & { at: string },
  ) {
    const { at, ...rest } = partial;
    state.integrations.push({ id: nextId("MSG"), attempts: 1, createdAt: at, updatedAt: at, ...rest });
  }

  function register(spec: {
    serial: string;
    batchNumber: string;
    model: string;
    dealerId: string;
    customerId: string;
    purchasedDaysAgo: number;
    channel: RegistrationChannel;
    placeOfPurchase?: string;
  }): Unit {
    const m = modelByCode(spec.model);
    const customer = state.customers.find((c) => c.id === spec.customerId)!;
    const purchaseDate = daysAgo(spec.purchasedDaysAgo);
    const submitted = addDaysIso(
      purchaseDate,
      spec.channel === "WEB" || spec.channel === "EMAIL" || spec.channel === "PORTAL" ? 3 : 0,
    );
    const submitter =
      spec.channel === "PORTAL" || spec.channel === "WEB"
        ? {
            id: spec.channel === "WEB" ? "public" : customer.id,
            name: spec.channel === "WEB" ? `Web form: ${customer.name}` : customer.name,
          }
        : spec.channel === "EMAIL"
          ? { id: "system", name: `Email from ${customer.email ?? "customer"}` }
          : spec.channel === "ERP"
            ? { id: "system", name: "ERP sales feed" }
            : spec.channel === "API"
              ? { id: "partner:pc-desertpeak-pos", name: "Desert Peak HVAC Supply (point of sale)" }
              : spec.channel === "RETAIL"
                ? { id: "partner:pc-marketplace", name: "Online marketplace" }
                : dealerUser(spec.dealerId);
    const autoApproved =
      spec.channel === "DEALER" ||
      spec.channel === "BULK" ||
      spec.channel === "API" ||
      spec.channel === "RETAIL";
    const registrationId = nextId("REG");
    state.registrations.push({
      id: registrationId,
      channel: spec.channel,
      status: "APPROVED",
      flags: [],
      serial: spec.serial,
      batchNumber: spec.batchNumber,
      modelCode: m.code,
      customer: {
        name: customer.name,
        phone: customer.phone,
        email: customer.email,
        city: customer.city,
        state: customer.state,
        zip: customer.zip,
      },
      customerId: customer.id,
      dealerId: spec.dealerId,
      purchaseDate,
      placeOfPurchase: spec.placeOfPurchase,
      attachmentIds: [],
      submittedBy: submitter.id,
      submittedByName: submitter.name,
      submittedAt: ts(submitted, "09:00:00"),
      reviewedByName: autoApproved
        ? `Auto-approved (${spec.channel === "BULK" ? "dealer bulk upload" : submitter.name})`
        : "Warranty Desk",
      reviewedAt: ts(submitted, autoApproved ? "09:00:05" : "15:00:00"),
    });
    const unit: Unit = {
      serial: spec.serial,
      batchNumber: spec.batchNumber,
      modelId: m.id,
      dealerId: spec.dealerId,
      customerId: customer.id,
      purchaseDate,
      placeOfPurchase: spec.placeOfPurchase,
      warrantyStart: purchaseDate,
      warrantyEnd: warrantyEndFor(purchaseDate, m.warrantyMonths),
      registrationId,
      attachmentIds: [],
      history: [
        { at: ts(submitted, "15:00:00"), type: "registered", byName: "Warranty Desk", refId: registrationId },
      ],
    };
    state.units.push(unit);
    return unit;
  }

  // ── Named products ──────────────────────────────────────────────────────────
  // Shipped to Lone Star on an ERP invoice and not registered yet: the customer registers it from the QR label (W2).
  state.units.push({
    serial: "261804517",
    batchNumber: "2618-L02",
    modelId: "m-sm482v",
    dealerId: "d-lonestar",
    attachmentIds: [],
    history: [
      {
        at: ts(daysAgo(12)),
        type: "note",
        byName: "ERP sales feed",
        text: "Shipped to Lone Star Refrigeration Supply on invoice GS-240517",
      },
    ],
  });
  // Marcus Reed (customer login): an active clamp meter, an expired vacuum pump, a leak detector opened by a
  // third party (voided in W5).
  register({
    serial: "251406233",
    batchNumber: "2514-L01",
    model: "SC680",
    dealerId: "d-lonestar",
    customerId: "c-mreed",
    purchasedDaysAgo: 320,
    channel: "DEALER",
  });
  register({
    serial: "243208841",
    batchNumber: "2432-L03",
    model: "VP87",
    dealerId: "d-lonestar",
    customerId: "c-mreed",
    purchasedDaysAgo: 410,
    channel: "DEALER",
  });
  const voidCandidate = register({
    serial: "252207119",
    batchNumber: "2522-L01",
    model: "DR82",
    dealerId: "d-lonestar",
    customerId: "c-mreed",
    purchasedDaysAgo: 150,
    channel: "PORTAL",
  });
  voidCandidate.history.push({
    at: ts(daysAgo(20)),
    type: "note",
    byName: "Warranty Desk",
    text: "Sensor housing opened and resealed by a third-party repair shop; tamper label broken.",
  });

  // ── Other registered products ───────────────────────────────────────────────
  register({
    serial: "252510384",
    batchNumber: "2525-L02",
    model: "SC480",
    dealerId: "d-lonestar",
    customerId: "c-aparker",
    purchasedDaysAgo: 200,
    channel: "BULK",
  });
  register({
    serial: "252811902",
    batchNumber: "2528-L01",
    model: "MG44",
    dealerId: "d-lonestar",
    customerId: "c-jnguyen",
    purchasedDaysAgo: 95,
    channel: "DEALER",
  });
  register({
    serial: "251902645",
    batchNumber: "2519-L03",
    model: "MR45",
    dealerId: "d-lonestar",
    customerId: "c-tbrooks",
    purchasedDaysAgo: 350,
    channel: "WEB",
  });
  register({
    serial: "252005531",
    batchNumber: "2520-L01",
    model: "SM382V",
    dealerId: "d-bayou",
    customerId: "c-dmorales",
    purchasedDaysAgo: 180,
    channel: "DEALER",
  });
  register({
    serial: "252309478",
    batchNumber: "2523-L02",
    model: "SC260",
    dealerId: "d-bayou",
    customerId: "c-kfontenot",
    purchasedDaysAgo: 345,
    channel: "EMAIL",
  });
  register({
    serial: "242704412",
    batchNumber: "2427-L01",
    model: "JL3KH6",
    dealerId: "d-bayou",
    customerId: "c-rcarter",
    purchasedDaysAgo: 500,
    channel: "DEALER",
  });
  register({
    serial: "252612087",
    batchNumber: "2526-L04",
    model: "SRS1",
    dealerId: "d-desertpeak",
    customerId: "c-bwalker",
    purchasedDaysAgo: 60,
    channel: "RETAIL",
    placeOfPurchase: "Online marketplace",
  });
  register({
    serial: "252103356",
    batchNumber: "2521-L02",
    model: "STA2",
    dealerId: "d-desertpeak",
    customerId: "c-lhernandez",
    purchasedDaysAgo: 230,
    channel: "ERP",
  });
  register({
    serial: "252409963",
    batchNumber: "2524-L01",
    model: "SC680",
    dealerId: "d-desertpeak",
    customerId: "c-comfortpro",
    purchasedDaysAgo: 20,
    channel: "API",
  });
  register({
    serial: "243011270",
    batchNumber: "2430-L02",
    model: "VP87",
    dealerId: "d-desertpeak",
    customerId: "c-smitchell",
    purchasedDaysAgo: 380,
    channel: "DEALER",
  });

  // ── Warranty claims ─────────────────────────────────────────────────────────
  function claim(spec: {
    serial: string;
    source: ClaimSource;
    issueType: IssueType;
    description: string;
    filedDaysAgo: number;
    steps: { status: ClaimStatus; daysAgo: number; text?: string }[];
    resolution?: Resolution;
    creditAmount?: number;
    rejectReason?: string;
    decisionNote?: string;
    replacement?: { serial: string; batchNumber: string };
  }) {
    const unit = unitBySerial(spec.serial);
    const customer = state.customers.find((c) => c.id === unit.customerId)!;
    const filed = daysAgo(spec.filedDaysAgo);
    const raisedBy =
      spec.source === "CUSTOMER"
        ? { id: customer.id, name: customer.name }
        : spec.source === "DEALER"
          ? dealerUser(unit.dealerId!)
          : { id: "u-admin", name: "Warranty Desk" };
    const id = nextId("CLM");
    const last = spec.steps[spec.steps.length - 1];
    const c: WarrantyClaim = {
      id,
      unitSerial: unit.serial,
      source: spec.source,
      raisedBy: raisedBy.id,
      raisedByName: raisedBy.name,
      dealerId: unit.dealerId,
      customerId: unit.customerId,
      issueType: spec.issueType,
      description: spec.description,
      attachmentIds: [],
      status: last?.status ?? "SUBMITTED",
      coverage: coverageFor(unit, filed),
      resolution: spec.resolution,
      creditAmount: spec.creditAmount,
      replacementSerial: spec.replacement?.serial,
      replacementBatchNumber: spec.replacement?.batchNumber,
      decisionNote: spec.decisionNote,
      rejectReason: spec.rejectReason,
      reviewedByName: spec.steps.length ? "Warranty Desk" : undefined,
      createdAt: ts(filed),
      updatedAt: ts(last ? daysAgo(last.daysAgo) : filed, "14:00:00"),
      history: [
        { at: ts(filed), status: "SUBMITTED", byName: raisedBy.name },
        ...spec.steps.map((s) => ({
          at: ts(daysAgo(s.daysAgo), "14:00:00"),
          status: s.status,
          byName: "Warranty Desk",
          text: s.text,
        })),
      ],
    };
    state.claims.push(c);
    unit.history.push({ at: ts(filed), type: "claim_filed", byName: raisedBy.name, refId: id });
    if (c.status === "CLOSED") {
      const closed = ts(daysAgo(last!.daysAgo), "14:00:00");
      if (spec.replacement) {
        const m = state.models.find((x) => x.id === unit.modelId)!;
        unit.replacedBySerial = spec.replacement.serial;
        unit.history.push({
          at: closed,
          type: "replaced",
          byName: "Warranty Desk",
          text: `Replaced by ${spec.replacement.serial} under claim ${id}`,
          refId: id,
        });
        state.units.push({
          serial: spec.replacement.serial,
          batchNumber: spec.replacement.batchNumber,
          modelId: m.id,
          dealerId: unit.dealerId,
          customerId: unit.customerId,
          purchaseDate: unit.purchaseDate,
          warrantyStart: daysAgo(last!.daysAgo),
          warrantyEnd: unit.warrantyEnd,
          replacesSerial: unit.serial,
          attachmentIds: [],
          history: [
            {
              at: closed,
              type: "registered",
              byName: "Warranty Desk",
              text: `Replacement for ${unit.serial}, covered until ${unit.warrantyEnd}`,
              refId: id,
            },
          ],
        });
      }
      if (spec.resolution === "CREDIT") {
        message({
          system: "FINANCE",
          direction: "OUT",
          type: "credit_memo",
          status: "SUCCESS",
          refId: id,
          payload: {
            claimId: id,
            serial: unit.serial,
            amount: spec.creditAmount,
            currency: "USD",
            account: "Warranty credits",
          },
          at: closed,
        });
      }
      unit.history.push({
        at: closed,
        type: "claim_closed",
        byName: "Warranty Desk",
        text: spec.resolution,
        refId: id,
      });
    }
  }

  claim({
    serial: "252510384",
    source: "DEALER",
    issueType: "INACCURATE_READING",
    description: "Amp readings drift about 8% high against our reference meter on a 40A load.",
    filedDaysAgo: 60,
    resolution: "REPAIR",
    decisionNote: "Recalibrated and returned.",
    steps: [
      { status: "IN_REVIEW", daysAgo: 59 },
      { status: "APPROVED", daysAgo: 57, text: "Recalibrate at the service center." },
      { status: "CLOSED", daysAgo: 50, text: "Recalibrated and returned." },
    ],
  });
  claim({
    serial: "252005531",
    source: "DEALER",
    issueType: "CONNECTIVITY",
    description:
      "Bluetooth pairing fails with the Job Link app on two different phones after the latest update.",
    filedDaysAgo: 40,
    resolution: "REPLACE",
    replacement: { serial: "252707701", batchNumber: "2527-L02" },
    steps: [
      { status: "IN_REVIEW", daysAgo: 39 },
      { status: "APPROVED", daysAgo: 36, text: "Radio module fault confirmed; replace the manifold." },
      { status: "CLOSED", daysAgo: 33 },
    ],
  });
  claim({
    serial: "252309478",
    source: "DEALER",
    issueType: "DISPLAY",
    description: "Display segments missing on the main reading after two weeks of use.",
    filedDaysAgo: 25,
    resolution: "CREDIT",
    creditAmount: 139,
    steps: [
      { status: "IN_REVIEW", daysAgo: 24 },
      { status: "APPROVED", daysAgo: 22, text: "Model superseded; credit the purchase price." },
      { status: "CLOSED", daysAgo: 21 },
    ],
  });
  claim({
    serial: "242704412",
    source: "CUSTOMER",
    issueType: "NO_POWER",
    description: "The airflow probe no longer turns on, even with fresh batteries.",
    filedDaysAgo: 30,
    rejectReason: "The warranty ended before the claim was filed. An out-of-warranty repair quote was sent.",
    steps: [
      {
        status: "REJECTED",
        daysAgo: 28,
        text: "The warranty ended before the claim was filed. An out-of-warranty repair quote was sent.",
      },
    ],
  });
  claim({
    serial: "243011270",
    source: "DEALER",
    issueType: "LEAK_OR_PRESSURE",
    description: "Oil leaking at the shaft seal; the pump won't pull below 800 microns.",
    filedDaysAgo: 20,
    resolution: "REPAIR",
    steps: [
      { status: "IN_REVIEW", daysAgo: 18 },
      { status: "APPROVED", daysAgo: 5, text: "Replace the shaft seal under warranty." },
    ],
  });
  claim({
    serial: "251902645",
    source: "CUSTOMER",
    issueType: "MECHANICAL",
    description: "The recovery machine hums on start-up and then trips the breaker.",
    filedDaysAgo: 12,
    steps: [{ status: "IN_REVIEW", daysAgo: 10 }],
  });
  claim({
    serial: "252409963",
    source: "CUSTOMER",
    issueType: "MECHANICAL",
    description: "The clamp jaw doesn't close fully, and readings jump when the head swivels.",
    filedDaysAgo: 2,
    steps: [],
  });

  // ── Integration log ─────────────────────────────────────────────────────────
  message({
    system: "ERP",
    direction: "IN",
    type: "erp_invoice",
    status: "SUCCESS",
    refId: "GS-240517",
    payload: {
      invoice: "GS-240517",
      dealer: "Lone Star Refrigeration Supply",
      lines: [{ serial: "261804517", batchNumber: "2618-L02", model: "SM482V" }],
    },
    at: ts(daysAgo(12), "08:30:00"),
  });
  message({
    system: "PARTNER",
    direction: "IN",
    type: "partner_registration",
    status: "SUCCESS",
    refId: "pc-marketplace",
    payload: {
      partner: "Online marketplace",
      channel: "RETAIL",
      received: 1,
      registered: 1,
      review: 0,
      errors: 0,
      serials: ["252612087"],
    },
    at: ts(daysAgo(60), "09:00:00"),
  });
  message({
    system: "CRM",
    direction: "OUT",
    type: "crm_update",
    status: "FAILED",
    lastError: "CRM did not respond within 30 s.",
    refId: "c-bwalker",
    payload: { customerId: "c-bwalker", products: ["252612087"] },
    at: ts(daysAgo(60), "09:05:00"),
  });

  return state;
}

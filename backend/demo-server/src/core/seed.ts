import {
  addDaysIso,
  addMonthsIso,
  coverageFor,
  DEFAULT_BATCH_PATTERN,
  DEFAULT_SERIAL_PATTERN,
  extensionPrice,
  serialNumberPart,
  todayIso,
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
  type PartnerChannel,
  type ProductCategory,
  type Registration,
  type RegistrationChannel,
  type RegistrationFlag,
  type Resolution,
  type Unit,
  type User,
  type VoidReason,
  type WarrantyClaim,
} from "@wms/domain";
import type { DemoState } from "./state";

// Starting data of the mock API: a COPY of the real backend's seed (backend/src/modules/demo/seed-data.ts), so the
// mock and the backend start from the same accounts, ids, serials, batches and claims. The core can't import the
// backend file (it must build with only @wms/domain available); src/seed-parity.test.ts fails when the two drift.
// Keep the body of createSeedData() identical to the backend's createSeed().
//
// - Products: real Fieldpiece models and categories from fieldpiece.com (checked 2026-09-28), with Fieldpiece's
//   published term: "All of our products have a 1 year warranty from date of purchase."
// - People and companies: fictional, in the United States. Phone numbers use the 555-01xx range reserved for
//   fiction; emails use example.com.
// - Serial and batch numbers: the assumed label format (yy + ww + 5-digit sequence; yyww-L + line). [CONFIRM]
// Named products keep fixed serials (so printed QR labels stay valid); purchase dates are placed relative to `today`,
// so "expiring soon", "active" and "expired" hold whenever the data is loaded. Admin -> Reset calls createSeed().

/** Shared password of every seeded account (the backend's DEMO_PASSWORD default). */
export const DEMO_PASSWORD = "Demo#2026";

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
  "pc-overwatch": "fpk_seed_overwatch_9Vd3Rk6MwQ2b",
  "pc-joblink": "fpk_seed_joblink_5Ng7Yp2HsT8x",
} as const;

export interface SeedPartnerClient {
  id: keyof typeof DEMO_PARTNER_KEYS;
  name: string;
  channel: PartnerChannel;
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
  "ACH4",
  "SC440",
  "SC640",
  "GS322F",
  "GS422F",
  "GS434F",
  "SM380V",
  "SM480V",
  "JL3KM2",
  "JL3KR4",
  "JL3LC",
  "JL3MN",
  "JL3PC",
  "JL3PR",
  "JL3RH",
  "HV1",
  "VC1",
  "VC1G",
  "VC2G",
  "VP67",
  "VP833",
  "VPX7",
  "DR58",
  "DRX3",
  "SR47",
  "SRS3",
  "AAV3",
  "ASP2",
  "PRH2",
  "SDMN5",
  "SDMN6",
  "HS33",
  "HS36",
  "LT17A",
  "SMG5",
  "SNCV1",
  "ATB1",
  "ATC1R",
  "ATWB1",
  "SIG1",
  "SPK1",
  "SPK2",
  "SPK3",
  "ST4",
  "TC24",
  "TC48",
  "CAT45",
  "CAT85",
  "CATPR",
  "SCM4",
  "SOX3",
  "ADK7",
  "ANC1",
  "ANC11",
  "ANC18",
  "BG36",
  "BG44",
  "HR1B",
  "HR3L",
  "S365",
]);

// Finance values [CONFIRM with Fieldpiece Finance]: USD list prices of the catalogue. A code left out here gets its
// category's typical price. Repair cost, the yearly warranty budget and the expected claims derive from the list price.
const LIST_PRICES: Record<string, number> = {
  SC680: 329,
  SC480: 239,
  SC260: 139,
  SM482V: 1199,
  SM382V: 899,
  JL3KH6: 749,
  VP87: 699,
  MR45: 1349,
  MG44: 189,
  DR82: 449,
  SRS1: 369,
  STA2: 299,
};
const CATEGORY_LIST_PRICES: Record<string, number> = {
  "cat-clamp": 199,
  "cat-manifold": 899,
  "cat-joblink": 499,
  "cat-vacuum": 599,
  "cat-leak": 399,
  "cat-scale": 349,
  "cat-airflow": 299,
  "cat-multimeter": 179,
  "cat-thermometer": 129,
  "cat-combustion": 899,
  "cat-accessories": 59,
};
const DEFAULT_LIST_PRICE = 299;
const REPAIR_COST_RATIO = 0.3;
const WARRANTY_BUDGET_RATIO = 2.5;
const CLAIM_QUOTA = 3;

function modelFinance(code: string, categoryId: string) {
  const listPrice = LIST_PRICES[code] ?? CATEGORY_LIST_PRICES[categoryId] ?? DEFAULT_LIST_PRICE;
  return {
    listPrice,
    repairCost: Math.round(listPrice * REPAIR_COST_RATIO),
    warrantyBudget: Math.round(listPrice * WARRANTY_BUDGET_RATIO),
    claimQuota: CLAIM_QUOTA,
  };
}

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
  ...modelFinance(code, categoryId),
});

// ── Demo volume ───────────────────────────────────────────────────────────────────────────────────────────────────
// The named products above show each workflow; the dashboards need volume too. createSeed() ends by generating a few
// hundred more products for every dealer and channel (with their registrations, claims, extended warranties and a
// review inbox) from a fixed-seed random generator: the same data on every load, and the same counts and amounts for
// any `today` (only the dates move with it). Generated label numbers use the sequences 70000-99999 (System events
// use 30001 and up) and batch lines L05-L08, and never contain 2635, 2638 or 2639 (the bulk-upload sample and the
// tests' serials).

/** mulberry32: a small seeded random generator, values in [0, 1). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const RESERVED_LABEL_PARTS = ["2635", "2638", "2639"];
const isFreeLabel = (value: string) => !RESERVED_LABEL_PARTS.some((part) => value.includes(part));

/** Year and week of a build date as printed on the label (yyww), the way the System events number batches. */
function labelWeek(date: IsoDate): string {
  const built = new Date(`${date}T00:00:00Z`);
  const start = Date.UTC(built.getUTCFullYear(), 0, 1);
  const week = Math.min(52, Math.floor((built.getTime() - start) / (7 * 86_400_000)) + 1);
  return `${String(built.getUTCFullYear()).slice(2)}${String(week).padStart(2, "0")}`;
}

/** More customers for the generated products (fictional, 555-01xx phones): id, name, phone, email, city, state, ZIP. */
const MORE_CUSTOMERS: [string, string, string, string | undefined, string, string, string][] = [
  ["c-rgarza", "Roberto Garza", "(281) 555-0151", "roberto.garza@example.com", "Pasadena", "TX", "77502"],
  ["c-ekim", "Emily Kim", "(832) 555-0152", undefined, "Houston", "TX", "77007"],
  ["c-dthompson", "Derek Thompson", "(346) 555-0153", "derek.thompson@example.com", "Cypress", "TX", "77429"],
  ["c-mlopez", "Maria Lopez", "(281) 555-0154", undefined, "Spring", "TX", "77379"],
  [
    "c-jpatterson",
    "Jason Patterson",
    "(936) 555-0155",
    "jason.patterson@example.com",
    "Conroe",
    "TX",
    "77301",
  ],
  ["c-sadams", "Sharon Adams", "(409) 555-0157", undefined, "Beaumont", "TX", "77701"],
  [
    "c-gulfcoast",
    "Gulf Coast Comfort Services LLC",
    "(832) 555-0159",
    "dispatch@gulfcoastcomfort.example.com",
    "Houston",
    "TX",
    "77040",
  ],
  [
    "c-bayoucity",
    "Bayou City Mechanical Inc.",
    "(346) 555-0160",
    "service@bayoucitymech.example.com",
    "Houston",
    "TX",
    "77092",
  ],
  ["c-twright", "Terrence Wright", "(979) 555-0162", undefined, "College Station", "TX", "77840"],
  ["c-avasquez", "Ana Vasquez", "(281) 555-0164", "ana.vasquez@example.com", "Pearland", "TX", "77584"],
  ["c-kobrien", "Kevin O'Brien", "(832) 555-0165", undefined, "League City", "TX", "77573"],
  ["c-lnguyen", "Linh Nguyen", "(281) 555-0166", "linh.nguyen@example.com", "Katy", "TX", "77449"],
  ["c-jboudreaux", "Jacques Boudreaux", "(337) 555-0168", undefined, "Lafayette", "LA", "70506"],
  [
    "c-mlandry",
    "Michelle Landry",
    "(225) 555-0169",
    "michelle.landry@example.com",
    "Baton Rouge",
    "LA",
    "70809",
  ],
  ["c-cthibodeaux", "Chris Thibodeaux", "(985) 555-0170", undefined, "Houma", "LA", "70360"],
  [
    "c-dwashington",
    "Darnell Washington",
    "(504) 555-0172",
    "darnell.washington@example.com",
    "New Orleans",
    "LA",
    "70115",
  ],
  ["c-kguidry", "Kristen Guidry", "(225) 555-0174", undefined, "Gonzales", "LA", "70737"],
  [
    "c-pelican",
    "Pelican State Heating & Cooling",
    "(225) 555-0175",
    "office@pelicanstatehvac.example.com",
    "Baton Rouge",
    "LA",
    "70816",
  ],
  ["c-rhebert", "Ryan Hebert", "(337) 555-0176", "ryan.hebert@example.com", "Lake Charles", "LA", "70605"],
  ["c-acormier", "Amy Cormier", "(318) 555-0177", undefined, "Shreveport", "LA", "71105"],
  ["c-tbreaux", "Tyrone Breaux", "(504) 555-0178", undefined, "Kenner", "LA", "70062"],
  ["c-jramirez", "Javier Ramirez", "(602) 555-0179", "javier.ramirez@example.com", "Phoenix", "AZ", "85008"],
  ["c-sjohnson", "Stephanie Johnson", "(480) 555-0180", undefined, "Chandler", "AZ", "85224"],
  ["c-mcollins", "Mark Collins", "(623) 555-0181", "mark.collins@example.com", "Glendale", "AZ", "85301"],
  [
    "c-desertair",
    "Desert Air Pros LLC",
    "(480) 555-0182",
    "jobs@desertairpros.example.com",
    "Scottsdale",
    "AZ",
    "85257",
  ],
  ["c-lyazzie", "Lena Yazzie", "(928) 555-0183", undefined, "Flagstaff", "AZ", "86001"],
  ["c-rpeterson", "Rick Peterson", "(520) 555-0185", "rick.peterson@example.com", "Tucson", "AZ", "85705"],
  ["c-gortiz", "Gabriela Ortiz", "(602) 555-0187", undefined, "Phoenix", "AZ", "85032"],
  ["c-bnelson", "Brandon Nelson", "(623) 555-0188", undefined, "Peoria", "AZ", "85345"],
  ["c-hfoster", "Heather Foster", "(303) 555-0189", "heather.foster@example.com", "Denver", "CO", "80211"],
  [
    "c-mbennett",
    "Michael Bennett",
    "(404) 555-0190",
    "michael.bennett@example.com",
    "Atlanta",
    "GA",
    "30318",
  ],
  ["c-cmurphy", "Colleen Murphy", "(312) 555-0191", "colleen.murphy@example.com", "Chicago", "IL", "60618"],
  ["c-dokafor", "David Okafor", "(919) 555-0193", "david.okafor@example.com", "Raleigh", "NC", "27603"],
  [
    "c-northstar",
    "Northstar Refrigeration Co.",
    "(612) 555-0194",
    "service@northstarrefrigeration.example.com",
    "Minneapolis",
    "MN",
    "55413",
  ],
  ["c-ssullivan", "Sean Sullivan", "(614) 555-0195", "sean.sullivan@example.com", "Columbus", "OH", "43215"],
  ["c-pchen", "Priya Chen", "(206) 555-0196", "priya.chen@example.com", "Seattle", "WA", "98103"],
  ["c-rmarshall", "Robert Marshall", "(816) 555-0197", undefined, "Kansas City", "MO", "64111"],
  [
    "c-summitair",
    "Summit Air Solutions",
    "(801) 555-0198",
    "service@summitair.example.com",
    "Salt Lake City",
    "UT",
    "84101",
  ],
  [
    "c-jflores",
    "Jessica Flores",
    "(210) 555-0199",
    "jessica.flores@example.com",
    "San Antonio",
    "TX",
    "78209",
  ],
  ["c-tgreen", "Tom Green", "(407) 555-0150", undefined, "Orlando", "FL", "32803"],
  ["c-nharris", "Nicole Harris", "(702) 555-0149", "nicole.harris@example.com", "Las Vegas", "NV", "89102"],
  ["c-kyoung", "Kenneth Young", "(503) 555-0148", undefined, "Portland", "OR", "97214"],
  [
    "c-coolbreeze",
    "Cool Breeze HVAC Services",
    "(972) 555-0146",
    "office@coolbreezehvac.example.com",
    "Plano",
    "TX",
    "75074",
  ],
];

/** Contractors: they buy several tools each. */
const CONTRACTORS = new Set([
  "c-comfortpro",
  "c-gulfcoast",
  "c-bayoucity",
  "c-pelican",
  "c-desertair",
  "c-northstar",
  "c-summitair",
  "c-coolbreeze",
]);

/** People who register without a customer record (web form, email, partner systems): name, email, phone, city, state, ZIP. */
const WALK_INS: [string, string, string, string, string, string][] = [
  ["Olivia Grant", "olivia.grant@example.com", "(469) 555-0151", "Dallas", "TX", "75204"],
  ["Caleb Turner", "caleb.turner@example.com", "(318) 555-0152", "Monroe", "LA", "71201"],
  ["Sofia Ramos", "sofia.ramos@example.com", "(623) 555-0153", "Avondale", "AZ", "85323"],
  ["Wesley Hart", "wesley.hart@example.com", "(405) 555-0154", "Oklahoma City", "OK", "73102"],
  ["Megan Doyle", "megan.doyle@example.com", "(317) 555-0155", "Indianapolis", "IN", "46204"],
  ["Victor Salas", "victor.salas@example.com", "(915) 555-0156", "El Paso", "TX", "79901"],
  ["Paige Warren", "paige.warren@example.com", "(502) 555-0157", "Louisville", "KY", "40202"],
  ["Luis Herrera", "luis.herrera@example.com", "(956) 555-0158", "McAllen", "TX", "78501"],
];

/** How often each model sells, relative to the rest of the catalogue (1). */
const MODEL_WEIGHTS: Record<string, number> = {
  SC680: 8,
  SC480: 7,
  SM482V: 6,
  VP87: 6,
  MG44: 6,
  SC260: 5,
  SC440: 5,
  SM382V: 5,
  JL3KH6: 5,
  SC640: 4,
  SM480V: 4,
  VP67: 4,
  SM380V: 3,
  VPX7: 3,
  JL3KR4: 3,
  JL3PR: 3,
  JL3PC: 3,
  MR45: 3,
  DR82: 3,
  DR58: 3,
  SRS1: 3,
  SRS3: 3,
  VP833: 2,
  DRX3: 2,
  SR47: 2,
  STA2: 2,
};

/** What each Fieldpiece app registers: Job Link probes and wireless tools; Overwatch-connected manifolds and probes. */
const APP_MODEL_WEIGHTS: Record<"JOBLINK" | "OVERWATCH", [string, number][]> = {
  JOBLINK: [
    ["JL3KH6", 5],
    ["JL3KR4", 4],
    ["JL3PR", 3],
    ["JL3PC", 3],
    ["JL3RH", 3],
    ["SC680", 3],
    ["MG44", 3],
    ["JL3KM2", 2],
    ["JL3MN", 2],
    ["JL3LC", 2],
    ["SC480", 2],
    ["SM482V", 2],
    ["SRS3", 2],
    ["SR47", 1],
    ["SDMN6", 1],
  ],
  OVERWATCH: [
    ["SM482V", 4],
    ["SM480V", 3],
    ["SM382V", 3],
    ["MG44", 3],
    ["SM380V", 2],
    ["JL3PC", 2],
    ["JL3PR", 2],
    ["JL3RH", 2],
    ["SRS3", 1],
    ["VP87", 1],
  ],
};

/** How each dealer's products get registered. */
const DEALER_CHANNELS: Record<string, [RegistrationChannel, number][]> = {
  "d-lonestar": [
    ["DEALER", 45],
    ["BULK", 25],
    ["PORTAL", 10],
    ["EMAIL", 8],
    ["WEB", 7],
    ["ERP", 5],
  ],
  "d-bayou": [
    ["DEALER", 55],
    ["BULK", 15],
    ["PORTAL", 10],
    ["EMAIL", 10],
    ["WEB", 5],
    ["ERP", 5],
  ],
  "d-desertpeak": [
    ["API", 45],
    ["DEALER", 25],
    ["PORTAL", 10],
    ["WEB", 10],
    ["EMAIL", 5],
    ["ERP", 5],
  ],
};

/** Channels whose clean registrations are approved at once; the others wait for the warranty desk. */
const TRUSTED_CHANNELS = new Set<RegistrationChannel>([
  "DEALER",
  "BULK",
  "API",
  "RETAIL",
  "OVERWATCH",
  "JOBLINK",
]);

/** Faults reported in claims, by the categories they apply to ("*": any electronic tool). */
const ISSUES: [IssueType, string, string][] = [
  ["NO_POWER", "*", "Won't power on, even with fresh batteries."],
  ["NO_POWER", "*", "Shuts off a few seconds after power-on."],
  ["INACCURATE_READING", "*", "Readings drift about 5% high against our reference instrument."],
  ["INACCURATE_READING", "*", "Temperature reads 4F off a calibrated probe on the same line."],
  ["DISPLAY", "*", "Display segments missing on the main reading."],
  ["DISPLAY", "*", "Backlight stopped working after a few weeks of use."],
  ["CONNECTIVITY", "*", "Drops the Job Link connection every few minutes."],
  ["CONNECTIVITY", "*", "Won't pair with the Job Link app on two different phones."],
  [
    "LEAK_OR_PRESSURE",
    "cat-manifold cat-vacuum cat-accessories",
    "Won't hold pressure during a standing test.",
  ],
  ["LEAK_OR_PRESSURE", "cat-vacuum", "Oil seeping at the shaft seal; can't pull below 1000 microns."],
  ["MECHANICAL", "cat-vacuum", "Motor hums on start-up and trips the breaker."],
  ["MECHANICAL", "cat-clamp", "The jaw doesn't close fully, so readings jump."],
  ["MECHANICAL", "cat-accessories", "Stitching at the handle came apart in normal use."],
  ["MECHANICAL", "*", "Battery door latch broke off in normal use."],
  ["OTHER", "cat-accessories", "Valve on the hose sticks half open."],
];

const REJECT_REASONS = [
  "Drop damage on the housing; not a manufacturing fault.",
  "Water damage inside the battery compartment; not covered by the warranty.",
  "No fault found: the unit passed every test at the service center.",
  "Damage from connecting to a live 480 V circuit above the rated range.",
];

const VOID_NOTES: [VoidReason, string][] = [
  ["UNAUTHORIZED_REPAIR", "Opened and resealed by a third-party repair shop; tamper label broken."],
  ["MISUSE", "Used on a refrigerant the sensor isn't rated for; sensor damaged."],
  ["PHYSICAL_DAMAGE", "Housing crushed; run over on a job site according to the dealer."],
  ["OTHER", "Serial label removed and replaced with a handwritten one."],
];

export function createSeedData(today: IsoDate): SeedState {
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
      { id: "cat-multimeter", name: "Multimeters and electrical testers" },
      { id: "cat-thermometer", name: "Thermometers and thermocouples" },
      { id: "cat-combustion", name: "Combustion analyzers" },
      { id: "cat-accessories", name: "Accessories and cases" },
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
      // Catalog additions from fieldpiece.com (product-sitemap.xml, 2026-09-30).
      model(
        "ACH4",
        "cat-clamp",
        "400A Amp Clamp Accessory Head",
        "Accessory clamp head reading up to 400 AC amps; jaw claw isolates wires for testing",
      ),
      model(
        "SC440",
        "cat-clamp",
        "400A Clamp Meter Dual Display",
        "Essential True RMS HVACR clamp meter with inrush, temperature, capacitance and NCV",
      ),
      model(
        "SC640",
        "cat-clamp",
        "400A Swivel Clamp Meter Dual Display",
        "Loaded swivel-head clamp meter with LED jaw flashlight, inrush and backlit display",
      ),
      model(
        "GS322F",
        "cat-manifold",
        "Analog Gauge Set 3 Port Manifold",
        "3-port analog manifold with R22/R32/R454B/R410A rings and integrated sight glass",
      ),
      model(
        "GS422F",
        "cat-manifold",
        "Analog Gauge Set 4 Port Manifold",
        "4-port analog manifold with R22/R32/R454B/R410A rings and integrated sight glass",
      ),
      model(
        "GS434F",
        "cat-manifold",
        "Analog Gauge Set 4 Port Manifold",
        "4-port analog manifold with R134A/R404A/R407C/R448A rings for refrigeration",
      ),
      model(
        "SM380V",
        "cat-manifold",
        "SMAN Wireless Refrigerant 3-Port Manifold",
        "Rugged wireless 3-port digital manifold with data logging and tightness test",
      ),
      model(
        "SM480V",
        "cat-manifold",
        "SMAN Wireless Refrigerant 4-Port Manifold",
        "Rugged wireless 4-port digital manifold with data logging and tightness test",
      ),
      model(
        "JL3KM2",
        "cat-joblink",
        "Job Link System Dual Port Manometer Probe Kit",
        "Wireless dual port manometer kit for static, gas and draft pressure; 1000 ft range",
      ),
      model(
        "JL3KR4",
        "cat-joblink",
        "Job Link System Probes Charge Kit",
        "Wireless pressure and pipe clamp probe kit for quick system charge checks",
      ),
      model(
        "JL3LC",
        "cat-joblink",
        "Job Link System Large Pipe Clamp",
        "Wireless large pipe clamp for 3/4 in to 4 1/8 in pipes; commercial and refrigeration",
      ),
      model(
        "JL3MN",
        "cat-joblink",
        "Job Link System Single Port Wireless Manometer",
        "Single port wireless manometer for static, gas and draft pressure; 1000 ft range",
      ),
      model(
        "JL3PC",
        "cat-joblink",
        "Job Link System Premium Pipe Clamp Probe",
        "Wireless pipe clamp with Rapid Rail sensor; stabilizes in 3 s with +/-1F accuracy",
      ),
      model(
        "JL3PR",
        "cat-joblink",
        "Job Link System Pressure Probe",
        "Wireless pressure probe with 45 degree fitting, accurate at any elevation",
      ),
      model(
        "JL3RH",
        "cat-joblink",
        "Job Link System Flex Psychrometer Probe",
        "Flexible wireless psychrometer probe with magnetic hanger and supply/return switch",
      ),
      model(
        "HV1",
        "cat-vacuum",
        "3/8in Vacuum Hose",
        "A2L compatible 3/8 in vacuum hose with full-ring triple crimp",
      ),
      model(
        "VC1",
        "cat-vacuum",
        "1/4in Valve Core Removal Tool",
        "Ultra-compact valve core removal tool with capture rod and magnetic cap",
      ),
      model(
        "VC1G",
        "cat-vacuum",
        "1/4in Valve Core Removal Tool with Sight Glass",
        "Valve core removal tool with integrated sight glass to verify core and flow",
      ),
      model(
        "VC2G",
        "cat-vacuum",
        "1/4in Valve Core Removal Tool Dual Valve with Sight Glass",
        "Valve core removal tool with sight glass and second ball valve on the side port",
      ),
      model(
        "VP67",
        "cat-vacuum",
        "6 CFM Vacuum Pump",
        "6 CFM pump, 15 micron ultimate vacuum, 1/2 HP AC motor and RunQuick oil change",
      ),
      model(
        "VP833",
        "cat-vacuum",
        "8 CFM A3 Vacuum Pump",
        "8 CFM pump for A3, A2L and A1 refrigerants; Class I Div 2 certified, 3/4 HP DC motor",
      ),
      model(
        "VPX7",
        "cat-vacuum",
        "10 CFM Vacuum Pump",
        "Patented lightweight 10 CFM pump, 15 micron ultimate vacuum, 3/4 HP DC motor",
      ),
      model(
        "DR58",
        "cat-leak",
        "Heated Diode Refrigerant Leak Detector",
        "Heated diode leak detector, better than 0.03 oz/yr, 18-hour rechargeable battery",
      ),
      model(
        "DRX3",
        "cat-leak",
        "Refrigerant and Combustible Gas Leak Detector",
        "Detects A3, A2L and A1 refrigerants plus combustible gases; replaceable sensor",
      ),
      model(
        "SR47",
        "cat-scale",
        "Wireless Refrigerant Scale",
        "Wireless scale with 13 in platform, 252 lb max load and backlit remote",
      ),
      model(
        "SRS3",
        "cat-scale",
        "Refrigerant Scale 250 lb Capacity Wireless",
        "Water resistant 252 lb wireless scale that links to Job Link App and SMAN manifolds",
      ),
      model(
        "AAV3",
        "cat-airflow",
        "Air Velocity and Temperature Accessory Head",
        "Vane anemometer accessory head for air velocity, temperature and CFM estimates",
      ),
      model(
        "ASP2",
        "cat-airflow",
        "Static Pressure Probes",
        "Two-pack of duct static pressure probes with magnetic flange; fits all manometers",
      ),
      model(
        "PRH2",
        "cat-airflow",
        "Digital Psychrometer",
        "Pocket digital psychrometer for wet bulb, dry bulb, dew point and %RH",
      ),
      model(
        "SDMN5",
        "cat-airflow",
        "Manometer Dual Port",
        "Dual port manometer, -60 to 60 in WC range with 0.01 in WC resolution",
      ),
      model(
        "SDMN6",
        "cat-airflow",
        "Manometer Dual Port with Pressure Switch Tester",
        "Dual port manometer for gas, static and differential pressure; tests pressure switches",
      ),
      model(
        "HS33",
        "cat-multimeter",
        "Stick Style Manual Ranging Multimeter",
        "Expandable stick multimeter with NCV, works with any accessory head; 400 AAC clamp",
      ),
      model(
        "HS36",
        "cat-multimeter",
        "True RMS Digital Multimeter with Backlight",
        "True RMS stick meter with NCV, microamps DC for flame diodes and 400 AAC clamp",
      ),
      model(
        "LT17A",
        "cat-multimeter",
        "Digital Multimeter",
        "Classic HVACR multimeter: temperature to 1400F, capacitance, 400 AAC with clamp",
      ),
      model(
        "SMG5",
        "cat-multimeter",
        "Digital Megohm Meter",
        "1000VDC megohm meter measuring up to 2000 megohm to evaluate compressor insulation",
      ),
      model(
        "SNCV1",
        "cat-multimeter",
        "Non-contact Voltage Detector",
        "Detects AC voltage without contact; indicators grow louder and brighter near source",
      ),
      model(
        "ATB1",
        "cat-thermometer",
        "Type-K Thermocouple",
        "Type-K bead thermocouple for air, surface or liquid temps from -50 to 400F",
      ),
      model(
        "ATC1R",
        "cat-thermometer",
        "Small Clamp Thermocouple",
        "Type-K pipe clamp thermocouple for 1/8 in to 3/4 in refrigeration lines",
      ),
      model(
        "ATWB1",
        "cat-thermometer",
        "Type-K Wet Bulb Thermocouple with Alligator Clip",
        "Wet bulb sock thermocouple that clips to evaporator filters for indoor wet bulb",
      ),
      model(
        "SIG1",
        "cat-thermometer",
        "Gun Style IR Thermometer",
        "Gun-style IR thermometer with 10:1 field of view, laser guide and blue backlight",
      ),
      model(
        "SPK1",
        "cat-thermometer",
        "Pocket Knife Style Thermometer",
        "Pocket thermometer with sharp probe tip for punching through flex duct",
      ),
      model(
        "SPK2",
        "cat-thermometer",
        "Folding Pocket In-Duct Thermometer",
        "Folding pocket thermometer with hanging hook for quick air temperatures",
      ),
      model(
        "SPK3",
        "cat-thermometer",
        "Compact Type K and Infrared Thermometer",
        "Folding rod in-duct thermometer with 8:1 IR for register and ambient temps",
      ),
      model(
        "ST4",
        "cat-thermometer",
        "Dual Temperature Meter Type K",
        "Dual K-type temperature meter with 0.1F resolution; two thermocouples included",
      ),
      model(
        "TC24",
        "cat-thermometer",
        "Pipe Clamp Thermocouple",
        "Pipe clamp thermocouple for 3/8 in to 1 3/8 in pipes on residential cooling systems",
      ),
      model(
        "TC48",
        "cat-thermometer",
        "Large Pipe Clamp",
        "Large pipe clamp thermocouple for 3/4 in to 4 1/8 in commercial pipes",
      ),
      model(
        "CAT45",
        "cat-combustion",
        "Combustion Analyzer",
        "Combustion analyzer measuring O2, CO, CO2 and draft pressure",
      ),
      model(
        "CAT85",
        "cat-combustion",
        "Combustion Analyzer HC",
        "Combustion analyzer for O2, CO, CO2 and draft with built-in manometer",
      ),
      model(
        "CATPR",
        "cat-combustion",
        "Wireless Thermal Printer",
        "Compact rechargeable wireless printer for combustion analyzer job reports",
      ),
      model(
        "SCM4",
        "cat-combustion",
        "Carbon Monoxide Detector",
        "CO detector with fast electro-chemical sensor, ZERO button and audio/visual alarms",
      ),
      model(
        "SOX3",
        "cat-combustion",
        "Combustion Checker with Auto Pump",
        "Measures flue temp and %O2; calculates %CO2, %EA and combustion efficiency",
      ),
      model(
        "ADK7",
        "cat-accessories",
        "Deluxe Silicone Test Lead Kit",
        "Test lead kit with ADLS2 silicone leads, ASA2 alligator leads and RCT2 probe tips",
      ),
      model(
        "ANC1",
        "cat-accessories",
        "Deluxe Meter Case",
        "Padded nylon 4-pocket case holding 1 meter and 2 accessory heads",
      ),
      model(
        "ANC11",
        "cat-accessories",
        "Manifold Case",
        "Padded case for SMAN digital manifolds; hang the manifold with hoses attached",
      ),
      model(
        "ANC18",
        "cat-accessories",
        "Job Link System Case",
        "Padded compact carrying case for Job Link probes and small hand tools",
      ),
      model(
        "BG36",
        "cat-accessories",
        "Inspection Tool Bag",
        "Compact rugged tool bag with magnetic closure and isolated instrument pockets",
      ),
      model(
        "BG44",
        "cat-accessories",
        "Service Tool Bag",
        "Service tool bag with elevated hand tool rack, padded meter pockets and magnetic tray",
      ),
      model(
        "HR1B",
        "cat-accessories",
        "1/4in Ball Valve Hose",
        "A2L compatible 1/4 in ball valve charging hose, 800 psi working pressure",
      ),
      model(
        "HR3L",
        "cat-accessories",
        "1/4in Low Loss Valves Hose Set 3 Pack",
        "A2L compatible 3-pack of 1/4 in low loss hoses, 800 psi working, 4000 psi burst",
      ),
      model(
        "S365",
        "cat-accessories",
        "Charging Jacket for TXV Systems",
        "Charging jacket to charge TXV systems at 37-70F outdoor temperatures",
      ),
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
      // Fieldpiece's own apps register through the partner API with their own keys (no dealer).
      { id: "pc-overwatch", name: "Fieldpiece Overwatch", channel: "OVERWATCH" },
      { id: "pc-joblink", name: "Fieldpiece Job Link", channel: "JOBLINK" },
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
    serial: "SM482V-261804517",
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
    serial: "SC680-251406233",
    batchNumber: "2514-L01",
    model: "SC680",
    dealerId: "d-lonestar",
    customerId: "c-mreed",
    purchasedDaysAgo: 320,
    channel: "DEALER",
  });
  register({
    serial: "VP87-243208841",
    batchNumber: "2432-L03",
    model: "VP87",
    dealerId: "d-lonestar",
    customerId: "c-mreed",
    purchasedDaysAgo: 410,
    channel: "DEALER",
  });
  const voidCandidate = register({
    serial: "DR82-252207119",
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
    serial: "SC480-252510384",
    batchNumber: "2525-L02",
    model: "SC480",
    dealerId: "d-lonestar",
    customerId: "c-aparker",
    purchasedDaysAgo: 200,
    channel: "BULK",
  });
  register({
    serial: "MG44-252811902",
    batchNumber: "2528-L01",
    model: "MG44",
    dealerId: "d-lonestar",
    customerId: "c-jnguyen",
    purchasedDaysAgo: 95,
    channel: "DEALER",
  });
  register({
    serial: "MR45-251902645",
    batchNumber: "2519-L03",
    model: "MR45",
    dealerId: "d-lonestar",
    customerId: "c-tbrooks",
    purchasedDaysAgo: 350,
    channel: "WEB",
  });
  register({
    serial: "SM382V-252005531",
    batchNumber: "2520-L01",
    model: "SM382V",
    dealerId: "d-bayou",
    customerId: "c-dmorales",
    purchasedDaysAgo: 180,
    channel: "DEALER",
  });
  register({
    serial: "SC260-252309478",
    batchNumber: "2523-L02",
    model: "SC260",
    dealerId: "d-bayou",
    customerId: "c-kfontenot",
    purchasedDaysAgo: 345,
    channel: "EMAIL",
  });
  register({
    serial: "JL3KH6-242704412",
    batchNumber: "2427-L01",
    model: "JL3KH6",
    dealerId: "d-bayou",
    customerId: "c-rcarter",
    purchasedDaysAgo: 500,
    channel: "DEALER",
  });
  register({
    serial: "SRS1-252612087",
    batchNumber: "2526-L04",
    model: "SRS1",
    dealerId: "d-desertpeak",
    customerId: "c-bwalker",
    purchasedDaysAgo: 60,
    channel: "RETAIL",
    placeOfPurchase: "Online marketplace",
  });
  register({
    serial: "STA2-252103356",
    batchNumber: "2521-L02",
    model: "STA2",
    dealerId: "d-desertpeak",
    customerId: "c-lhernandez",
    purchasedDaysAgo: 230,
    channel: "ERP",
  });
  register({
    serial: "SC680-252409963",
    batchNumber: "2524-L01",
    model: "SC680",
    dealerId: "d-desertpeak",
    customerId: "c-comfortpro",
    purchasedDaysAgo: 20,
    channel: "API",
  });
  register({
    serial: "VP87-243011270",
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
    serial: "SC480-252510384",
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
    serial: "SM382V-252005531",
    source: "DEALER",
    issueType: "CONNECTIVITY",
    description:
      "Bluetooth pairing fails with the Job Link app on two different phones after the latest update.",
    filedDaysAgo: 40,
    resolution: "REPLACE",
    replacement: { serial: "SM382V-252707701", batchNumber: "2527-L02" },
    steps: [
      { status: "IN_REVIEW", daysAgo: 39 },
      { status: "APPROVED", daysAgo: 36, text: "Radio module fault confirmed; replace the manifold." },
      { status: "CLOSED", daysAgo: 33 },
    ],
  });
  claim({
    serial: "SC260-252309478",
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
    serial: "JL3KH6-242704412",
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
    serial: "VP87-243011270",
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
    serial: "MR45-251902645",
    source: "CUSTOMER",
    issueType: "MECHANICAL",
    description: "The recovery machine hums on start-up and then trips the breaker.",
    filedDaysAgo: 12,
    steps: [{ status: "IN_REVIEW", daysAgo: 10 }],
  });
  claim({
    serial: "SC680-252409963",
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
      lines: [{ serial: "SM482V-261804517", batchNumber: "2618-L02", model: "SM482V" }],
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
      serials: ["SRS1-252612087"],
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
    payload: { customerId: "c-bwalker", products: ["SRS1-252612087"] },
    at: ts(daysAgo(60), "09:05:00"),
  });

  // ── Extended warranties ─────────────────────────────────────────────────────
  // Sold by the selling dealer soon after purchase (or by `by`), so the finance insights have revenue to show.
  function extend(spec: {
    serial: string;
    months: number;
    soldDaysAgo: number;
    by?: { id: string; name: string };
  }) {
    const unit = unitBySerial(spec.serial);
    const m = state.models.find((x) => x.id === unit.modelId)!;
    const seller = spec.by ?? dealerUser(unit.dealerId!);
    const previousEnd = unit.warrantyEnd!;
    const newEnd = addMonthsIso(previousEnd, spec.months);
    const price = extensionPrice(m.listPrice, spec.months);
    const at = ts(daysAgo(spec.soldDaysAgo), "11:00:00");
    const id = nextId("EXT");
    unit.extensions = [
      ...(unit.extensions ?? []),
      {
        id,
        months: spec.months,
        price,
        previousEnd,
        newEnd,
        soldBy: seller.id,
        soldByName: seller.name,
        dealerId: unit.dealerId,
        at,
      },
    ];
    unit.warrantyEnd = newEnd;
    unit.history.push({
      at,
      type: "extended",
      byName: seller.name,
      text: `Warranty extended by ${spec.months} months to ${newEnd}`,
      refId: id,
    });
    message({
      system: "FINANCE",
      direction: "OUT",
      type: "extension_invoice",
      status: "SUCCESS",
      refId: id,
      payload: {
        extensionId: id,
        serial: unit.serial,
        model: m.code,
        months: spec.months,
        price,
        currency: "USD",
        soldBy: seller.id,
        dealerId: unit.dealerId,
      },
      at,
    });
  }

  extend({ serial: "SC480-252510384", months: 12, soldDaysAgo: 150 });
  extend({ serial: "STA2-252103356", months: 24, soldDaysAgo: 200 });
  extend({ serial: "SRS1-252612087", months: 36, soldDaysAgo: 55 });

  // ── Demo volume (generated) ─────────────────────────────────────────────────
  // After everything above, so the named data keeps its ids. `rand` decides what is generated; `labelRand` only picks
  // label numbers, so the counts and amounts never depend on `today` (which moves the dates and label weeks).
  const rand = mulberry32(20260930);
  const labelRand = mulberry32(7342);
  const int = (min: number, max: number, random = rand) => min + Math.floor(random() * (max - min + 1));
  function pick<T>(items: readonly T[]): T {
    return items[Math.floor(rand() * items.length)]!;
  }
  function weighted<T>(entries: readonly (readonly [T, number])[]): T {
    let x = rand() * entries.reduce((n, [, w]) => n + w, 0);
    for (const [value, w] of entries) {
      x -= w;
      if (x < 0) return value;
    }
    return entries[entries.length - 1]![0];
  }
  // Business hours in UTC (15:00-23:00 = 8 AM-4 PM Pacific). Records dated today go just after midnight Pacific
  // (07:xx UTC) instead, so a reset during the day never shows activity later than now.
  const at = (days: number, hour: number, minute = 0, second = 0) =>
    ts(
      daysAgo(days),
      [days <= 0 ? 7 : hour, minute, second].map((n) => String(n).padStart(2, "0")).join(":"),
    );
  const customerById = (id: string) => state.customers.find((c) => c.id === id)!;
  const modelOf = (unit: Unit) => state.models.find((m) => m.id === unit.modelId)!;

  for (const [id, name, phone, email, city, st, zip] of MORE_CUSTOMERS) {
    state.customers.push({ id, name, phone, email, city, state: st, zip });
  }
  const buyers = state.customers.filter((c) => c.id !== "c-mreed");
  const buyerWeights = (inState?: string) =>
    buyers
      .filter((c) => !inState || c.state === inState)
      .map((c) => [c.id, CONTRACTORS.has(c.id) ? 4 : 1] as const);
  const catalogueWeights = state.models.map((m) => [m.code, MODEL_WEIGHTS[m.code] ?? 1] as const);

  const usedNumbers = new Set(
    [...state.units, ...state.registrations].map((x) => serialNumberPart(x.serial)),
  );
  /** A new label (serial and batch) for a product built a few weeks before it was sold `soldDaysAgo`. */
  function label(modelCode: string, soldDaysAgo: number) {
    let builtDaysAgo = soldDaysAgo + int(14, 90, labelRand);
    while (!isFreeLabel(labelWeek(daysAgo(builtDaysAgo)))) builtDaysAgo += 7;
    const week = labelWeek(daysAgo(builtDaysAgo));
    let number = "";
    while (!number || usedNumbers.has(number) || !isFreeLabel(`${modelCode}-${number}`)) {
      number = `${week}${int(70000, 99999, labelRand)}`;
    }
    usedNumbers.add(number);
    return { serial: `${modelCode}-${number}`, batchNumber: `${week}-L0${int(5, 8, labelRand)}` };
  }

  type Person = {
    id?: string;
    name: string;
    phone?: string;
    email?: string;
    city?: string;
    state?: string;
    zip?: string;
  };
  function submitterFor(channel: RegistrationChannel, person: Person, dealerId?: string) {
    const partner = state.partnerClients.find((p) => p.channel === channel);
    if (channel === "PORTAL") return { id: person.id ?? "public", name: person.name };
    if (channel === "WEB") return { id: "public", name: `Web form: ${person.name}` };
    if (channel === "EMAIL") return { id: "system", name: `Email from ${person.email ?? "customer"}` };
    if (channel === "ERP") return { id: "system", name: "ERP sales feed" };
    if (partner) return { id: `partner:${partner.id}`, name: partner.name };
    const user = dealerUser(dealerId!);
    return { id: user.id, name: user.name };
  }
  const customerFields = (p: Person) => ({
    name: p.name,
    phone: p.phone,
    email: p.email,
    city: p.city,
    state: p.state,
    zip: p.zip,
  });

  /** Days ago each generated product was bought. */
  const purchased = new Map<string, number>();
  /** Registered products the claims, extended warranties and voids are drawn from. */
  const generated: Unit[] = [];

  /** A registered product with its approved registration, as the channel's intake would have recorded them. */
  function enroll(spec: {
    model: string;
    channel: RegistrationChannel;
    customerId: string;
    dealerId?: string;
    purchasedDaysAgo: number;
    submittedDaysAgo: number;
    placeOfPurchase?: string;
    label?: { serial: string; batchNumber: string };
  }): Unit {
    const m = modelByCode(spec.model);
    const customer = customerById(spec.customerId);
    const { serial, batchNumber } = spec.label ?? label(m.code, spec.purchasedDaysAgo);
    const purchaseDate = daysAgo(spec.purchasedDaysAgo);
    const hour = int(15, 20);
    const minute = int(0, 59);
    const submitter = submitterFor(spec.channel, customer, spec.dealerId);
    const trusted = TRUSTED_CHANNELS.has(spec.channel);
    const reviewer = trusted
      ? `Auto-approved (${spec.channel === "BULK" ? "dealer bulk upload" : submitter.name})`
      : "Warranty Desk";
    const reviewedAt = trusted
      ? at(spec.submittedDaysAgo, hour, minute, 5)
      : at(spec.submittedDaysAgo, hour + 3, minute);
    const registrationId = nextId("REG");
    state.registrations.push({
      id: registrationId,
      channel: spec.channel,
      status: "APPROVED",
      flags: [],
      serial,
      batchNumber,
      modelCode: m.code,
      customer: customerFields(customer),
      customerId: customer.id,
      dealerId: spec.dealerId,
      purchaseDate,
      placeOfPurchase: spec.placeOfPurchase,
      attachmentIds: [],
      submittedBy: submitter.id,
      submittedByName: submitter.name,
      submittedAt: at(spec.submittedDaysAgo, hour, minute),
      reviewedByName: reviewer,
      reviewedAt,
    });
    const unit: Unit = {
      serial,
      batchNumber,
      modelId: m.id,
      dealerId: spec.dealerId,
      customerId: customer.id,
      purchaseDate,
      placeOfPurchase: spec.placeOfPurchase,
      warrantyStart: purchaseDate,
      warrantyEnd: warrantyEndFor(purchaseDate, m.warrantyMonths),
      registrationId,
      attachmentIds: [],
      history: [{ at: reviewedAt, type: "registered", byName: reviewer, refId: registrationId }],
    };
    state.units.push(unit);
    purchased.set(serial, spec.purchasedDaysAgo);
    return unit;
  }

  // Marcus Reed (customer login): five more products with fixed labels, next to his first three.
  enroll({
    model: "MG44",
    channel: "DEALER",
    customerId: "c-mreed",
    dealerId: "d-lonestar",
    purchasedDaysAgo: 120,
    submittedDaysAgo: 120,
    label: { serial: "MG44-253177420", batchNumber: "2531-L05" },
  });
  enroll({
    model: "JL3KR4",
    channel: "PORTAL",
    customerId: "c-mreed",
    dealerId: "d-lonestar",
    purchasedDaysAgo: 350,
    submittedDaysAgo: 347,
    label: { serial: "JL3KR4-252479315", batchNumber: "2524-L06" },
  });
  enroll({
    model: "SM480V",
    channel: "DEALER",
    customerId: "c-mreed",
    dealerId: "d-lonestar",
    purchasedDaysAgo: 300,
    submittedDaysAgo: 300,
    label: { serial: "SM480V-252586104", batchNumber: "2525-L05" },
  });
  enroll({
    model: "DR58",
    channel: "DEALER",
    customerId: "c-mreed",
    dealerId: "d-lonestar",
    purchasedDaysAgo: 200,
    submittedDaysAgo: 200,
    label: { serial: "DR58-252891567", batchNumber: "2528-L07" },
  });
  enroll({
    model: "SC440",
    channel: "JOBLINK",
    customerId: "c-mreed",
    purchasedDaysAgo: 25,
    submittedDaysAgo: 25,
    label: { serial: "SC440-263473208", batchNumber: "2634-L05" },
  });
  extend({
    serial: "SM480V-252586104",
    months: 24,
    soldDaysAgo: 290,
    by: { id: "u-mreed", name: "Marcus Reed" },
  });
  claim({
    serial: "DR58-252891567",
    source: "CUSTOMER",
    issueType: "INACCURATE_READING",
    description: "Alarms on clean air and misses a known leak at the service valve.",
    filedDaysAgo: 90,
    resolution: "REPAIR",
    decisionNote: "Replaced the sensor and recalibrated.",
    steps: [
      { status: "IN_REVIEW", daysAgo: 89 },
      { status: "APPROVED", daysAgo: 86, text: "Replace the sensor at the service center." },
      { status: "CLOSED", daysAgo: 76, text: "Replaced the sensor and recalibrated." },
    ],
  });

  /** Days ago a product was bought: two thirds still under warranty (busier recently and in the spring and summer season), about a tenth expiring soon, the rest expired in the last two months. */
  function purchaseDaysAgo(): number {
    const r = rand();
    if (r < 0.66) return rand() < 0.25 ? int(75, 165) : Math.floor(330 * rand() ** 1.3);
    if (r < 0.78) return int(337, 362);
    return int(368, 425);
  }
  /** Days between purchase and registration: customers register a few days later, the rest at the sale. */
  const lagFor = (channel: RegistrationChannel) =>
    channel === "PORTAL" || channel === "WEB" || channel === "EMAIL" ? int(1, 6) : 0;

  // Dealers' products, the last few of each registered this month (between the 1st and today).
  const monthDay = Number(today.slice(8, 10));
  for (const [dealerId, count] of [
    ["d-lonestar", 66],
    ["d-bayou", 48],
    ["d-desertpeak", 36],
  ] as const) {
    const dealer = state.dealers.find((d) => d.id === dealerId)!;
    const customers = buyerWeights(dealer.state);
    for (let i = 0; i < count + 7; i += 1) {
      const recent = i >= count;
      let channel = weighted(DEALER_CHANNELS[dealerId]!);
      const customer = customerById(weighted(customers));
      if (channel === "EMAIL" && !customer.email) channel = "PORTAL";
      const lag = lagFor(channel);
      const submittedDaysAgo = recent ? Math.floor(rand() * monthDay) : undefined;
      const purchasedDaysAgo = submittedDaysAgo === undefined ? purchaseDaysAgo() : submittedDaysAgo + lag;
      const unit = enroll({
        model: weighted(catalogueWeights),
        channel,
        customerId: customer.id,
        dealerId,
        purchasedDaysAgo,
        submittedDaysAgo: submittedDaysAgo ?? Math.max(0, purchasedDaysAgo - lag),
      });
      if (!recent) generated.push(unit);
    }
  }
  // Fieldpiece's apps (no dealer: technicians register on the job), the online marketplace and direct customers.
  for (const [channel, count] of [
    ["JOBLINK", 29],
    ["OVERWATCH", 20],
    ["RETAIL", 6],
    ["WEB", 3],
    ["PORTAL", 3],
  ] as const) {
    for (let i = 0; i < count; i += 1) {
      const customer = customerById(weighted(buyerWeights()));
      const lag = lagFor(channel);
      const purchasedDaysAgo = purchaseDaysAgo();
      generated.push(
        enroll({
          model:
            channel === "JOBLINK" || channel === "OVERWATCH"
              ? weighted(APP_MODEL_WEIGHTS[channel])
              : weighted(catalogueWeights),
          channel,
          customerId: customer.id,
          purchasedDaysAgo,
          submittedDaysAgo: Math.max(0, purchasedDaysAgo - lag),
          placeOfPurchase:
            channel === "RETAIL"
              ? "Online marketplace"
              : channel === "JOBLINK" || channel === "OVERWATCH"
                ? undefined
                : pick(["Online retailer", "Trade show", "Local supply house"]),
        }),
      );
    }
  }

  // Warranty claims on the generated products, filed inside the warranty: open ones recently, decided ones over the
  // last eleven months (days ago, from..to).
  const claimed = new Set<string>();
  function claimTarget(from: number, to: number): { unit: Unit; filedDaysAgo: number } {
    for (;;) {
      const unit = pick(generated);
      const bought = purchased.get(unit.serial)!;
      const first = Math.max(from, bought - 360);
      const last = Math.min(to, bought - 7);
      if (claimed.has(unit.serial) || first > last) continue;
      claimed.add(unit.serial);
      return { unit, filedDaysAgo: int(first, last) };
    }
  }
  const plans: [ClaimStatus, Resolution | undefined, number][] = [
    ["CLOSED", "REPAIR", 12],
    ["CLOSED", "CREDIT", 6],
    ["CLOSED", "REPLACE", 3],
    ["APPROVED", "REPAIR", 3],
    ["APPROVED", "REPLACE", 2],
    ["APPROVED", "CREDIT", 1],
    ["REJECTED", undefined, 7],
    ["IN_REVIEW", undefined, 6],
    ["SUBMITTED", undefined, 5],
  ];
  const windows: Record<ClaimStatus, [number, number]> = {
    SUBMITTED: [0, 6],
    IN_REVIEW: [2, 20],
    APPROVED: [8, 40],
    REJECTED: [20, 330],
    CLOSED: [25, 330],
  };
  const approvalText: Record<Resolution, string> = {
    REPAIR: "Repair at the service center under warranty.",
    REPLACE: "Fault confirmed; replace the product.",
    CREDIT: "Credit the purchase price to the account.",
  };
  for (const [status, resolution, count] of plans) {
    for (let i = 0; i < count; i += 1) {
      const { unit, filedDaysAgo } = claimTarget(...windows[status]);
      const m = modelOf(unit);
      const issues = ISSUES.filter(([, categories]) =>
        categories === "*"
          ? m.categoryId !== "cat-accessories"
          : categories.split(" ").includes(m.categoryId),
      );
      const [issueType, , description] = pick(issues.length ? issues : ISSUES);
      const source: ClaimSource = unit.dealerId
        ? weighted([
            ["DEALER", 5],
            ["CUSTOMER", 4],
            ["ADMIN", 1],
          ] as const)
        : weighted([
            ["CUSTOMER", 4],
            ["ADMIN", 1],
          ] as const);
      const reviewed = filedDaysAgo - 1;
      const steps: { status: ClaimStatus; daysAgo: number; text?: string }[] = [];
      let rejectReason: string | undefined;
      let replacement: { serial: string; batchNumber: string } | undefined;
      if (status === "IN_REVIEW") steps.push({ status, daysAgo: filedDaysAgo - int(0, 2) });
      if (status === "REJECTED") {
        rejectReason = pick(REJECT_REASONS);
        steps.push({ status: "IN_REVIEW", daysAgo: reviewed });
        steps.push({ status, daysAgo: reviewed - int(1, 3), text: rejectReason });
      }
      if (status === "APPROVED" || status === "CLOSED") {
        const approved = reviewed - int(1, 4);
        steps.push({ status: "IN_REVIEW", daysAgo: reviewed });
        steps.push({ status: "APPROVED", daysAgo: approved, text: approvalText[resolution!] });
        if (status === "CLOSED") {
          const closed = approved - int(3, 10);
          if (resolution === "REPLACE") replacement = label(m.code, closed);
          steps.push({
            status,
            daysAgo: closed,
            text: resolution === "REPAIR" ? "Repaired and returned." : undefined,
          });
        }
      }
      claim({
        serial: unit.serial,
        source,
        issueType,
        description,
        filedDaysAgo,
        steps,
        resolution,
        creditAmount:
          resolution === "CREDIT" ? Math.round(m.listPrice * pick([1, 0.75, 0.5]) * 100) / 100 : undefined,
        rejectReason,
        decisionNote: resolution === "REPAIR" && status === "CLOSED" ? "Repaired and returned." : undefined,
        replacement,
      });
    }
  }

  // Extended warranties, sold while the warranty still had at least two months to run (mostly by the dealer).
  const extended = new Set<string>();
  for (let sold = 0; sold < 14;) {
    const unit = pick(generated);
    const bought = purchased.get(unit.serial)!;
    const first = Math.max(1, bought - 300);
    const last = Math.min(330, bought - 1);
    if (claimed.has(unit.serial) || extended.has(unit.serial) || first > last) continue;
    extended.add(unit.serial);
    const months = weighted([
      [12, 5],
      [24, 3],
      [36, 2],
    ] as const);
    const byDealer = !!unit.dealerId && rand() < 0.85;
    extend({
      serial: unit.serial,
      months,
      soldDaysAgo: int(first, last),
      by: byDealer ? undefined : { id: "u-admin", name: "Warranty Desk" },
    });
    sold += 1;
  }

  // Voided warranties (W5), on products still under warranty.
  for (let voided = 0; voided < 6;) {
    const unit = pick(generated);
    const bought = purchased.get(unit.serial)!;
    if (claimed.has(unit.serial) || extended.has(unit.serial) || unit.void || bought > 330 || bought < 10)
      continue;
    const [reason, note] = pick(VOID_NOTES);
    const when = at(int(1, Math.min(bought - 3, 150)), 17, int(0, 59));
    unit.void = { reason, note, by: "u-admin", byName: "Warranty Desk", at: when };
    unit.history.push({ at: when, type: "voided", byName: "Warranty Desk", reason, text: note });
    voided += 1;
  }

  // Shipped to dealers on ERP invoices and not registered yet (awaiting registration).
  const awaiting: Unit[] = [];
  for (const shipment of [
    { invoice: "GS-240602", dealerId: "d-lonestar", shippedDaysAgo: 41, count: 3 },
    { invoice: "GS-240688", dealerId: "d-bayou", shippedDaysAgo: 27, count: 4 },
    { invoice: "FP-118204", dealerId: "d-desertpeak", shippedDaysAgo: 18, count: 3 },
    { invoice: "GS-240731", dealerId: "d-lonestar", shippedDaysAgo: 6, count: 2 },
  ]) {
    const dealer = state.dealers.find((d) => d.id === shipment.dealerId)!;
    const lines: { serial: string; batchNumber: string; model: string }[] = [];
    for (let i = 0; i < shipment.count; i += 1) {
      const m = modelByCode(weighted(catalogueWeights));
      const { serial, batchNumber } = label(m.code, shipment.shippedDaysAgo);
      const unit: Unit = {
        serial,
        batchNumber,
        modelId: m.id,
        dealerId: dealer.id,
        attachmentIds: [],
        history: [
          {
            at: at(shipment.shippedDaysAgo, 15, 30),
            type: "note",
            byName: "ERP sales feed",
            text: `Shipped to ${dealer.name} on invoice ${shipment.invoice}`,
          },
        ],
      };
      state.units.push(unit);
      awaiting.push(unit);
      lines.push({ serial, batchNumber, model: m.code });
    }
    message({
      system: "ERP",
      direction: "IN",
      type: "erp_invoice",
      status: "SUCCESS",
      refId: shipment.invoice,
      payload: { invoice: shipment.invoice, dealer: dealer.name, lines },
      at: at(shipment.shippedDaysAgo, 15),
    });
  }

  // The review inbox: registrations waiting for the warranty desk, and a few it rejected.
  function inbox(spec: {
    channel: RegistrationChannel;
    serial: string;
    batchNumber?: string;
    modelCode: string;
    person: Person;
    dealerId?: string;
    purchasedDaysAgo: number;
    submittedDaysAgo: number;
    flags: RegistrationFlag[];
    placeOfPurchase?: string;
    rejectReason?: string;
  }) {
    const submitter = submitterFor(spec.channel, spec.person, spec.dealerId);
    const hour = int(15, 20);
    const minute = int(0, 59);
    state.registrations.push({
      id: nextId("REG"),
      channel: spec.channel,
      status: spec.rejectReason ? "REJECTED" : "PENDING",
      flags: spec.flags,
      serial: spec.serial,
      batchNumber: spec.batchNumber,
      modelCode: spec.modelCode,
      customer: customerFields(spec.person),
      customerId: spec.channel === "PORTAL" ? spec.person.id : undefined,
      dealerId: spec.dealerId,
      purchaseDate: daysAgo(spec.purchasedDaysAgo),
      placeOfPurchase: spec.placeOfPurchase,
      attachmentIds: [],
      submittedBy: submitter.id,
      submittedByName: submitter.name,
      submittedAt: at(spec.submittedDaysAgo, hour, minute),
      duplicateOfSerial: spec.flags.includes("DUPLICATE") ? spec.serial : undefined,
      rejectReason: spec.rejectReason,
      reviewedByName: spec.rejectReason ? "Warranty Desk" : undefined,
      reviewedAt: spec.rejectReason ? at(spec.submittedDaysAgo - 1, 17, minute) : undefined,
    });
  }
  const walkIn = (i: number): Person => {
    const [name, email, phone, city, st, zip] = WALK_INS[i]!;
    return { name, email, phone, city, state: st, zip };
  };
  /** A new label nobody registered yet (the serial is unknown to the system). */
  const unknownLabel = (modelCode: string, soldDaysAgo: number) => ({
    modelCode,
    ...label(modelCode, soldDaysAgo),
  });
  const duplicateOf = (dealerId?: string) => {
    for (;;) {
      const unit = pick(generated);
      if (!unit.void && !unit.replacedBySerial && (!dealerId || unit.dealerId === dealerId)) {
        return { serial: unit.serial, batchNumber: unit.batchNumber, modelCode: modelOf(unit).code };
      }
    }
  };
  // Customers registering products their dealer received from the ERP: known serial, nothing to flag.
  for (const unit of [awaiting[0]!, awaiting[1]!, awaiting[3]!, awaiting[4]!, awaiting[7]!]) {
    const dealer = state.dealers.find((d) => d.id === unit.dealerId)!;
    const shipped = awaiting.indexOf(unit) < 3 ? 41 : awaiting.indexOf(unit) < 7 ? 27 : 18;
    const submittedDaysAgo = int(0, 9);
    inbox({
      channel: "PORTAL",
      serial: unit.serial,
      batchNumber: unit.batchNumber,
      modelCode: modelOf(unit).code,
      person: customerById(weighted(buyerWeights(dealer.state))),
      dealerId: dealer.id,
      purchasedDaysAgo: Math.min(shipped - 1, submittedDaysAgo + int(1, 5)),
      submittedDaysAgo,
      flags: [],
    });
  }
  // Serials the system doesn't know yet.
  for (const [i, channel, modelCode, placeOfPurchase] of [
    [0, "WEB", "SC480", "Lone Star Refrigeration Supply"],
    [2, "WEB", "VP67", "Desert Peak HVAC Supply"],
    [3, "WEB", "SRS3", "Online retailer"],
    [4, "EMAIL", "MG44", undefined],
    [1, "EMAIL", "SC260", "Bayou Air Parts"],
  ] as const) {
    const submittedDaysAgo = int(0, 9);
    const purchasedDaysAgo = submittedDaysAgo + int(1, 6);
    inbox({
      channel,
      ...unknownLabel(modelCode, purchasedDaysAgo),
      person: walkIn(i),
      purchasedDaysAgo,
      submittedDaysAgo,
      flags: ["EXCEPTION"],
      placeOfPurchase,
    });
  }
  // Serials already registered to someone else: the partner channels send them to review as duplicates.
  for (const [channel, person, dealerId] of [
    ["JOBLINK", walkIn(5), undefined],
    ["OVERWATCH", walkIn(6), undefined],
    ["RETAIL", walkIn(7), undefined],
    ["BULK", customerById(weighted(buyerWeights("LA"))), "d-bayou"],
  ] as const) {
    const submittedDaysAgo = int(0, 9);
    inbox({
      channel,
      ...duplicateOf(dealerId),
      person: { ...person, id: undefined },
      dealerId,
      purchasedDaysAgo: submittedDaysAgo + int(0, 3),
      submittedDaysAgo,
      flags: ["DUPLICATE", "EXCEPTION"],
      placeOfPurchase: channel === "RETAIL" ? "Online marketplace" : undefined,
    });
  }
  // A label number we know under another model: the customer picked the wrong model.
  {
    const unit = pick(generated.filter((u) => modelOf(u).categoryId === "cat-clamp"));
    const actual = modelOf(unit).code;
    const picked = actual === "SC680" ? "SC480" : "SC680";
    const submittedDaysAgo = int(0, 9);
    inbox({
      channel: "PORTAL",
      serial: `${picked}-${serialNumberPart(unit.serial)}`,
      batchNumber: unit.batchNumber,
      modelCode: picked,
      person: customerById(weighted(buyerWeights())),
      purchasedDaysAgo: submittedDaysAgo + int(1, 5),
      submittedDaysAgo,
      flags: ["EXCEPTION", "MODEL_MISMATCH"],
    });
  }
  // Rejected by the warranty desk.
  {
    const unit = awaiting[2]!;
    const submittedDaysAgo = int(8, 35);
    inbox({
      channel: "PORTAL",
      serial: unit.serial,
      batchNumber: unit.batchNumber,
      modelCode: modelOf(unit).code,
      person: customerById(weighted(buyerWeights("TX"))),
      dealerId: unit.dealerId,
      purchasedDaysAgo: Math.min(40, submittedDaysAgo + int(1, 5)),
      submittedDaysAgo,
      flags: [],
      rejectReason: "The invoice photo is unreadable; please upload a clearer copy.",
    });
  }
  for (const [channel, person, dealerId, rejectReason] of [
    [
      "EMAIL",
      customerById(weighted(buyerWeights("LA"))),
      "d-bayou",
      "Already registered to another customer; the dealer confirmed the original sale.",
    ],
    [
      "DEALER",
      customerById(weighted(buyerWeights("AZ"))),
      "d-desertpeak",
      "Entered twice; the product is already registered.",
    ],
    ["JOBLINK", walkIn(1), undefined, "Duplicate of the selling dealer's registration."],
  ] as const) {
    const submittedDaysAgo = int(10, 120);
    inbox({
      channel,
      ...duplicateOf(dealerId),
      person: { ...person, id: undefined },
      dealerId,
      purchasedDaysAgo: submittedDaysAgo + int(0, 3),
      submittedDaysAgo,
      flags: ["DUPLICATE", "EXCEPTION"],
      rejectReason,
    });
  }
  {
    const submittedDaysAgo = int(10, 120);
    const purchasedDaysAgo = submittedDaysAgo + int(1, 6);
    inbox({
      channel: "WEB",
      ...unknownLabel("VP87", purchasedDaysAgo),
      person: walkIn(3),
      purchasedDaysAgo,
      submittedDaysAgo,
      flags: ["EXCEPTION"],
      placeOfPurchase: "Online retailer",
      rejectReason: "We couldn't find this serial number; please check the label and register again.",
    });
  }

  return state;
}

/** The mock database with the starting data, dated from `today`. */
export function createSeed(today: IsoDate = todayIso()): DemoState {
  const seed = createSeedData(today);
  return {
    version: 4,
    categories: seed.categories,
    models: seed.models,
    distributors: seed.distributors,
    dealers: seed.dealers,
    customers: seed.customers,
    users: seed.users,
    units: seed.units.map((u) => ({
      ...u,
      // Product events in the order they were recorded (as the backend stores them).
      history: [...u.history].sort((a, b) => a.at.localeCompare(b.at)),
    })),
    registrations: seed.registrations,
    claims: seed.claims,
    integrations: seed.integrations,
    notifications: [],
    attachments: [],
    bulkImports: [],
    partnerClients: seed.partnerClients.map((p) => {
      const apiKey = DEMO_PARTNER_KEYS[p.id];
      return {
        ...p,
        apiKey,
        keyPrefix: apiKey.slice(0, 12),
        active: true,
        createdAt: ts(today, "00:00:00"),
      };
    }),
    counters: seed.counters,
  };
}

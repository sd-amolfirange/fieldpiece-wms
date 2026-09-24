import { addDays, addMonths, subDays } from "date-fns";
import type {
  Claim,
  ClaimStatus,
  Customer,
  FailureCategory,
  Product,
  Registration,
  Rma,
  WarrantyPolicy,
} from "@/types";

// LEGACY fixtures for the out-of-scope screens (public check, RMA, customers). The demo seed lives in
// src/demo-core/seed.ts.

const TODAY = new Date();
const iso = (d: Date) => d.toISOString();
const isoDate = (d: Date) => iso(d).slice(0, 10);

export const products: Product[] = [
  { sku: "SC680", name: "Clamp meter", family: "meters", warrantyMonths: 36, launchDate: "2019-01-01" },
  {
    sku: "SMAN460",
    name: "Digital manifold",
    family: "gauges",
    warrantyMonths: 36,
    launchDate: "2018-06-01",
  },
  { sku: "VP85", name: "Vacuum pump", family: "vacuum", warrantyMonths: 24, launchDate: "2017-03-01" },
  {
    sku: "DR82",
    name: "Refrigerant leak detector",
    family: "leak_detection",
    warrantyMonths: 24,
    launchDate: "2020-02-01",
  },
  {
    sku: "CAT85",
    name: "Combustion analyzer",
    family: "combustion",
    warrantyMonths: 24,
    launchDate: "2021-05-01",
  },
  {
    sku: "STA2",
    name: "Hot wire anemometer",
    family: "airflow",
    warrantyMonths: 12,
    launchDate: "2016-09-01",
  },
];

export const policies: WarrantyPolicy[] = products.map((p, i) => ({
  id: `pol-${i + 1}`,
  sku: p.sku,
  baseMonths: p.warrantyMonths,
  extensionMonthsOnRegistration: 0,
  coverage: ["manufacturing_defects"],
  exclusions: ["physical_damage", "misuse", "consumables"],
  effectiveFrom: "2020-01-01",
}));

export const customers: Customer[] = [
  { id: "c-1", name: "Sam Tech", email: "tech@example.com", distributorId: "d-1" },
  { id: "c-2", name: "Northside Heating & Air", email: "office@example.com", distributorId: "d-1" },
  { id: "c-3", name: "Coastal Refrigeration", email: "service@example.org", distributorId: "d-1" },
];

function registration(i: number, sku: string, purchaseDaysAgo: number, customerId: string): Registration {
  const product = products.find((p) => p.sku === sku) ?? products[0]!;
  const purchase = subDays(TODAY, purchaseDaysAgo);
  const end = addMonths(purchase, product.warrantyMonths);
  const daysLeft = (end.getTime() - TODAY.getTime()) / 86_400_000;
  return {
    id: `reg-${i}`,
    serialNumber: `${sku}-${String(100000 + i * 37)}`,
    sku,
    customerId,
    distributorId: "d-1",
    purchaseDate: isoDate(purchase),
    proofOfPurchase: [],
    warrantyStart: isoDate(purchase),
    warrantyEnd: isoDate(end),
    status: daysLeft < 0 ? "EXPIRED" : daysLeft <= 60 ? "EXPIRING_SOON" : "ACTIVE",
    createdAt: iso(purchase),
  };
}

export const registrations: Registration[] = [
  registration(1, "SC680", 120, "c-1"),
  registration(2, "SMAN460", 700, "c-1"),
  registration(3, "VP85", 800, "c-2"),
  registration(4, "DR82", 30, "c-2"),
  registration(5, "STA2", 500, "c-3"),
  registration(6, "CAT85", 200, "c-3"),
];

const STATUSES: ClaimStatus[] = [
  "SUBMITTED",
  "IN_REVIEW",
  "NEEDS_INFO",
  "APPROVED",
  "RMA_ISSUED",
  "IN_TRANSIT",
  "RECEIVED",
  "REPAIRED",
  "REJECTED",
  "CLOSED",
  "DRAFT",
];
const CATEGORIES: FailureCategory[] = [
  "no_power",
  "inaccurate_reading",
  "display",
  "connectivity",
  "physical",
  "leak",
  "other",
];

export const claims: Claim[] = Array.from({ length: 42 }, (_, index) => {
  const n = index + 1;
  const reg = registrations[index % registrations.length]!;
  const status = STATUSES[index % STATUSES.length]!;
  const created = subDays(TODAY, (index * 3) % 60);
  return {
    id: `CLM-${String(n).padStart(6, "0")}`,
    registrationId: reg.id,
    serialNumber: reg.serialNumber,
    sku: reg.sku,
    failureCategory: CATEGORIES[index % CATEGORIES.length]!,
    description:
      "Unit powers on but the reading drifts after a few minutes on the job. Checked with a second meter.",
    failureDate: isoDate(subDays(created, 2)),
    attachments: [],
    status,
    assignedTo: index % 3 === 0 ? undefined : "u-agent",
    slaDueAt: iso(addDays(created, 3)),
    history: [
      {
        at: iso(created),
        actor: { id: "u-tech", name: "Sam Tech", role: "dealer" },
        type: "created",
        to: "SUBMITTED",
      },
      {
        at: iso(addDays(created, 1)),
        actor: { id: "u-agent", name: "Casey Agent", role: "admin" },
        type: "comment",
        comment: "Asked the customer for a photo of the display.",
        internal: true,
      },
    ],
    createdAt: iso(created),
    updatedAt: iso(addDays(created, 1)),
  };
});

export const rmas: Rma[] = claims
  .filter((c) => ["RMA_ISSUED", "IN_TRANSIT", "RECEIVED", "REPAIRED"].includes(c.status))
  .map((c, i) => ({
    id: `RMA-${String(i + 1).padStart(6, "0")}`,
    claimId: c.id,
    type: "repair",
    shipTo: { line1: "1636 W Collins Ave", city: "Orange", region: "CA", postalCode: "92867", country: "US" },
    status:
      c.status === "RMA_ISSUED"
        ? "ISSUED"
        : c.status === "IN_TRANSIT"
          ? "IN_TRANSIT"
          : c.status === "RECEIVED"
            ? "RECEIVED"
            : "COMPLETED",
  }));

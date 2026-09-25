import { type ClaimStatus, PrismaClient, type ProductFamily } from "@prisma/client";
import { addUtcDays, parseIsoDate, startOfUtcDay } from "../src/common/time/utc-date";
import { computeWarranty } from "../src/modules/warranty/warranty.engine";

// Idempotent seed (build guide Section 5.5): safe to run repeatedly. Everything uses fixed IDs + upsert.
// SKUs, names and warranty terms are SAMPLE DATA until Fieldpiece confirms them. [CONFIRM]

const prisma = new PrismaClient();
const today = startOfUtcDay(new Date());
const daysAgo = (n: number) => addUtcDays(today, -n);

// Deterministic IDs so re-runs update instead of duplicating.
const id = (prefix: string, n: number) => `${prefix}-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ORG = {
  fieldpiece: id("00000000", 1),
  distributor: id("00000000", 2),
  serviceCenter: id("00000000", 3),
  distributor2: id("00000000", 4),
};
const USER = {
  tech: id("10000000", 1),
  dist: id("10000000", 2),
  agent: id("10000000", 3),
  svc: id("10000000", 4),
  admin: id("10000000", 5),
};
const POLICY_DEFAULT = id("20000000", 1);

const FAILURE_CATEGORIES = [
  { code: "no_power", label: "No power", requiresPhoto: false },
  { code: "inaccurate_reading", label: "Inaccurate reading", requiresPhoto: false },
  { code: "display", label: "Display", requiresPhoto: true },
  { code: "connectivity", label: "Connectivity", requiresPhoto: false },
  { code: "physical", label: "Physical damage", requiresPhoto: true },
  { code: "leak", label: "Leak", requiresPhoto: false },
  { code: "other", label: "Other", requiresPhoto: false },
];

const PRODUCTS: { sku: string; name: string; family: ProductFamily; launch: string; months?: number }[] = [
  { sku: "SC680", name: "Wireless clamp meter", family: "meters", launch: "2019-01-15", months: 36 },
  { sku: "SC660", name: "Clamp meter with temperature", family: "meters", launch: "2018-03-01", months: 36 },
  { sku: "SC640", name: "Loaded clamp meter", family: "meters", launch: "2017-06-01", months: 36 },
  { sku: "SC440", name: "Clamp meter", family: "meters", launch: "2016-02-01" },
  { sku: "SC260", name: "Compact clamp meter", family: "meters", launch: "2015-09-01" },
  { sku: "SMAN460", name: "Wireless digital manifold", family: "gauges", launch: "2018-06-01", months: 36 },
  { sku: "SMAN360", name: "Digital manifold", family: "gauges", launch: "2017-04-01", months: 24 },
  { sku: "SMAN340", name: "3-port digital manifold", family: "gauges", launch: "2016-08-01", months: 24 },
  { sku: "JL3PR", name: "Wireless pressure probe", family: "gauges", launch: "2020-02-01" },
  { sku: "VP85", name: "Vacuum pump, 8 CFM", family: "vacuum", launch: "2017-03-01", months: 24 },
  { sku: "VP67", name: "Vacuum pump, 6 CFM", family: "vacuum", launch: "2016-05-01", months: 24 },
  { sku: "MG44", name: "Wireless micron gauge", family: "vacuum", launch: "2019-10-01" },
  { sku: "MR45", name: "Refrigerant recovery machine", family: "recovery", launch: "2018-01-15", months: 24 },
  { sku: "DR82", name: "Refrigerant leak detector", family: "leak_detection", launch: "2020-02-01" },
  { sku: "DR58", name: "Heated diode leak detector", family: "leak_detection", launch: "2018-09-01" },
  { sku: "CAT45", name: "Combustion analyzer", family: "combustion", launch: "2021-05-01", months: 24 },
  { sku: "STA2", name: "Hot wire anemometer", family: "airflow", launch: "2016-09-01" },
  { sku: "SDMN6", name: "Dual-port manometer", family: "airflow", launch: "2017-11-01" },
  { sku: "SPK3", name: "Wireless psychrometer kit", family: "airflow", launch: "2019-04-01" },
  { sku: "LT17A", name: "Loaded temperature clamp", family: "other", launch: "2016-01-01" },
];

const serviceCenterAddress = {
  line1: "1636 W Collins Ave",
  city: "Orange",
  region: "CA",
  postalCode: "92867",
  country: "US",
};

async function referenceData() {
  for (const fc of FAILURE_CATEGORIES) {
    await prisma.failureCategory.upsert({ where: { code: fc.code }, create: fc, update: fc });
  }

  await prisma.warrantyPolicy.upsert({
    where: { id: POLICY_DEFAULT },
    create: {
      id: POLICY_DEFAULT,
      productId: null,
      baseMonths: 12,
      registrationBonusMonths: 12,
      registrationWindowDays: 60,
      coverage: ["manufacturing_defects"],
      exclusions: ["physical_damage", "misuse", "consumables"],
      effectiveFrom: parseIsoDate("2015-01-01"),
    },
    update: {},
  });

  for (const [i, p] of PRODUCTS.entries()) {
    const product = await prisma.product.upsert({
      where: { sku: p.sku },
      create: { sku: p.sku, name: p.name, family: p.family, launchDate: parseIsoDate(p.launch) },
      update: { name: p.name, family: p.family },
    });
    if (p.months) {
      const policyId = id("20000000", 100 + i);
      await prisma.warrantyPolicy.upsert({
        where: { id: policyId },
        create: {
          id: policyId,
          productId: product.id,
          baseMonths: p.months,
          coverage: ["manufacturing_defects"],
          exclusions: ["physical_damage", "misuse", "consumables"],
          effectiveFrom: parseIsoDate("2015-01-01"),
        },
        update: {},
      });
    }
  }

  // US federal holidays for SLA maths. [CONFIRM] calendar and regions.
  const holidays: [string, string][] = [
    ["2026-01-01", "New Year's Day"],
    ["2026-05-25", "Memorial Day"],
    ["2026-07-03", "Independence Day (observed)"],
    ["2026-09-07", "Labor Day"],
    ["2026-11-26", "Thanksgiving"],
    ["2026-12-25", "Christmas Day"],
    ["2027-01-01", "New Year's Day"],
  ];
  for (const [date, name] of holidays) {
    await prisma.holiday.upsert({
      where: { date: parseIsoDate(date) },
      create: { date: parseIsoDate(date), name },
      update: { name },
    });
  }
}

async function parties() {
  const orgs = [
    { id: ORG.fieldpiece, type: "fieldpiece", name: "Fieldpiece Instruments" },
    { id: ORG.distributor, type: "distributor", name: "Acme HVAC Supply", externalRef: "ERP-10042" },
    {
      id: ORG.distributor2,
      type: "distributor",
      name: "Summit Refrigeration Wholesale",
      externalRef: "ERP-10077",
    },
    {
      id: ORG.serviceCenter,
      type: "service_center",
      name: "Fieldpiece Service Center",
      address: serviceCenterAddress,
    },
  ];
  for (const o of orgs) await prisma.organization.upsert({ where: { id: o.id }, create: o, update: o });

  // One test identity per role. `dev|` subjects are what the dev IdP signs; in a real IdP tenant, map
  // these to test accounts instead.
  const users = [
    {
      id: USER.tech,
      email: "tech@example.com",
      displayName: "Sam Tech",
      roles: ["technician"],
      organizationId: null,
    },
    {
      id: USER.dist,
      email: "dist@example.com",
      displayName: "Dana Distributor",
      roles: ["distributor"],
      organizationId: ORG.distributor,
    },
    {
      id: USER.agent,
      email: "agent@example.com",
      displayName: "Casey Agent",
      roles: ["claims_agent"],
      organizationId: ORG.fieldpiece,
    },
    {
      id: USER.svc,
      email: "svc@example.com",
      displayName: "Riley Bench",
      roles: ["service_center"],
      organizationId: ORG.serviceCenter,
    },
    {
      id: USER.admin,
      email: "admin@example.com",
      displayName: "Alex Admin",
      roles: ["admin"],
      organizationId: ORG.fieldpiece,
    },
  ];
  for (const u of users) {
    const idpSubject = `dev|${u.email.split("@")[0]}`;
    await prisma.user.upsert({
      where: { id: u.id },
      create: { ...u, idpSubject },
      update: { ...u, idpSubject },
    });
  }
}

/** A small, consistent demo dataset so every role's screens have something to show. */
async function demoData() {
  const address = {
    line1: "200 Service Rd",
    city: "Fresno",
    region: "CA",
    postalCode: "93650",
    country: "US",
  };
  const customers = [
    { id: id("30000000", 1), userId: USER.tech, contactName: "Sam Tech", email: "tech@example.com", address },
    {
      id: id("30000000", 2),
      distributorId: ORG.distributor,
      companyName: "Northside Heating & Air",
      contactName: "Jordan Lee",
      email: "jordan@example.com",
      address,
    },
    {
      id: id("30000000", 3),
      distributorId: ORG.distributor,
      companyName: "Coastal Refrigeration",
      contactName: "Morgan Diaz",
      email: "morgan@example.com",
      address: { ...address, city: "San Diego", postalCode: "92101" },
    },
    {
      id: id("30000000", 4),
      distributorId: ORG.distributor2,
      companyName: "Peak Mechanical",
      contactName: "Taylor Kim",
      email: "taylor@example.com",
      address: { ...address, region: "NV", city: "Reno", postalCode: "89501" },
    },
  ];
  for (const c of customers) await prisma.customer.upsert({ where: { id: c.id }, create: c, update: {} });

  const regs: {
    n: number;
    sku: string;
    serial: string;
    customer: string;
    distributor: string | null;
    purchasedDaysAgo: number;
    by: string;
  }[] = [
    {
      n: 1,
      sku: "SC680",
      serial: "SC680-100037",
      customer: customers[0]!.id,
      distributor: null,
      purchasedDaysAgo: 120,
      by: USER.tech,
    },
    {
      n: 2,
      sku: "SMAN460",
      serial: "SMAN460-100074",
      customer: customers[0]!.id,
      distributor: null,
      purchasedDaysAgo: 700,
      by: USER.tech,
    },
    {
      n: 3,
      sku: "VP85",
      serial: "VP85-100111",
      customer: customers[1]!.id,
      distributor: ORG.distributor,
      purchasedDaysAgo: 690,
      by: USER.dist,
    },
    {
      n: 4,
      sku: "DR82",
      serial: "DR82-100148",
      customer: customers[1]!.id,
      distributor: ORG.distributor,
      purchasedDaysAgo: 30,
      by: USER.dist,
    },
    {
      n: 5,
      sku: "STA2",
      serial: "STA2-100185",
      customer: customers[2]!.id,
      distributor: ORG.distributor,
      purchasedDaysAgo: 500,
      by: USER.dist,
    },
    {
      n: 6,
      sku: "CAT45",
      serial: "CAT45-100222",
      customer: customers[2]!.id,
      distributor: ORG.distributor,
      purchasedDaysAgo: 200,
      by: USER.dist,
    },
    {
      n: 7,
      sku: "MR45",
      serial: "MR45-100259",
      customer: customers[3]!.id,
      distributor: ORG.distributor2,
      purchasedDaysAgo: 90,
      by: USER.admin,
    },
  ];
  const regIds: Record<number, string> = {};
  for (const r of regs) {
    const product = await prisma.product.findUniqueOrThrow({ where: { sku: r.sku } });
    const policy =
      (await prisma.warrantyPolicy.findFirst({ where: { productId: product.id } })) ??
      (await prisma.warrantyPolicy.findUniqueOrThrow({ where: { id: POLICY_DEFAULT } }));
    const purchaseDate = daysAgo(r.purchasedDaysAgo);
    const w = computeWarranty({ purchaseDate, registeredAt: addUtcDays(purchaseDate, 7), policy });
    const regId = id("40000000", r.n);
    regIds[r.n] = regId;
    await prisma.registration.upsert({
      where: { id: regId },
      create: {
        id: regId,
        serialNumber: r.serial,
        productId: product.id,
        customerId: r.customer,
        distributorId: r.distributor,
        policyId: policy.id,
        purchaseDate,
        warrantyStart: w.start,
        warrantyEnd: w.end,
        createdBy: r.by,
        createdAt: addUtcDays(purchaseDate, 7),
      },
      update: {},
    });
  }

  const description =
    "Unit powers on but the reading drifts after a few minutes on the job. Checked against a second meter.";
  const claims: {
    n: number;
    reg: number;
    by: string;
    status: ClaimStatus;
    category: string;
    daysAgo: number;
    assigned?: string;
  }[] = [
    { n: 1, reg: 1, by: USER.tech, status: "SUBMITTED", category: "inaccurate_reading", daysAgo: 1 },
    {
      n: 2,
      reg: 2,
      by: USER.tech,
      status: "NEEDS_INFO",
      category: "connectivity",
      daysAgo: 6,
      assigned: USER.agent,
    },
    {
      n: 3,
      reg: 3,
      by: USER.dist,
      status: "IN_REVIEW",
      category: "no_power",
      daysAgo: 4,
      assigned: USER.agent,
    },
    { n: 4, reg: 5, by: USER.dist, status: "SUBMITTED", category: "other", daysAgo: 9 },
    { n: 5, reg: 6, by: USER.dist, status: "DRAFT", category: "inaccurate_reading", daysAgo: 0 },
  ];
  for (const c of claims) {
    const claimId = id("50000000", c.n);
    if (await prisma.claim.findUnique({ where: { id: claimId } })) continue;
    const created = addUtcDays(today, -c.daysAgo);
    const submitted = c.status === "DRAFT" ? null : created;
    await prisma.claim.create({
      data: {
        id: claimId,
        registrationId: regIds[c.reg]!,
        failureCategory: c.category,
        description,
        failureDate: addUtcDays(created, -2),
        inWarranty: true,
        status: c.status,
        preferredResolution: "repair",
        returnAddress: address,
        assignedTo: c.assigned ?? null,
        submittedAt: submitted,
        slaDueAt: submitted ? addUtcDays(submitted, 3) : null,
        createdBy: c.by,
        createdAt: created,
      },
    });
    const events: {
      type: string;
      from?: ClaimStatus;
      to?: ClaimStatus;
      actor: string;
      comment?: string;
      internal?: boolean;
    }[] = [{ type: "created", to: "DRAFT", actor: c.by }];
    if (submitted) events.push({ type: "status_changed", from: "DRAFT", to: "SUBMITTED", actor: c.by });
    if (c.status === "IN_REVIEW" || c.status === "NEEDS_INFO") {
      events.push({ type: "status_changed", from: "SUBMITTED", to: "IN_REVIEW", actor: USER.agent });
      events.push({
        type: "comment",
        actor: USER.agent,
        comment: "Checked the serial against the batch recall list: not affected.",
        internal: true,
      });
    }
    if (c.status === "NEEDS_INFO") {
      events.push({
        type: "status_changed",
        from: "IN_REVIEW",
        to: "NEEDS_INFO",
        actor: USER.agent,
        comment: "Please send a photo of the display showing the reading.",
      });
    }
    for (const [i, e] of events.entries()) {
      await prisma.claimEvent.create({
        data: {
          claimId,
          actorId: e.actor,
          type: e.type,
          fromStatus: e.from,
          toStatus: e.to,
          comment: e.comment,
          internal: e.internal ?? false,
          createdAt: new Date(created.getTime() + i * 3_600_000),
        },
      });
    }
  }
}

async function main() {
  await referenceData();
  await parties();
  if (process.env.SEED_DEMO_DATA !== "false") await demoData();
  process.stdout.write("Seed complete\n");
}

main()
  .catch((err: unknown) => {
    process.stderr.write(`${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());

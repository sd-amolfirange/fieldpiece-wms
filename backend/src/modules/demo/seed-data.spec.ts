import { serialNumberPart, unitWarranty } from "@wms/domain";
import { createSeed, DEMO_PARTNER_KEYS } from "./seed-data";

// The starting data: the generated demo volume is the same on every load and keeps clear of the labels the tests and
// the bulk-upload sample use.

describe("starting data", () => {
  const today = "2026-09-28";
  const seed = createSeed(today);

  it("is the same on every load, and its counts don't depend on the date", () => {
    expect(createSeed(today)).toEqual(seed);
    const later = createSeed("2027-03-15");
    expect([later.units.length, later.registrations.length, later.claims.length]).toEqual([
      seed.units.length,
      seed.registrations.length,
      seed.claims.length,
    ]);
    expect(seed.units).toHaveLength(267);
    expect(seed.claims).toHaveLength(53);
  });

  it("keeps the named data's ids and adds the Fieldpiece apps as partners", () => {
    expect(seed.claims.slice(0, 7).map((c) => c.id)).toEqual([
      "CLM-1001",
      "CLM-1002",
      "CLM-1003",
      "CLM-1004",
      "CLM-1005",
      "CLM-1006",
      "CLM-1007",
    ]);
    expect(seed.registrations[0]).toMatchObject({ id: "REG-1001", serial: "SC680-251406233" });
    expect(seed.partnerClients.map((p) => [p.id, p.channel])).toEqual([
      ["pc-desertpeak-pos", "API"],
      ["pc-marketplace", "RETAIL"],
      ["pc-overwatch", "OVERWATCH"],
      ["pc-joblink", "JOBLINK"],
    ]);
    expect(Object.keys(DEMO_PARTNER_KEYS)).toEqual(seed.partnerClients.map((p) => p.id));
  });

  it("never generates the reserved label weeks or a label number twice", () => {
    const labels = [...seed.units, ...seed.registrations].map((x) => `${x.serial} ${x.batchNumber ?? ""}`);
    expect(labels.filter((l) => /2635|2638|2639/.test(l))).toEqual([]);
    const numbers = seed.units.map((u) => serialNumberPart(u.serial));
    expect(new Set(numbers).size).toBe(numbers.length);
  });

  it("links every registered product to its approved registration and files claims inside the warranty", () => {
    const byId = new Map(seed.registrations.map((r) => [r.id, r]));
    for (const unit of seed.units.filter((u) => u.registrationId)) {
      expect(byId.get(unit.registrationId!)).toMatchObject({ serial: unit.serial, status: "APPROVED" });
    }
    const generated = seed.claims.slice(7);
    expect(generated.filter((c) => !c.coverage.covered)).toEqual([]);
  });

  it("gives every dealer registrations this month, even on the 1st", () => {
    for (const day of [today, "2026-10-01"]) {
      const data = createSeed(day);
      for (const dealer of data.dealers) {
        const count = data.registrations.filter(
          (r) => r.dealerId === dealer.id && r.submittedAt.slice(0, 7) === day.slice(0, 7),
        ).length;
        expect([day, dealer.id, count >= 6]).toEqual([day, dealer.id, true]);
      }
    }
  });

  it("gives Marcus Reed eight products in every warranty state but void", () => {
    const statuses = seed.units
      .filter((u) => u.customerId === "c-mreed")
      .map((u) => unitWarranty(u, today).status)
      .sort();
    expect(statuses).toEqual([
      "ACTIVE",
      "ACTIVE",
      "ACTIVE",
      "ACTIVE",
      "ACTIVE",
      "ACTIVE",
      "EXPIRED",
      "EXPIRING_SOON",
    ]);
  });
});

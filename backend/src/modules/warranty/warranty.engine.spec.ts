import { formatIsoDate, parseIsoDate } from "../../common/time/utc-date";
import {
  computeWarranty,
  computeWarrantyStatus,
  selectPolicy,
  type PolicyCandidate,
} from "./warranty.engine";

const d = parseIsoDate;
const iso = formatIsoDate;

describe("computeWarranty", () => {
  it("covers base months, ending the day before the anniversary", () => {
    const result = computeWarranty({
      purchaseDate: d("2026-03-14"),
      registeredAt: d("2026-03-20"),
      policy: { baseMonths: 24, registrationBonusMonths: 0 },
    });
    expect(iso(result.start)).toBe("2026-03-14");
    expect(iso(result.end)).toBe("2028-03-13");
    expect(result.bonusApplied).toBe(false);
  });

  it("handles month-end purchase dates (31 Jan + 1 month)", () => {
    const result = computeWarranty({
      purchaseDate: d("2026-01-31"),
      registeredAt: d("2026-01-31"),
      policy: { baseMonths: 1, registrationBonusMonths: 0 },
    });
    expect(iso(result.end)).toBe("2026-02-27");
  });

  it("handles leap years", () => {
    const result = computeWarranty({
      purchaseDate: d("2028-02-29"),
      registeredAt: d("2028-03-01"),
      policy: { baseMonths: 12, registrationBonusMonths: 0 },
    });
    expect(iso(result.end)).toBe("2029-02-27");
  });

  it("applies the bonus when registered exactly on the window boundary", () => {
    const result = computeWarranty({
      purchaseDate: d("2026-01-01"),
      registeredAt: d("2026-01-31"),
      policy: { baseMonths: 12, registrationBonusMonths: 12, registrationWindowDays: 30 },
    });
    expect(result.bonusApplied).toBe(true);
    expect(iso(result.end)).toBe("2027-12-31");
  });

  it("drops the bonus one day after the window", () => {
    const result = computeWarranty({
      purchaseDate: d("2026-01-01"),
      registeredAt: d("2026-02-01"),
      policy: { baseMonths: 12, registrationBonusMonths: 12, registrationWindowDays: 30 },
    });
    expect(result.bonusApplied).toBe(false);
    expect(iso(result.end)).toBe("2026-12-31");
  });

  it("applies the bonus with no window at all", () => {
    const result = computeWarranty({
      purchaseDate: d("2026-01-01"),
      registeredAt: d("2030-01-01"),
      policy: { baseMonths: 12, registrationBonusMonths: 6, registrationWindowDays: null },
    });
    expect(result.bonusApplied).toBe(true);
  });

  it("reports no bonus when the bonus is zero", () => {
    const result = computeWarranty({
      purchaseDate: d("2026-01-01"),
      registeredAt: d("2026-01-02"),
      policy: { baseMonths: 36, registrationBonusMonths: 0, registrationWindowDays: 30 },
    });
    expect(result.bonusApplied).toBe(false);
  });
});

describe("computeWarrantyStatus", () => {
  const today = d("2026-09-23");
  const status = (end: string, s: "ACTIVE" | "VOID" = "ACTIVE") =>
    computeWarrantyStatus({ status: s, warrantyEnd: d(end), today, expiringSoonDays: 60 });

  it("is VOID regardless of dates", () => expect(status("2030-01-01", "VOID")).toBe("VOID"));
  it("is EXPIRED after the end date", () => expect(status("2026-09-22")).toBe("EXPIRED"));
  it("is EXPIRING_SOON on the last day", () => expect(status("2026-09-23")).toBe("EXPIRING_SOON"));
  it("is EXPIRING_SOON at the threshold", () => expect(status("2026-11-22")).toBe("EXPIRING_SOON"));
  it("is ACTIVE beyond the threshold", () => expect(status("2026-11-23")).toBe("ACTIVE"));
});

describe("selectPolicy", () => {
  const policy = (over: Partial<PolicyCandidate>): PolicyCandidate => ({
    id: "p",
    productId: null,
    baseMonths: 12,
    registrationBonusMonths: 0,
    effectiveFrom: d("2020-01-01"),
    effectiveTo: null,
    ...over,
  });

  const candidates = [
    policy({ id: "default" }),
    policy({ id: "sc680-old", productId: "sc680", effectiveTo: d("2025-01-01") }),
    policy({ id: "sc680-new", productId: "sc680", effectiveFrom: d("2025-01-01") }),
  ];

  it("prefers the product's policy in effect on the purchase date", () => {
    expect(selectPolicy(candidates, "sc680", d("2024-06-01"))?.id).toBe("sc680-old");
    expect(selectPolicy(candidates, "sc680", d("2025-01-01"))?.id).toBe("sc680-new");
  });

  it("falls back to the default policy", () => {
    expect(selectPolicy(candidates, "vp85", d("2024-06-01"))?.id).toBe("default");
  });

  it("returns null when nothing is in effect", () => {
    expect(selectPolicy(candidates, "vp85", d("2019-06-01"))).toBeNull();
  });
});

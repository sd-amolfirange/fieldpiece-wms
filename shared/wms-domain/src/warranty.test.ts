import { addMonthsIso, daysBetween } from "./dates";
import {
  coverageFor,
  unitWarranty,
  warrantyEndFor,
  warrantyFromPurchase,
} from "./warranty";

describe("dates", () => {
  it("clamps month ends and handles leap years", () => {
    expect(addMonthsIso("2024-01-31", 1)).toBe("2024-02-29");
    expect(addMonthsIso("2023-01-31", 1)).toBe("2023-02-28");
    expect(addMonthsIso("2024-02-29", 12)).toBe("2025-02-28");
  });

  it("counts calendar days without time-zone drift", () => {
    expect(daysBetween("2026-09-24", "2026-10-24")).toBe(30);
    expect(daysBetween("2026-09-24", "2026-09-23")).toBe(-1);
  });
});

describe("warranty dates", () => {
  it("covers one year from the purchase date, the day before the anniversary being the last day", () => {
    expect(warrantyEndFor("2026-01-10", 12)).toBe("2027-01-09");
    expect(warrantyEndFor("2024-02-29", 12)).toBe("2025-02-27");
  });

  it("starts on the purchase date, or today when it's unknown", () => {
    expect(
      warrantyFromPurchase({ warrantyMonths: 12 }, "2026-03-01", "2026-09-24"),
    ).toEqual({ warrantyStart: "2026-03-01", warrantyEnd: "2027-02-28" });
    expect(
      warrantyFromPurchase({ warrantyMonths: 12 }, undefined, "2026-09-24")
        .warrantyStart,
    ).toBe("2026-09-24");
  });
});

describe("unitWarranty", () => {
  const unit = { warrantyEnd: "2026-10-24" };

  it("is Active with days remaining", () => {
    expect(unitWarranty(unit, "2026-09-23")).toEqual({
      status: "ACTIVE",
      daysRemaining: 31,
    });
  });

  it("is Expiring soon at 30 days or fewer, and still covers the end day", () => {
    expect(unitWarranty(unit, "2026-09-24")).toEqual({
      status: "EXPIRING_SOON",
      daysRemaining: 30,
    });
    expect(unitWarranty(unit, "2026-10-24").status).toBe("EXPIRING_SOON");
    expect(unitWarranty(unit, "2026-10-25").status).toBe("EXPIRED");
  });

  it("is Pending before registration, Void once voided, Expired once replaced", () => {
    expect(unitWarranty({}, "2026-09-24").status).toBe("PENDING");
    expect(
      unitWarranty(
        {
          ...unit,
          void: { reason: "MISUSE", by: "u", byName: "Warranty desk", at: "2026-09-01T10:00:00Z" },
        },
        "2026-09-24",
      ).status,
    ).toBe("VOID");
    expect(
      unitWarranty({ ...unit, replacedBySerial: "241800001" }, "2026-09-24")
        .status,
    ).toBe("EXPIRED");
  });
});

describe("coverageFor", () => {
  it("covers a claim while the warranty runs", () => {
    expect(coverageFor({ warrantyEnd: "2026-12-31" }, "2026-09-24")).toEqual({
      covered: true,
      reason: "IN_WARRANTY",
      warrantyEnd: "2026-12-31",
    });
  });

  it("explains why a claim isn't covered", () => {
    expect(coverageFor({ warrantyEnd: "2026-01-31" }, "2026-09-24").reason).toBe(
      "EXPIRED",
    );
    expect(coverageFor({}, "2026-09-24").reason).toBe("NOT_REGISTERED");
    expect(
      coverageFor(
        {
          warrantyEnd: "2026-12-31",
          void: { reason: "UNAUTHORIZED_REPAIR", by: "u", byName: "Warranty desk", at: "2026-09-01T10:00:00Z" },
        },
        "2026-09-24",
      ),
    ).toMatchObject({ covered: false, reason: "VOID" });
  });
});

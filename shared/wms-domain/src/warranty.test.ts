import { addMonthsIso, daysBetween } from "./dates";
import { entitlementFor } from "./entitlement";
import type { Model, Unit } from "./types";
import {
  buildUnitParts,
  currentPart,
  partWarranty,
  replacePart,
  unitWarranty,
} from "./warranty";

const template: Model["parts"] = [
  {
    partType: "UNIT",
    warrantyMonths: 12,
    coversParts: true,
    coversLabour: true,
    serialised: false,
  },
  {
    partType: "COMPRESSOR",
    warrantyMonths: 120,
    coversParts: true,
    coversLabour: false,
    serialised: true,
  },
  {
    partType: "PCB",
    warrantyMonths: 60,
    coversParts: true,
    coversLabour: false,
    serialised: true,
  },
];

const unitInstalled = (date: string, extra: Partial<Unit> = {}): Unit => ({
  serial: "AER-SPL15-210311",
  modelId: "m",
  brandId: "b",
  parts: buildUnitParts({ parts: template }, date, {
    idPrefix: "u",
    serials: { COMPRESSOR: "CP-1", PCB: "PCB-1", UNIT: "ignored" },
  }),
  attachmentIds: [],
  history: [],
  ...extra,
});

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

describe("buildUnitParts", () => {
  it("attaches every template part with its own warranty period", () => {
    const parts = buildUnitParts({ parts: template }, "2021-03-11", {
      idPrefix: "u",
      serials: { COMPRESSOR: "CP-1" },
    });
    expect(parts.map((p) => [p.partType, p.warrantyEnd])).toEqual([
      ["UNIT", "2022-03-11"],
      ["COMPRESSOR", "2031-03-11"],
      ["PCB", "2026-03-11"],
    ]);
    expect(parts.find((p) => p.partType === "UNIT")?.serial).toBeUndefined();
    expect(parts.find((p) => p.partType === "COMPRESSOR")?.serial).toBe("CP-1");
  });
});

describe("partWarranty", () => {
  const part = { warrantyEnd: "2026-10-24" };

  it("is Active with days remaining", () => {
    expect(partWarranty(part, "2026-09-23")).toEqual({
      status: "ACTIVE",
      daysRemaining: 31,
    });
  });

  it("is Expiring soon at 30 days or fewer", () => {
    expect(partWarranty(part, "2026-09-24")).toEqual({
      status: "EXPIRING_SOON",
      daysRemaining: 30,
    });
  });

  it("still covers the end day itself", () => {
    expect(partWarranty(part, "2026-10-24")).toEqual({
      status: "EXPIRING_SOON",
      daysRemaining: 0,
    });
    expect(partWarranty(part, "2026-10-25")).toEqual({
      status: "EXPIRED",
      daysRemaining: 0,
    });
  });

  it("is Void whatever the dates", () => {
    expect(partWarranty(part, "2026-09-01", { voided: true }).status).toBe(
      "VOID",
    );
  });

  it("treats a replaced part as no longer covered", () => {
    expect(
      partWarranty({ ...part, replacedAt: "2026-09-01" }, "2026-09-02").status,
    ).toBe("EXPIRED");
  });
});

describe("unitWarranty", () => {
  it("is Pending before registration", () => {
    expect(unitWarranty({ parts: [] }, "2026-09-24").status).toBe("PENDING");
  });

  it("follows the UNIT part even when the compressor is still covered", () => {
    const unit = unitInstalled("2021-03-11");
    expect(unitWarranty(unit, "2026-09-24").status).toBe("EXPIRED");
    expect(
      partWarranty(currentPart(unit, "COMPRESSOR")!, "2026-09-24").status,
    ).toBe("ACTIVE");
  });

  it("is Void once voided", () => {
    const unit = unitInstalled("2026-01-01", {
      void: {
        reason: "UNAUTHORISED_REPAIR",
        by: "u",
        byName: "Admin",
        at: "2026-09-24T10:00:00Z",
      },
    });
    expect(unitWarranty(unit, "2026-09-24").status).toBe("VOID");
  });
});

describe("replacePart", () => {
  it("starts the new part's warranty on the replacement date and keeps history", () => {
    const unit = unitInstalled("2021-03-11");
    const parts = replacePart(unit.parts, template[1]!, {
      newSerial: "CP-NEW",
      date: "2026-09-24",
      newId: "n1",
    });
    const old = parts.find((p) => p.serial === "CP-1");
    const replacement = currentPart({ parts }, "COMPRESSOR");
    expect(old).toMatchObject({
      replacedAt: "2026-09-24",
      replacedBySerial: "CP-NEW",
    });
    expect(replacement).toMatchObject({
      serial: "CP-NEW",
      replacesSerial: "CP-1",
      warrantyStart: "2026-09-24",
      warrantyEnd: "2036-09-24",
    });
    expect(parts).toHaveLength(4);
  });
});

describe("entitlementFor", () => {
  it("expired unit, covered compressor: parts covered, labour chargeable (W3)", () => {
    expect(entitlementFor(unitInstalled("2021-03-11"), "2026-09-24")).toEqual({
      parts: "COVERED",
      labour: "CHARGEABLE",
      coveredPartTypes: ["COMPRESSOR"],
      claimable: true,
      reason: "PARTIAL",
    });
  });

  it("unit warranty active: every part and labour covered", () => {
    const e = entitlementFor(unitInstalled("2026-03-01"), "2026-09-24");
    expect(e).toMatchObject({
      parts: "COVERED",
      labour: "COVERED",
      claimable: true,
      reason: "FULL",
    });
    expect(e.coveredPartTypes).toEqual(["UNIT", "COMPRESSOR", "PCB"]);
  });

  it("void unit: chargeable and never claimable (W5)", () => {
    const unit = unitInstalled("2026-03-01", {
      void: {
        reason: "UNAUTHORISED_REPAIR",
        by: "u",
        byName: "Admin",
        at: "2026-09-24T10:00:00Z",
      },
    });
    expect(entitlementFor(unit, "2026-09-24")).toMatchObject({
      parts: "CHARGEABLE",
      labour: "CHARGEABLE",
      claimable: false,
      reason: "VOID",
    });
  });

  it("nothing active: chargeable", () => {
    expect(
      entitlementFor(unitInstalled("2010-01-01"), "2026-09-24"),
    ).toMatchObject({
      parts: "CHARGEABLE",
      claimable: false,
      reason: "NOTHING_ACTIVE",
    });
  });

  it("unregistered unit: chargeable", () => {
    expect(entitlementFor({ parts: [] }, "2026-09-24").reason).toBe(
      "NOT_REGISTERED",
    );
  });
});

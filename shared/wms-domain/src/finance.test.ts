import { describe, expect, it } from "vitest";
import { claimCost, extensionPrice, extensionQuote, percent } from "./finance";

const model = { listPrice: 329, repairCost: 99 };
const active = { warrantyEnd: "2026-11-12", extensions: [] };

describe("claim cost", () => {
  it("prices each resolution", () => {
    expect(claimCost("REPAIR", model)).toBe(99);
    expect(claimCost("REPLACE", model)).toBe(180.95);
    expect(claimCost("CREDIT", model, 120)).toBe(120);
    expect(claimCost(undefined, model)).toBe(0);
  });
});

describe("warranty extension", () => {
  it("offers 12, 24 and 36 months priced from the list price", () => {
    const q = extensionQuote(active, model, "2026-09-30");
    expect(q.eligible).toBe(true);
    expect(q.options.map((o) => [o.months, o.price, o.newEnd])).toEqual([
      [12, 48.99, "2027-11-12"],
      [24, 85.99, "2028-11-12"],
      [36, 114.99, "2029-11-12"],
    ]);
    expect(extensionPrice(50, 12)).toBe(19.99);
  });

  it("caps the total at 36 extra months", () => {
    const q = extensionQuote({ ...active, extensions: [{ months: 24 } as never] }, model, "2026-09-30");
    expect(q.extendedMonths).toBe(24);
    expect(q.options.map((o) => o.months)).toEqual([12]);
    const full = extensionQuote({ ...active, extensions: [{ months: 36 } as never] }, model, "2026-09-30");
    expect([full.eligible, full.reason]).toEqual([false, "LIMIT_REACHED"]);
  });

  it("refuses unregistered, void, replaced and expired products", () => {
    const at = "2026-09-30";
    expect(extensionQuote({}, model, at).reason).toBe("NOT_REGISTERED");
    expect(extensionQuote({ ...active, void: {} as never }, model, at).reason).toBe("VOID");
    expect(extensionQuote({ ...active, replacedBySerial: "X" }, model, at).reason).toBe("REPLACED");
    expect(extensionQuote({ warrantyEnd: "2026-09-29" }, model, at).reason).toBe("EXPIRED");
    expect(extensionQuote({ warrantyEnd: "2026-10-10" }, model, at).eligible).toBe(true); // expiring soon
  });

  it("percent", () => {
    expect(percent(1, 3)).toBe(33);
    expect(percent(5, 0)).toBe(0);
  });
});

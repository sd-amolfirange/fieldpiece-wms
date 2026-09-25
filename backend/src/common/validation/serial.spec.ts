import { normalizeSerial, serialMatchesProduct } from "./serial";

describe("serial rules", () => {
  it("normalises whitespace and case", () => {
    expect(normalizeSerial("  sc680 - 100037 ")).toBe("SC680-100037");
  });

  it("uses the product's pattern when set", () => {
    const vp85 = { sku: "VP85", serialPattern: "^VP85[0-9]{6}$" };
    expect(serialMatchesProduct("VP85123456", vp85)).toBe(true);
    expect(serialMatchesProduct("VP85-123456", vp85)).toBe(false);
  });

  it("falls back to the SKU prefix", () => {
    expect(serialMatchesProduct("SC680-100037", { sku: "SC680", serialPattern: null })).toBe(true);
    expect(serialMatchesProduct("SMAN460-1", { sku: "SC680", serialPattern: null })).toBe(false);
  });
});

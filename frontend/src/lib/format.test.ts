import {
  formatClaimId,
  formatDate,
  formatDateTime,
  formatFileSize,
  formatMoney,
  formatNumber,
  formatRmaId,
  normalizeSerial,
  toIsoDate,
} from "./format";

describe("formatDate", () => {
  it("renders as 23 Sep 2026", () => {
    expect(formatDate("2026-09-23")).toBe("23 Sep 2026");
    expect(formatDate(new Date(2026, 8, 23))).toBe("23 Sep 2026");
  });

  it("localises month names", () => {
    expect(formatDate("2026-09-23", "fr")).toMatch(/^23 sept\.? 2026$/);
    expect(formatDate("2026-09-23", "es-MX")).toMatch(/^23 sept?\.? 2026$/);
  });

  it("falls back to English for unknown languages", () => {
    expect(formatDate("2026-09-23", "de")).toBe("23 Sep 2026");
  });

  it("returns an empty string for missing or invalid input", () => {
    expect(formatDate(null)).toBe("");
    expect(formatDate(undefined)).toBe("");
    expect(formatDate("not a date")).toBe("");
  });
});

describe("formatDateTime", () => {
  it("adds a 24h time", () => {
    expect(formatDateTime(new Date(2026, 8, 23, 14, 5))).toBe("23 Sep 2026, 14:05");
  });

  it("handles missing and invalid input", () => {
    expect(formatDateTime(null)).toBe("");
    expect(formatDateTime("nope")).toBe("");
  });
});

describe("toIsoDate", () => {
  it("formats as yyyy-MM-dd", () => {
    expect(toIsoDate(new Date(2026, 0, 5))).toBe("2026-01-05");
  });
});

describe("numbers and money", () => {
  it("formats money with Intl", () => {
    expect(formatMoney(1234.5, "USD", "en-US")).toBe("$1,234.50");
  });

  it("formats numbers with Intl", () => {
    expect(formatNumber(12345, "en-US")).toBe("12,345");
    expect(formatNumber(0.125, "en-US", { style: "percent", maximumFractionDigits: 1 })).toBe("12.5%");
  });

  it("formats file sizes", () => {
    expect(formatFileSize(500)).toBe("500 B");
    expect(formatFileSize(2048)).toBe("2 KB");
    expect(formatFileSize(5.25 * 1024 * 1024)).toBe("5.3 MB");
  });
});

describe("IDs and serials", () => {
  it("pads claim and RMA IDs", () => {
    expect(formatClaimId(123)).toBe("CLM-000123");
    expect(formatRmaId("45")).toBe("RMA-000045");
  });

  it("leaves already-formatted IDs alone", () => {
    expect(formatClaimId("CLM-000123")).toBe("CLM-000123");
  });

  it("normalises serials", () => {
    expect(normalizeSerial("  aer-spl15 240917 ")).toBe("AER-SPL15240917");
  });
});

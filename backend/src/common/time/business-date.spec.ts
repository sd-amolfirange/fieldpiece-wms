import { isoDateIn } from "./business-date";

describe("isoDateIn", () => {
  it("uses the business calendar, not UTC", () => {
    // 20:00 UTC on 24 Sep is already 25 Sep in India (UTC+5:30).
    const instant = new Date("2026-09-24T20:00:00Z");
    expect(isoDateIn("Asia/Kolkata", instant)).toBe("2026-09-25");
    expect(isoDateIn("UTC", instant)).toBe("2026-09-24");
  });

  it("rolls over at local midnight", () => {
    expect(isoDateIn("Asia/Kolkata", new Date("2026-09-24T18:29:59Z"))).toBe("2026-09-24");
    expect(isoDateIn("Asia/Kolkata", new Date("2026-09-24T18:30:00Z"))).toBe("2026-09-25");
  });
});

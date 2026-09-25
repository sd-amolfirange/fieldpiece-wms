import {
  addUtcDays,
  addUtcMonths,
  differenceInUtcCalendarDays,
  formatIsoDate,
  parseIsoDate,
  startOfUtcDay,
} from "./utc-date";

describe("utc-date", () => {
  it("round-trips ISO dates", () => {
    expect(formatIsoDate(parseIsoDate("2026-09-23"))).toBe("2026-09-23");
  });

  it("rejects malformed and impossible dates", () => {
    expect(() => parseIsoDate("2026-9-23")).toThrow(RangeError);
    expect(() => parseIsoDate("2026-02-30")).toThrow(RangeError);
  });

  it("truncates to the UTC day", () => {
    expect(startOfUtcDay(new Date("2026-09-23T23:59:59.999Z")).toISOString()).toBe(
      "2026-09-23T00:00:00.000Z",
    );
  });

  it("adds days across month and year boundaries", () => {
    expect(formatIsoDate(addUtcDays(parseIsoDate("2026-12-31"), 1))).toBe("2027-01-01");
    expect(formatIsoDate(addUtcDays(parseIsoDate("2026-03-01"), -1))).toBe("2026-02-28");
  });

  it("clamps month-end when adding months", () => {
    expect(formatIsoDate(addUtcMonths(parseIsoDate("2026-01-31"), 1))).toBe("2026-02-28");
    expect(formatIsoDate(addUtcMonths(parseIsoDate("2028-01-31"), 1))).toBe("2028-02-29"); // leap year
    expect(formatIsoDate(addUtcMonths(parseIsoDate("2026-08-31"), 13))).toBe("2027-09-30");
  });

  it("counts calendar days regardless of time of day", () => {
    expect(
      differenceInUtcCalendarDays(new Date("2026-09-24T00:10:00Z"), new Date("2026-09-23T23:50:00Z")),
    ).toBe(1);
    expect(differenceInUtcCalendarDays(parseIsoDate("2026-01-01"), parseIsoDate("2026-01-31"))).toBe(-30);
  });
});

import { addBusinessHours, type BusinessCalendar } from "./business-hours";

const calendar: BusinessCalendar = { startHour: 8, endHour: 17, holidays: new Set(["2026-12-25"]) };
const at = (iso: string) => new Date(iso);

describe("addBusinessHours", () => {
  it("adds within the same business day", () => {
    expect(addBusinessHours(at("2026-09-23T09:00:00Z"), 3, calendar).toISOString()).toBe(
      "2026-09-23T12:00:00.000Z",
    );
  });

  it("rolls over to the next business day", () => {
    // Wed 15:00 + 4h = 2h Wed + 2h Thu -> Thu 10:00
    expect(addBusinessHours(at("2026-09-23T15:00:00Z"), 4, calendar).toISOString()).toBe(
      "2026-09-24T10:00:00.000Z",
    );
  });

  it("skips weekends", () => {
    // Fri 16:00 + 2h -> Mon 09:00
    expect(addBusinessHours(at("2026-09-25T16:00:00Z"), 2, calendar).toISOString()).toBe(
      "2026-09-28T09:00:00.000Z",
    );
  });

  it("starts the clock at opening time when submitted out of hours", () => {
    expect(addBusinessHours(at("2026-09-23T20:00:00Z"), 1, calendar).toISOString()).toBe(
      "2026-09-24T09:00:00.000Z",
    );
    expect(addBusinessHours(at("2026-09-26T10:00:00Z"), 1, calendar).toISOString()).toBe(
      "2026-09-28T09:00:00.000Z",
    );
  });

  it("skips holidays", () => {
    // Thu 24 Dec 16:00 + 2h -> 1h Thu, skip Fri 25 (holiday) and weekend -> Mon 28 Dec 09:00
    expect(addBusinessHours(at("2026-12-24T16:00:00Z"), 2, calendar).toISOString()).toBe(
      "2026-12-28T09:00:00.000Z",
    );
  });

  it("handles the default 48 business hours", () => {
    // 48h / 9h per day = 5 days + 3h. Mon 08:00 -> next Mon 11:00
    expect(addBusinessHours(at("2026-09-21T08:00:00Z"), 48, calendar).toISOString()).toBe(
      "2026-09-28T11:00:00.000Z",
    );
  });

  it("returns the start moment for zero hours inside business time", () => {
    expect(addBusinessHours(at("2026-09-23T10:30:00Z"), 0, calendar).toISOString()).toBe(
      "2026-09-23T10:30:00.000Z",
    );
  });

  it("rejects invalid input", () => {
    expect(() => addBusinessHours(at("2026-09-23T10:00:00Z"), -1, calendar)).toThrow(RangeError);
    expect(() => addBusinessHours(at("2026-09-23T10:00:00Z"), 1, { ...calendar, endHour: 8 })).toThrow(
      RangeError,
    );
  });
});

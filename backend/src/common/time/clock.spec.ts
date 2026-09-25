import { FixedClock, SystemClock } from "./clock";

describe("clocks", () => {
  it("FixedClock returns a copy of the frozen time and can be moved", () => {
    const clock = new FixedClock(new Date("2026-09-23T10:00:00Z"));
    const first = clock.now();
    first.setUTCFullYear(2000);
    expect(clock.now().toISOString()).toBe("2026-09-23T10:00:00.000Z");
    clock.set(new Date("2026-09-24T00:00:00Z"));
    expect(clock.now().toISOString()).toBe("2026-09-24T00:00:00.000Z");
  });

  it("SystemClock returns the current time", () => {
    const before = Date.now();
    const now = new SystemClock().now().getTime();
    expect(now).toBeGreaterThanOrEqual(before);
    expect(now).toBeLessThanOrEqual(Date.now());
  });
});

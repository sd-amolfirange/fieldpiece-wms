import { createSeedData, DEMO_ACCOUNTS, DEMO_PARTNER_KEYS } from "./core/index";
import * as backend from "../../src/modules/demo/seed-data";

// The mock's seed is a copy of the real backend's (the core can't import backend/ files: it must build with only
// @wms/domain). This test fails when the two drift apart, so update core/seed.ts together with the backend's.

describe("seed parity with the backend", () => {
  it.each(["2026-09-28", "2027-02-28", "2028-02-29"])("creates the same starting data for %s", (today) => {
    expect(createSeedData(today)).toEqual(backend.createSeed(today));
  });

  it("offers the same sign-in accounts and partner keys", () => {
    expect(DEMO_ACCOUNTS).toEqual(backend.DEMO_ACCOUNTS);
    expect(DEMO_PARTNER_KEYS).toEqual(backend.DEMO_PARTNER_KEYS);
  });
});

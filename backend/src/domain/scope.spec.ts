import type { Actor } from "../common/auth/context";
import { canSee, canSeeClaim, dealerIdFor, scopeWhere } from "./scope";

const actor = (overrides: Partial<Actor>): Actor => ({
  id: "u",
  name: "User",
  email: "u@example.com",
  role: "admin",
  visibleDealerIds: null,
  sessionId: "s",
  ...overrides,
});

const admin = actor({ role: "admin" });
const dealer = actor({ role: "dealer", dealerId: "d-1", visibleDealerIds: ["d-1"] });
const distributor = actor({ role: "distributor", distributorId: "x", visibleDealerIds: ["d-1", "d-2"] });
const customer = actor({ role: "customer", customerId: "c-1", visibleDealerIds: [] });

describe("canSee", () => {
  const row = { dealerId: "d-1", customerId: "c-1" };
  const otherRow = { dealerId: "d-3", customerId: "c-9" };

  it("lets admins see everything", () => {
    expect(canSee(admin, otherRow)).toBe(true);
  });

  it("limits dealers and distributors to their dealers", () => {
    expect(canSee(dealer, row)).toBe(true);
    expect(canSee(dealer, { dealerId: "d-2" })).toBe(false);
    expect(canSee(distributor, { dealerId: "d-2" })).toBe(true);
    expect(canSee(distributor, otherRow)).toBe(false);
    expect(canSee(dealer, { customerId: "c-1" })).toBe(false); // no dealer on the row
  });

  it("limits customers to their own rows", () => {
    expect(canSee(customer, row)).toBe(true);
    expect(canSee(customer, { dealerId: "d-1", customerId: "c-2" })).toBe(false);
    expect(canSee(actor({ role: "customer", visibleDealerIds: [] }), { customerId: undefined })).toBe(false);
  });

  it("never shows claims to customers", () => {
    expect(canSeeClaim(customer, row)).toBe(false);
    expect(canSeeClaim(dealer, row)).toBe(true);
  });
});

describe("scopeWhere", () => {
  it("matches canSee", () => {
    expect(scopeWhere(admin)).toEqual({});
    expect(scopeWhere(dealer)).toEqual({ dealerId: { in: ["d-1"] } });
    expect(scopeWhere(customer)).toEqual({ customerId: "c-1" });
  });

  it("matches nothing for a customer login without a customer record", () => {
    expect(scopeWhere(actor({ role: "customer", visibleDealerIds: [] })).customerId).toBe("\u0000");
  });
});

describe("dealerIdFor", () => {
  const known = ["d-1", "d-2", "d-3"];

  it("always uses a dealer's own id", () => {
    expect(dealerIdFor(dealer, "d-2", known)).toBe("d-1");
  });

  it("requires distributors and admins to pick a dealer they can see", () => {
    expect(dealerIdFor(distributor, "d-2", known)).toBe("d-2");
    expect(() => dealerIdFor(distributor, "d-3", known)).toThrow("Pick the dealer.");
    expect(() => dealerIdFor(admin, undefined, known)).toThrow("Pick the dealer.");
    expect(dealerIdFor(admin, "d-3", known)).toBe("d-3");
    expect(() => dealerIdFor(admin, "nope", known)).toThrow("Pick the dealer.");
  });
});

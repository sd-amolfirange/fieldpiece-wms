import type { Dealer, User } from "@wms/domain";
import { ServiceError } from "./errors";
import { canSee, dealerIdFor, scopeRows, visibleDealerIds } from "./scope";

const dealers: Dealer[] = [
  { id: "d-1", name: "One", city: "Houston", state: "TX", distributorId: "dist" },
  { id: "d-2", name: "Two", city: "Baton Rouge", state: "LA", distributorId: "dist" },
  { id: "d-3", name: "Three", city: "Phoenix", state: "AZ" },
];
const user = (u: Partial<User> & Pick<User, "role">): User => ({
  id: "u",
  name: "U",
  email: "u@example.com",
  ...u,
});

const admin = user({ role: "admin" });
const dealer = user({ role: "dealer", dealerId: "d-1" });
const distributor = user({ role: "distributor", distributorId: "dist" });
const customer = user({ role: "customer", customerId: "c-1" });

describe("scope", () => {
  const row = { dealerId: "d-1", customerId: "c-1" };
  const otherRow = { dealerId: "d-3", customerId: "c-9" };

  it("lets admins see everything", () => {
    expect(visibleDealerIds(admin, dealers)).toBeNull();
    expect(canSee(admin, otherRow, dealers)).toBe(true);
  });

  it("limits dealers and distributors to their dealers", () => {
    expect(visibleDealerIds(distributor, dealers)).toEqual(["d-1", "d-2"]);
    expect(canSee(dealer, row, dealers)).toBe(true);
    expect(canSee(dealer, { dealerId: "d-2" }, dealers)).toBe(false);
    expect(canSee(distributor, { dealerId: "d-2" }, dealers)).toBe(true);
    expect(canSee(distributor, otherRow, dealers)).toBe(false);
    expect(canSee(dealer, { customerId: "c-1" }, dealers)).toBe(false); // no dealer on the row
  });

  it("limits customers to their own rows (products, registrations and claims alike)", () => {
    expect(canSee(customer, row, dealers)).toBe(true);
    expect(canSee(customer, { dealerId: "d-1", customerId: "c-2" }, dealers)).toBe(false);
    expect(canSee(user({ role: "customer" }), { customerId: undefined }, dealers)).toBe(false);
    expect(scopeRows(customer, [row, otherRow], dealers)).toEqual([row]);
  });

  it("picks the dealer a registration is for", () => {
    expect(dealerIdFor(dealer, "d-3", dealers)).toBe("d-1");
    expect(dealerIdFor(distributor, "d-2", dealers)).toBe("d-2");
    expect(dealerIdFor(admin, "d-3", dealers)).toBe("d-3");
    for (const [who, requested] of [
      [distributor, "d-3"],
      [admin, undefined],
      [admin, "d-unknown"],
    ] as const) {
      try {
        dealerIdFor(who, requested, dealers);
        expect.unreachable();
      } catch (e) {
        expect(e).toBeInstanceOf(ServiceError);
        expect((e as ServiceError).fieldErrors).toEqual({ dealerId: "validation.pickDealer" });
      }
    }
  });
});

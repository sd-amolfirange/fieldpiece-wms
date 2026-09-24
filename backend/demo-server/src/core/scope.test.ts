import type { Dealer, User } from "@wms/domain";
import { canSee, canSeeClaim, visibleDealerIds } from "./scope";

describe("scope", () => {
  const dealers: Dealer[] = [
    { id: "d-coolair", name: "CoolAir", city: "Pune", distributorId: "dist" },
    { id: "d-breeze", name: "Breeze", city: "Nashik", distributorId: "dist" },
    { id: "d-arctic", name: "Arctic", city: "Mumbai" },
  ];
  const admin: User = { id: "a", name: "A", email: "a", role: "admin" };
  const dist: User = {
    id: "n",
    name: "N",
    email: "n",
    role: "distributor",
    distributorId: "dist",
  };
  const coolair: User = {
    id: "c",
    name: "C",
    email: "c",
    role: "dealer",
    dealerId: "d-coolair",
  };
  const customer: User = {
    id: "r",
    name: "R",
    email: "r",
    role: "customer",
    customerId: "c-rk",
  };

  it("resolves visible dealers per role", () => {
    expect(visibleDealerIds(admin, dealers)).toBeNull();
    expect(visibleDealerIds(dist, dealers)).toEqual(["d-coolair", "d-breeze"]);
    expect(visibleDealerIds(coolair, dealers)).toEqual(["d-coolair"]);
    expect(visibleDealerIds(customer, dealers)).toEqual([]);
  });

  it("limits rows to the caller's dealers or own records", () => {
    const breezeRow = { dealerId: "d-breeze", customerId: "c-mp" };
    const rkRow = { dealerId: "d-coolair", customerId: "c-rk" };
    expect(canSee(admin, breezeRow, dealers)).toBe(true);
    expect(canSee(dist, breezeRow, dealers)).toBe(true);
    expect(canSee(dist, { dealerId: "d-arctic" }, dealers)).toBe(false);
    expect(canSee(coolair, breezeRow, dealers)).toBe(false);
    expect(canSee(coolair, rkRow, dealers)).toBe(true);
    expect(canSee(customer, rkRow, dealers)).toBe(true);
    expect(canSee(customer, breezeRow, dealers)).toBe(false);
    expect(canSee(coolair, {}, dealers)).toBe(false);
  });

  it("never shows claims to customers", () => {
    expect(
      canSeeClaim(
        customer,
        { dealerId: "d-coolair", customerId: "c-rk" },
        dealers,
      ),
    ).toBe(false);
    expect(canSeeClaim(coolair, { dealerId: "d-coolair" }, dealers)).toBe(true);
  });
});

import { can, hasRole, isStaff } from "./permissions";

describe("permissions", () => {
  it("keeps review, void, claim decisions, partner keys and simulation with the admin", () => {
    for (const permission of [
      "registrations:inbox",
      "units:void",
      "claims:act",
      "partners:manage",
      "admin:manage",
      "simulate:run",
    ] as const) {
      expect(can("admin", permission)).toBe(true);
      expect(can("dealer", permission)).toBe(false);
      expect(can("distributor", permission)).toBe(false);
      expect(can("customer", permission)).toBe(false);
    }
  });

  it("lets dealers and distributors register, bulk import, see the registration hub and file claims", () => {
    for (const role of ["dealer", "distributor"] as const) {
      expect(can(role, "registrations:create")).toBe(true);
      expect(can(role, "registrations:bulk")).toBe(true);
      expect(can(role, "registrations:hub")).toBe(true);
      expect(can(role, "claims:create")).toBe(true);
      expect(can(role, "claims:act")).toBe(false);
    }
  });

  it("gives customers self-registration and warranty claims only", () => {
    expect(can("customer", "registrations:self")).toBe(true);
    expect(can("customer", "claims:create")).toBe(true);
    expect(can("customer", "claims:act")).toBe(false);
    expect(can("customer", "units:list")).toBe(false);
    expect(can("customer", "registrations:hub")).toBe(false);
  });

  it("denies everything without a role", () => {
    expect(can(undefined, "claims:create")).toBe(false);
    expect(hasRole(null, ["admin"])).toBe(false);
  });

  it("checks role lists", () => {
    expect(hasRole("admin", ["admin", "dealer"])).toBe(true);
    expect(hasRole("customer", ["admin"])).toBe(false);
  });

  it("treats only the admin as office staff", () => {
    expect(isStaff("admin")).toBe(true);
    expect(isStaff("distributor")).toBe(false);
  });
});

import { can, hasRole, isStaff } from "./permissions";

describe("permissions", () => {
  it("keeps review, void, service hand-off, claim actions and simulation with the admin", () => {
    for (const permission of [
      "registrations:inbox",
      "units:void",
      "complaints:send",
      "claims:act",
      "admin:manage",
      "simulate:run",
    ] as const) {
      expect(can("admin", permission)).toBe(true);
      expect(can("dealer", permission)).toBe(false);
      expect(can("distributor", permission)).toBe(false);
      expect(can("customer", permission)).toBe(false);
    }
  });

  it("lets dealers and distributors register, bulk import and see claims read-only", () => {
    for (const role of ["dealer", "distributor"] as const) {
      expect(can(role, "registrations:create")).toBe(true);
      expect(can(role, "registrations:bulk")).toBe(true);
      expect(can(role, "claims:view")).toBe(true);
      expect(can(role, "claims:act")).toBe(false);
    }
  });

  it("gives customers self-registration and complaints only", () => {
    expect(can("customer", "registrations:self")).toBe(true);
    expect(can("customer", "complaints:create")).toBe(true);
    expect(can("customer", "claims:view")).toBe(false);
    expect(can("customer", "units:list")).toBe(false);
  });

  it("denies everything without a role", () => {
    expect(can(undefined, "claims:view")).toBe(false);
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

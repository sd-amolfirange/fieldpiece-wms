import { claimActionsFor, isOpenClaim, nextClaimStatus } from "./claim-transitions";
import { needsAdminReview, validateRegistrationRow, type RowContext } from "./registration-rules";
import { canSee, canSeeClaim, visibleDealerIds } from "./scope";
import type { Dealer, User } from "./types";

describe("validateRegistrationRow", () => {
  const ctx: RowContext = {
    modelCodes: new Set(["AER-SPL15", "AER-SPL18"]),
    existingSerials: new Set(["AER-SPL15-250301"]),
    seenInFile: new Set(["AER-SPL15-260901"]),
    today: "2026-09-24",
  };
  const valid = {
    serial: "aer-spl15-260910",
    modelCode: "aer-spl15",
    installDate: "2026-09-15",
    customerName: "P. Kale",
  };

  it("accepts a clean row (serial and model are normalised)", () => {
    expect(validateRegistrationRow(valid, ctx)).toEqual({});
  });

  it("flags the three deliberate errors in the sample file", () => {
    expect(validateRegistrationRow({ ...valid, modelCode: "AER-SPL20" }, ctx)).toEqual({
      modelCode: "unknown_model",
    });
    expect(validateRegistrationRow({ ...valid, serial: "AER-SPL15-250301" }, ctx)).toEqual({
      serial: "duplicate_serial",
    });
    expect(validateRegistrationRow({ ...valid, installDate: "" }, ctx)).toEqual({ installDate: "required" });
  });

  it("catches bad dates, bad serials, repeats in the file and missing names", () => {
    expect(validateRegistrationRow({ ...valid, installDate: "15/09/2026" }, ctx).installDate).toBe(
      "invalid_date",
    );
    expect(validateRegistrationRow({ ...valid, installDate: "2026-09-25" }, ctx).installDate).toBe(
      "future_date",
    );
    expect(validateRegistrationRow({ ...valid, serial: "AB" }, ctx).serial).toBe("invalid_serial");
    expect(validateRegistrationRow({ ...valid, serial: "AER-SPL15-260901" }, ctx).serial).toBe(
      "duplicate_in_file",
    );
    expect(validateRegistrationRow({ ...valid, customerName: " " }, ctx).customerName).toBe("required");
  });

  it("sends only a lone duplicate serial to admin review", () => {
    expect(needsAdminReview({ serial: "duplicate_serial" })).toBe(true);
    expect(needsAdminReview({ serial: "duplicate_serial", installDate: "required" })).toBe(false);
    expect(needsAdminReview({ modelCode: "unknown_model" })).toBe(false);
  });
});

describe("claim transitions", () => {
  it("follows Draft -> Submitted -> Approved -> Paid for the admin", () => {
    expect(nextClaimStatus("DRAFT", "submit", "admin")).toBe("SUBMITTED");
    expect(nextClaimStatus("SUBMITTED", "approve", "admin")).toBe("APPROVED");
    expect(nextClaimStatus("APPROVED", "mark_paid", "admin")).toBe("PAID");
    expect(nextClaimStatus("SUBMITTED", "reject", "admin")).toBe("REJECTED");
  });

  it("lets the OEM (system) decide but not submit or pay", () => {
    expect(claimActionsFor("SUBMITTED", "system").map((t) => t.action)).toEqual(["approve", "reject"]);
    expect(nextClaimStatus("DRAFT", "submit", "system")).toBeNull();
    expect(nextClaimStatus("APPROVED", "mark_paid", "system")).toBeNull();
  });

  it("gives dealers, distributors and customers no actions", () => {
    for (const role of ["dealer", "distributor", "customer"] as const) {
      expect(claimActionsFor("DRAFT", role)).toEqual([]);
      expect(claimActionsFor("SUBMITTED", role)).toEqual([]);
    }
  });

  it("rejects invalid moves and ends at Paid / Rejected", () => {
    expect(nextClaimStatus("DRAFT", "mark_paid", "admin")).toBeNull();
    expect(claimActionsFor("PAID", "admin")).toEqual([]);
    expect(claimActionsFor("REJECTED", "admin")).toEqual([]);
    expect(claimActionsFor("DRAFT", null)).toEqual([]);
  });

  it("counts Draft, Submitted and Approved as open", () => {
    expect(
      ["DRAFT", "SUBMITTED", "APPROVED", "PAID", "REJECTED"].filter((s) => isOpenClaim(s as never)),
    ).toEqual(["DRAFT", "SUBMITTED", "APPROVED"]);
  });
});

describe("scope", () => {
  const dealers: Dealer[] = [
    { id: "d-coolair", name: "CoolAir", city: "Pune", distributorId: "dist" },
    { id: "d-breeze", name: "Breeze", city: "Nashik", distributorId: "dist" },
    { id: "d-arctic", name: "Arctic", city: "Mumbai" },
  ];
  const admin: User = { id: "a", name: "A", email: "a", role: "admin" };
  const dist: User = { id: "n", name: "N", email: "n", role: "distributor", distributorId: "dist" };
  const coolair: User = { id: "c", name: "C", email: "c", role: "dealer", dealerId: "d-coolair" };
  const customer: User = { id: "r", name: "R", email: "r", role: "customer", customerId: "c-rk" };

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
    expect(canSeeClaim(customer, { dealerId: "d-coolair", customerId: "c-rk" }, dealers)).toBe(false);
    expect(canSeeClaim(coolair, { dealerId: "d-coolair" }, dealers)).toBe(true);
  });
});

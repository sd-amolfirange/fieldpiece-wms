import { rejectClaimSchema, submitClaimSchema } from "./schemas";

describe("claim action schemas", () => {
  it("submits with an amount and an optional RMA number", () => {
    expect(submitClaimSchema.safeParse({ amount: "8500" }).success).toBe(true);
    expect(submitClaimSchema.safeParse({ rmaNumber: " RMA-1 ", amount: "8500" }).data?.rmaNumber).toBe(
      "RMA-1",
    );
  });

  it("needs a positive amount before submitting", () => {
    for (const amount of ["", "0", "-5", "abc"]) {
      const result = submitClaimSchema.safeParse({ amount });
      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.message).toBe("validation.amount");
    }
  });

  it("needs a reason of at least 5 characters to reject", () => {
    expect(rejectClaimSchema.safeParse({ reason: "  no  " }).success).toBe(false);
    expect(rejectClaimSchema.safeParse({ reason: "Not a warranty fault" }).success).toBe(true);
  });
});

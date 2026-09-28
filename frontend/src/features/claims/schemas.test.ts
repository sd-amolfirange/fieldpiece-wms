import { approveClaimSchema, claimSchema, closeClaimSchema, rejectClaimSchema } from "./schemas";

describe("warranty claim forms", () => {
  it("needs a product, an issue type and a description of the fault", () => {
    const result = claimSchema.safeParse({ unitSerial: "", issueType: "", description: "broken" });
    expect(result.success).toBe(false);
    const messages = result.error?.issues.map((i) => i.message);
    expect(messages).toEqual(
      expect.arrayContaining(["validation.pickUnit", "validation.issueType", "validation.describeFault"]),
    );
    expect(
      claimSchema.safeParse({
        unitSerial: "251406233",
        issueType: "DISPLAY",
        description: "Display flickers when the jaw is open.",
      }).success,
    ).toBe(true);
  });

  it("asks for a credit amount only for a credit", () => {
    expect(approveClaimSchema.safeParse({ resolution: "REPAIR" }).success).toBe(true);
    const credit = approveClaimSchema.safeParse({ resolution: "CREDIT", creditAmount: "" });
    expect(credit.error?.issues[0]?.message).toBe("validation.amount");
    expect(approveClaimSchema.safeParse({ resolution: "CREDIT", creditAmount: "139.00" }).success).toBe(true);
    expect(approveClaimSchema.safeParse({ resolution: "" }).success).toBe(false);
  });

  it("needs a reason to reject", () => {
    expect(rejectClaimSchema.safeParse({ reason: "no" }).success).toBe(false);
    expect(rejectClaimSchema.safeParse({ reason: "Warranty expired before the fault." }).success).toBe(true);
  });

  it("needs the replacement serial only when closing a replacement", () => {
    expect(closeClaimSchema(true).safeParse({ replacementSerial: "" }).success).toBe(false);
    expect(closeClaimSchema(true).safeParse({ replacementSerial: "252707701" }).success).toBe(true);
    expect(closeClaimSchema(false).safeParse({}).success).toBe(true);
  });
});

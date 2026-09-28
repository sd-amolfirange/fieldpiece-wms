import { voidWarrantySchema } from "./schemas";

describe("void warranty schema", () => {
  it("accepts a known reason with an optional note", () => {
    expect(voidWarrantySchema.safeParse({ reason: "UNAUTHORIZED_REPAIR" }).success).toBe(true);
    const parsed = voidWarrantySchema.safeParse({ reason: "OTHER", note: "  Tamper label broken  " });
    expect(parsed.data?.note).toBe("Tamper label broken");
  });

  it("needs a reason", () => {
    for (const reason of ["", "SOMETHING_ELSE", undefined]) {
      const result = voidWarrantySchema.safeParse({ reason });
      expect(result.error?.issues[0]?.message).toBe("validation.voidReason");
    }
  });
});

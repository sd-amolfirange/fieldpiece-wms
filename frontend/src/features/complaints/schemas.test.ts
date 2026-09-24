import { complaintSchema } from "./schemas";

describe("complaint schema", () => {
  it("accepts a unit and a fault description", () => {
    expect(
      complaintSchema.safeParse({ unitSerial: "AER-SPL15-210311", description: "No cooling" }).success,
    ).toBe(true);
  });

  it("asks for the unit first", () => {
    const result = complaintSchema.safeParse({ unitSerial: "", description: "No cooling" });
    expect(result.error?.issues[0]?.message).toBe("validation.pickUnit");
  });

  it("needs at least 5 characters of fault, ignoring spaces", () => {
    const result = complaintSchema.safeParse({ unitSerial: "AER-SPL15-210311", description: "  bad  " });
    expect(result.error?.issues[0]?.message).toBe("validation.describeFault");
  });
});

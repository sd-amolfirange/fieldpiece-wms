import { claimSchema, rejectSchema } from "./schemas";

const valid = {
  serialNumber: " aer-spl15-210311 ",
  failureCategory: "no_power" as const,
  failureDate: "2026-01-10",
  description: "The meter will not power on with fresh batteries installed.",
  photoCount: 0,
  resolution: "repair" as const,
};

describe("claimSchema", () => {
  it("accepts a valid claim and normalises the serial", () => {
    const result = claimSchema.safeParse(valid);
    expect(result.success).toBe(true);
    expect(result.data?.serialNumber).toBe("AER-SPL15-210311");
  });

  it("needs at least 30 characters of description", () => {
    const result = claimSchema.safeParse({ ...valid, description: "Broken." });
    expect(result.error?.issues[0]?.path).toEqual(["description"]);
  });

  it.each(["physical", "display"] as const)("needs a photo for %s failures", (failureCategory) => {
    const result = claimSchema.safeParse({ ...valid, failureCategory });
    expect(result.error?.issues.map((i) => i.path.join("."))).toContain("photoCount");
    expect(claimSchema.safeParse({ ...valid, failureCategory, photoCount: 1 }).success).toBe(true);
  });

  it("rejects failure dates in the future", () => {
    const result = claimSchema.safeParse({ ...valid, failureDate: "2999-01-01" });
    expect(result.error?.issues.map((i) => i.path.join("."))).toContain("failureDate");
  });
});

describe("rejectSchema", () => {
  it("requires a reason and a message to the customer", () => {
    expect(rejectSchema.safeParse({}).success).toBe(false);
    expect(
      rejectSchema.safeParse({ reason: "misuse", message: "Unit shows signs of water damage." }).success,
    ).toBe(true);
  });
});

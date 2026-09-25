import type { Entitlement } from "@wms/domain";
import { jobPhotoSvg, newPartSerial, partToReplace } from "./job-photos";

const entitlement = (coveredPartTypes: Entitlement["coveredPartTypes"]): Entitlement => ({
  parts: coveredPartTypes.length ? "COVERED" : "CHARGEABLE",
  labour: "CHARGEABLE",
  coveredPartTypes,
  claimable: coveredPartTypes.length > 0,
  reason: coveredPartTypes.length ? "PARTIAL" : "NOTHING_ACTIVE",
});

describe("job result helpers", () => {
  it("replaces the requested part, else the first covered key part, else the compressor", () => {
    expect(partToReplace({ entitlement: entitlement(["UNIT", "PCB"]) }, "COMPRESSOR")).toBe("COMPRESSOR");
    expect(partToReplace({ entitlement: entitlement(["UNIT", "PCB"]) })).toBe("PCB");
    expect(partToReplace({ entitlement: entitlement(["UNIT"]) }, "UNIT")).toBe("COMPRESSOR");
    expect(partToReplace({ entitlement: entitlement([]) })).toBe("COMPRESSOR");
  });

  it("names replacement serials after the day and a sequence", () => {
    expect(newPartSerial("COMPRESSOR", "2026-09-25", 1)).toBe("CP-260925-01");
    expect(newPartSerial("PCB", "2026-09-25", 12)).toBe("PCB-260925-12");
  });

  it("escapes text in the placeholder photo", () => {
    expect(jobPhotoSvg('<script>"x"</script>', "A&B")).not.toMatch(/<script>|A&B/);
  });
});

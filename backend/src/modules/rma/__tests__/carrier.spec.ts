import { detectCarrier } from "../carrier";

describe("detectCarrier", () => {
  it.each([
    ["1Z999AA10123456784", "UPS"],
    ["9400 1000 0000 0000 0000 00", "USPS"],
    ["EA123456789US", "USPS"],
    ["123456789012", "FedEx"],
    ["1234567890", "DHL"],
  ])("detects %s as %s", (tracking, carrier) => {
    expect(detectCarrier(tracking)).toBe(carrier);
  });

  it("returns null for unknown formats", () => {
    expect(detectCarrier("ABC")).toBeNull();
  });
});

import { parseQrPayload, registerUrl } from "./payload";

describe("QR label payload", () => {
  it("encodes the customer registration page with serial and model", () => {
    const url = registerUrl("https://demo.example", "AER-SPL15-240917", "AER-SPL15");
    expect(url).toBe("https://demo.example/register?serial=AER-SPL15-240917&model=AER-SPL15");
  });

  it("reads back the label URL (from any host)", () => {
    expect(
      parseQrPayload("https://x.trycloudflare.com/register?serial=aer-spl15-240917&model=aer-spl15"),
    ).toEqual({
      serial: "AER-SPL15-240917",
      modelCode: "AER-SPL15",
    });
  });

  it("accepts a bare serial number", () => {
    expect(parseQrPayload(" aer-spl15-210311 ")).toEqual({ serial: "AER-SPL15-210311" });
  });

  it("ignores unrelated codes", () => {
    expect(parseQrPayload("https://example.com/menu")).toBeNull();
    expect(parseQrPayload("hello world, not a serial")).toBeNull();
  });
});

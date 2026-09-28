import { parseQrPayload, registerUrl } from "./payload";

describe("QR label payload", () => {
  it("encodes the registration page with serial, model and batch", () => {
    const url = registerUrl("https://wms.example", "261804517", "SM482V", "2618-L02");
    expect(url).toBe("https://wms.example/register?serial=261804517&model=SM482V&batch=2618-L02");
  });

  it("reads back the label URL (from any host)", () => {
    expect(
      parseQrPayload("https://x.trycloudflare.com/register?serial=261804517&model=sm482v&batch=2618-l02"),
    ).toEqual({
      serial: "261804517",
      modelCode: "SM482V",
      batchNumber: "2618-L02",
    });
  });

  it("reads labels printed without a batch", () => {
    expect(parseQrPayload("https://wms.example/register?serial=261804517&model=SM482V")).toEqual({
      serial: "261804517",
      modelCode: "SM482V",
    });
  });

  it("accepts a bare serial number", () => {
    expect(parseQrPayload(" 2618 04517 ")).toEqual({ serial: "261804517" });
  });

  it("ignores unrelated codes", () => {
    expect(parseQrPayload("https://example.com/menu")).toBeNull();
    expect(parseQrPayload("hello world, not a serial")).toBeNull();
  });
});

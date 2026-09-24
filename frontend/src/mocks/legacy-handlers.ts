import { delay, http, HttpResponse } from "msw";
import { products, registrations } from "./data";

// LEGACY: the public warranty check (/check) is out of scope for the demo and no longer routed, but its code
// and test are kept until the team decides about deleting it. Only its endpoint stays mocked.

export function legacyHandlers(api: (path: string) => string) {
  return [
    http.get(api("/warranty/check"), async ({ request }) => {
      await delay(50);
      const serial = new URL(request.url).searchParams.get("serial")?.toUpperCase() ?? "";
      if (serial === "RATELIMIT") {
        return HttpResponse.json(
          {
            code: "rate_limited",
            message: "Too many checks in a short time. Wait a minute, then try again.",
          },
          { status: 429 },
        );
      }
      const reg = registrations.find((r) => r.serialNumber === serial);
      const product = products.find((p) => p.sku === (reg?.sku ?? serial.split("-")[0]));
      if (!product) {
        return HttpResponse.json(
          {
            code: "serial_not_found",
            message:
              "Serial number not found. Check the label on the back of the unit, or register it first.",
          },
          { status: 404 },
        );
      }
      return HttpResponse.json({
        serialNumber: serial,
        product,
        registered: !!reg,
        warrantyStatus: reg?.status ?? "NOT_REGISTERED",
        warrantyEnd: reg?.warrantyEnd ?? null,
      });
    }),
  ];
}

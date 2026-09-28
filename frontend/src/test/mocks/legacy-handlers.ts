import { addMonths, format, subDays } from "date-fns";
import { delay, http, HttpResponse } from "msw";

// LEGACY: the public warranty check (/check) is out of scope and not in the backend's API, but its code and test are
// kept until the team decides about deleting it. Only its endpoint stays mocked, with its own small fixture (the old
// shapes, which the rest of the mock API no longer uses).

const isoDate = (d: Date) => format(d, "yyyy-MM-dd");

const products = [
  { sku: "SC680", name: "Clamp meter", family: "meters", warrantyMonths: 36, launchDate: "2019-01-01" },
  {
    sku: "SMAN460",
    name: "Digital manifold",
    family: "gauges",
    warrantyMonths: 36,
    launchDate: "2018-06-01",
  },
  { sku: "VP85", name: "Vacuum pump", family: "vacuum", warrantyMonths: 24, launchDate: "2017-03-01" },
  {
    sku: "DR82",
    name: "Refrigerant leak detector",
    family: "leak_detection",
    warrantyMonths: 24,
    launchDate: "2020-02-01",
  },
  {
    sku: "STA2",
    name: "Hot wire anemometer",
    family: "airflow",
    warrantyMonths: 12,
    launchDate: "2016-09-01",
  },
];

/** Registered serials: `<sku>-<number>`, purchased `daysAgo` days before today. */
const registered = ([sku, number, daysAgo]: [string, number, number]) => {
  const product = products.find((p) => p.sku === sku)!;
  const purchase = subDays(new Date(), daysAgo);
  const end = addMonths(purchase, product.warrantyMonths);
  const daysLeft = (end.getTime() - Date.now()) / 86_400_000;
  return {
    serialNumber: `${sku}-${number}`,
    sku,
    warrantyEnd: isoDate(end),
    status: daysLeft < 0 ? "EXPIRED" : daysLeft <= 60 ? "EXPIRING_SOON" : "ACTIVE",
  };
};

const registrations = (
  [
    ["SC680", 100037, 120],
    ["SMAN460", 100074, 700],
    ["VP85", 100111, 800],
    ["DR82", 100148, 30],
    ["STA2", 100185, 500],
  ] as [string, number, number][]
).map(registered);

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

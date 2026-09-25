import type { IsoDate } from "@wms/domain";

// "Today" as a calendar date in the business time zone. The server clock runs in UTC (main.ts), so a plain
// `format(new Date(), "yyyy-MM-dd")` would roll over at 05:30 in India instead of midnight.

const formatters = new Map<string, Intl.DateTimeFormat>();

export function isoDateIn(timeZone: string, instant: Date): IsoDate {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    // en-CA formats as yyyy-MM-dd.
    formatter = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
    formatters.set(timeZone, formatter);
  }
  return formatter.format(instant);
}

// Calendar-date helpers that work purely in UTC.
// Business dates (purchase date, warranty end) have no time zone, and date-fns' addMonths / startOfDay use the
// host's local zone, which silently shifts dates on a developer laptop. These helpers never do.

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Parses "YYYY-MM-DD" to a Date at 00:00:00 UTC. Throws on malformed or impossible dates. */
export function parseIsoDate(value: string): Date {
  const match = ISO_DATE.exec(value);
  if (!match) throw new RangeError(`Invalid ISO date: ${value}`);
  const [, y, m, d] = match;
  const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  if (formatIsoDate(date) !== value) throw new RangeError(`Invalid ISO date: ${value}`);
  return date;
}

/** Formats a Date as "YYYY-MM-DD" using its UTC calendar day. */
export function formatIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Truncates to 00:00:00 UTC of the same UTC calendar day. */
export function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function addUtcDays(date: Date, days: number): Date {
  const result = startOfUtcDay(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

/** Adds calendar months, clamping to the last day of the target month (31 Jan + 1 month = 28/29 Feb). */
export function addUtcMonths(date: Date, months: number): Date {
  const day = date.getUTCDate();
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target;
}

/** Whole calendar days from `earlier` to `later` (negative if `later` is before `earlier`). */
export function differenceInUtcCalendarDays(later: Date, earlier: Date): number {
  return Math.round((startOfUtcDay(later).getTime() - startOfUtcDay(earlier).getTime()) / 86_400_000);
}

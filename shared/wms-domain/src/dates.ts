import {
  addMonths,
  differenceInCalendarDays,
  format,
  isValid,
  parseISO,
} from "date-fns";
import type { IsoDate } from "./types";

// Calendar-date helpers. Warranty maths works on yyyy-MM-dd strings in local time, never on UTC timestamps,
// so a date never shifts by a day across time zones.

export function todayIso(now: Date = new Date()): IsoDate {
  return format(now, "yyyy-MM-dd");
}

export function isIsoDate(value: unknown): value is IsoDate {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    isValid(parseISO(value))
  );
}

/** Adds calendar months; month ends clamp (31 Jan + 1 month = 28/29 Feb). */
export function addMonthsIso(date: IsoDate, months: number): IsoDate {
  return format(addMonths(parseISO(date), months), "yyyy-MM-dd");
}

export function addDaysIso(date: IsoDate, days: number): IsoDate {
  const d = parseISO(date);
  d.setDate(d.getDate() + days);
  return format(d, "yyyy-MM-dd");
}

/** Whole calendar days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: IsoDate, to: IsoDate): number {
  return differenceInCalendarDays(parseISO(to), parseISO(from));
}

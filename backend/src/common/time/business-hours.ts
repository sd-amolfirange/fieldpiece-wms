import { formatIsoDate } from "./utc-date";

// SLA business-hours maths (Section 8.4). Pure and UTC-based.
// [CONFIRM] business hours, time zone and holiday calendar with Fieldpiece.

export interface BusinessCalendar {
  /** Hour the business day starts, 0-23, UTC. */
  startHour: number;
  /** Hour the business day ends, 1-24, UTC. Must be greater than startHour. */
  endHour: number;
  /** Holidays as "YYYY-MM-DD" (UTC calendar days). */
  holidays: ReadonlySet<string>;
}

const HOUR_MS = 3_600_000;

function isBusinessDay(date: Date, calendar: BusinessCalendar): boolean {
  const weekday = date.getUTCDay();
  return weekday !== 0 && weekday !== 6 && !calendar.holidays.has(formatIsoDate(date));
}

function atHour(date: Date, hour: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), hour));
}

/** Moves forward to the next moment that falls inside business hours. */
function nextBusinessMoment(from: Date, calendar: BusinessCalendar): Date {
  let cursor = new Date(from);
  for (let guard = 0; guard < 3660; guard++) {
    const dayStart = atHour(cursor, calendar.startHour);
    const dayEnd = atHour(cursor, calendar.endHour);
    if (isBusinessDay(cursor, calendar) && cursor < dayEnd) {
      return cursor < dayStart ? dayStart : cursor;
    }
    cursor = atHour(new Date(dayStart.getTime() + 24 * HOUR_MS), calendar.startHour);
  }
  throw new RangeError("No business day found within 10 years; check the holiday calendar");
}

/** Adds `hours` of business time to `start`, skipping nights, weekends and holidays. */
export function addBusinessHours(start: Date, hours: number, calendar: BusinessCalendar): Date {
  if (calendar.endHour <= calendar.startHour) throw new RangeError("endHour must be after startHour");
  if (hours < 0) throw new RangeError("hours must be non-negative");

  let remaining = hours * HOUR_MS;
  let cursor = nextBusinessMoment(start, calendar);
  while (remaining > 0) {
    const dayEnd = atHour(cursor, calendar.endHour);
    const available = dayEnd.getTime() - cursor.getTime();
    if (remaining <= available) return new Date(cursor.getTime() + remaining);
    remaining -= available;
    cursor = nextBusinessMoment(dayEnd, calendar);
  }
  return cursor;
}

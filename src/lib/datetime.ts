import { DateTime } from 'luxon';

/**
 * The single source of truth for business time.
 *
 * Every business-critical date decision (what is due today, what is overdue,
 * which period an action falls into) MUST be computed in this zone, never in
 * the browser's zone. Instants (completed_at, created_at) are stored as UTC
 * timestamptz; business dates are stored as plain DATE values produced here.
 */
export const BUSINESS_TZ = 'Europe/Zurich';

/** An ISO business date, `YYYY-MM-DD`, always interpreted in BUSINESS_TZ. */
export type BusinessDate = string;

/** Current instant as a DateTime pinned to the business zone. */
export function businessNow(now: Date = new Date()): DateTime {
  return DateTime.fromJSDate(now, { zone: BUSINESS_TZ });
}

/** Today's business date. Deliberately independent of the runtime's zone. */
export function businessToday(now: Date = new Date()): BusinessDate {
  return businessNow(now).toISODate() as BusinessDate;
}

/**
 * Parse a business date to a DateTime at the START of that day in Zurich.
 * On DST-transition days this is still the true local midnight, which is why
 * we never do date math on raw UTC offsets.
 */
export function parseBusinessDate(date: BusinessDate): DateTime {
  const dt = DateTime.fromISO(date, { zone: BUSINESS_TZ }).startOf('day');
  if (!dt.isValid) throw new Error(`Invalid business date: ${date}`);
  return dt;
}

export function toBusinessDate(dt: DateTime): BusinessDate {
  return dt.setZone(BUSINESS_TZ).toISODate() as BusinessDate;
}

/** Whole calendar days from `a` to `b`, computed on Zurich day boundaries. */
export function daysBetween(a: BusinessDate, b: BusinessDate): number {
  return Math.round(parseBusinessDate(b).diff(parseBusinessDate(a), 'days').days);
}

export function addDays(date: BusinessDate, days: number): BusinessDate {
  return toBusinessDate(parseBusinessDate(date).plus({ days }));
}

export function compareDates(a: BusinessDate, b: BusinessDate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** An instant (UTC, for storage) from the business zone. */
export function nowUtcISO(now: Date = new Date()): string {
  return DateTime.fromJSDate(now).toUTC().toISO() as string;
}

/** ISO weekday: Monday = 1 ... Sunday = 7. */
export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export const WEEKDAY = {
  MONDAY: 1,
  TUESDAY: 2,
  WEDNESDAY: 3,
  THURSDAY: 4,
  FRIDAY: 5,
  SATURDAY: 6,
  SUNDAY: 7,
} as const satisfies Record<string, Weekday>;

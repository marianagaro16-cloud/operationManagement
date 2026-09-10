import { DateTime } from 'luxon';
import { BUSINESS_TZ, parseBusinessDate, toBusinessDate, type BusinessDate } from '@/lib/datetime';

/**
 * Order scheduling.
 *
 * Delivery date and preparation date are separate concepts. Preparation
 * defaults to the delivery date and an admin may move it earlier; the
 * Lotnummerkontrol view is driven by PREPARATION date, Order Control by
 * DELIVERY date. Preparation is never inferred from the delivery method.
 *
 * All dates are business dates in Europe/Zurich — the same rule the task
 * recurrence engine follows, so a shift that starts before midnight UTC
 * still sees the correct day.
 */

/** Preparation defaults to the delivery date. */
export function defaultPreparationDate(deliveryDate: BusinessDate): BusinessDate {
  return deliveryDate;
}

/** Preparation `leadDays` before delivery. */
export function preparationDateFor(
  deliveryDate: BusinessDate,
  leadDays: number,
): BusinessDate {
  if (leadDays <= 0) return deliveryDate;
  return toBusinessDate(parseBusinessDate(deliveryDate).minus({ days: leadDays }));
}

/** Preparation must not fall after delivery. */
export function isValidSchedule(
  deliveryDate: BusinessDate,
  preparationDate: BusinessDate,
): boolean {
  return preparationDate <= deliveryDate;
}

/** Inclusive business-date bounds of a month, for the Order Control filter. */
export function monthRange(month: string): { start: BusinessDate; end: BusinessDate } {
  const dt = DateTime.fromISO(`${month}-01`, { zone: BUSINESS_TZ });
  if (!dt.isValid) throw new Error(`Invalid month: ${month}`);
  return {
    start: toBusinessDate(dt.startOf('month')),
    end: toBusinessDate(dt.endOf('month')),
  };
}

/** The Mon–Sun ISO week containing `date`, for weekday quick-navigation. */
export function weekDays(date: BusinessDate): BusinessDate[] {
  const start = parseBusinessDate(date).startOf('week');
  return Array.from({ length: 7 }, (_, i) => toBusinessDate(start.plus({ days: i })));
}

/**
 * The next date on or after `from` falling on `weekday` (ISO, Monday = 1).
 * Used to propose the next delivery date for a recurring template.
 */
export function nextWeekdayOnOrAfter(from: BusinessDate, weekday: number): BusinessDate {
  const dt = parseBusinessDate(from);
  const delta = (weekday - dt.weekday + 7) % 7;
  return toBusinessDate(dt.plus({ days: delta }));
}

/**
 * Delivery dates a template would propose within a window.
 * Returns plans only — an admin confirms before anything becomes an order.
 */
export function proposedDeliveryDates(
  weekday: number,
  rangeStart: BusinessDate,
  rangeEnd: BusinessDate,
): BusinessDate[] {
  const out: BusinessDate[] = [];
  const end = parseBusinessDate(rangeEnd);
  let cursor = parseBusinessDate(nextWeekdayOnOrAfter(rangeStart, weekday));
  while (cursor <= end) {
    out.push(toBusinessDate(cursor));
    cursor = cursor.plus({ weeks: 1 });
  }
  return out;
}

/* ---------------------------- standing orders --------------------------- */

/**
 * A standing order's cadence.
 *
 * `intervalWeeks` of 1 is every week and needs no anchor. Anything wider does:
 * "every second Tuesday" has two equally valid answers until you say which
 * Tuesday the count starts from, and without one the schedule would drift
 * depending on when it was asked. The database enforces the same rule with a
 * CHECK constraint.
 */
export interface StandingCadence {
  /** ISO weekday, Monday = 1. */
  weekday: number;
  intervalWeeks: number;
  /** Any date in a week that IS a delivery week. Required above interval 1. */
  anchorDate: BusinessDate | null;
}

/**
 * Does this cadence deliver on this date?
 *
 * Weeks are counted between the Monday of the anchor's week and the Monday of
 * the candidate's week, so the answer does not depend on which weekday the
 * anchor happened to be written as — an anchor of Tuesday the 8th and one of
 * Friday the 11th describe the same week and must behave identically.
 *
 * Counting is symmetric around the anchor: a date BEFORE it is on-cadence if
 * it is a whole number of intervals away, which keeps "every second Tuesday"
 * meaning the same thing whether you ask about next month or last.
 */
export function deliversOn(cadence: StandingCadence, date: BusinessDate): boolean {
  const dt = parseBusinessDate(date);
  if (dt.weekday !== cadence.weekday) return false;
  if (cadence.intervalWeeks <= 1) return true;
  if (!cadence.anchorDate) return false;

  const anchorWeek = parseBusinessDate(cadence.anchorDate).startOf('week');
  const candidateWeek = dt.startOf('week');
  const weeksApart = Math.round(candidateWeek.diff(anchorWeek, 'weeks').weeks);

  // Modulo that stays correct for negative differences: JavaScript's % keeps
  // the sign of the dividend, so -2 % 2 is -0 but -3 % 2 is -1, not 1.
  const remainder = ((weeksApart % cadence.intervalWeeks) + cadence.intervalWeeks)
    % cadence.intervalWeeks;
  return remainder === 0;
}

/**
 * Every delivery date this cadence produces within a window, inclusive.
 *
 * The one implementation the screen and the scheduler both read, so the date
 * a template SAYS it will next deliver on is the date the cron actually
 * creates. Two copies of this rule would disagree the first time somebody
 * fixed a boundary in one of them.
 */
export function standingDeliveryDates(
  cadence: StandingCadence,
  rangeStart: BusinessDate,
  rangeEnd: BusinessDate,
): BusinessDate[] {
  const out: BusinessDate[] = [];
  const end = parseBusinessDate(rangeEnd);
  let cursor = parseBusinessDate(nextWeekdayOnOrAfter(rangeStart, cadence.weekday));

  while (cursor <= end) {
    const date = toBusinessDate(cursor);
    if (deliversOn(cadence, date)) out.push(date);
    // Always step a single week: stepping by the interval from a date that is
    // off-cadence would stay off-cadence forever.
    cursor = cursor.plus({ weeks: 1 });
  }
  return out;
}

/** The next date this cadence delivers on, at or after `from`. */
export function nextStandingDelivery(
  cadence: StandingCadence,
  from: BusinessDate,
): BusinessDate | null {
  // A year is far enough: interval_weeks is capped at 52, so any live cadence
  // delivers at least once inside it.
  const end = toBusinessDate(parseBusinessDate(from).plus({ weeks: 53 }));
  return standingDeliveryDates(cadence, from, end)[0] ?? null;
}

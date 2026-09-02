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

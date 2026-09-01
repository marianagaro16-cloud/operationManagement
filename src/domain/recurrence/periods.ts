import { DateTime } from 'luxon';
import { BUSINESS_TZ, parseBusinessDate, toBusinessDate, type BusinessDate } from '@/lib/datetime';
import type { Frequency, ScheduleConfig } from './types';

/**
 * Period keys are the mechanism that enforces the central business rule:
 * a task definition produces AT MOST ONE requirement per recurrence period.
 * The database backs this with UNIQUE(task_id, period_key), so the guarantee
 * survives concurrent writers and repeated generation runs.
 */

/** `2026-09-01` */
export function dailyPeriodKey(date: BusinessDate): string {
  return date;
}

/** `2026-W36` — ISO week, so the week is Monday..Sunday in Zurich. */
export function weeklyPeriodKey(date: BusinessDate): string {
  const dt = parseBusinessDate(date);
  return `${dt.weekYear}-W${String(dt.weekNumber).padStart(2, '0')}`;
}

/**
 * `BW-2026-09-08` — keyed by the occurrence's own due date.
 *
 * Biweekly has no natural calendar period, so the due date IS the period.
 * Keying this way means re-anchoring a task creates genuinely new future
 * requirements while every historical occurrence keeps its identity.
 */
export function biweeklyPeriodKey(dueDate: BusinessDate): string {
  return `BW-${dueDate}`;
}

/** `2026-09` */
export function monthlyPeriodKey(date: BusinessDate): string {
  const dt = parseBusinessDate(date);
  return `${dt.year}-${String(dt.month).padStart(2, '0')}`;
}

/** `2026-H1` (Jan–Jun) or `2026-H2` (Jul–Dec) */
export function semiannualPeriodKey(date: BusinessDate): string {
  const dt = parseBusinessDate(date);
  return `${dt.year}-H${dt.month <= 6 ? 1 : 2}`;
}

/**
 * The period key that a given business date falls into, for a task.
 * Used to answer "does today's action satisfy an existing requirement?".
 */
export function periodKeyForDate(
  frequency: Frequency,
  date: BusinessDate,
  config: ScheduleConfig | null,
): string | null {
  switch (frequency) {
    case 'daily':
      return dailyPeriodKey(date);
    case 'weekly':
      return weeklyPeriodKey(date);
    case 'monthly':
      return monthlyPeriodKey(date);
    case 'semiannual':
      return semiannualPeriodKey(date);
    case 'biweekly': {
      // Requires the anchor to locate the enclosing cycle.
      if (!config || config.kind !== 'biweekly') return null;
      const due = biweeklyDueDateOnOrBefore(config.anchorDate, date);
      return due ? biweeklyPeriodKey(due) : null;
    }
  }
}

/** The most recent anchor+14n date that is <= `date` (null if before anchor). */
export function biweeklyDueDateOnOrBefore(
  anchorDate: BusinessDate,
  date: BusinessDate,
): BusinessDate | null {
  const anchor = parseBusinessDate(anchorDate);
  const target = parseBusinessDate(date);
  const days = Math.round(target.diff(anchor, 'days').days);
  if (days < 0) return null;
  const cycle = Math.floor(days / 14);
  return toBusinessDate(anchor.plus({ days: cycle * 14 }));
}

/**
 * Inclusive business-date window a period covers. The dashboard uses this to
 * decide whether an occurrence is still "live" versus historical.
 */
export function periodWindow(
  frequency: Frequency,
  dueDate: BusinessDate,
): { start: BusinessDate; end: BusinessDate } {
  const dt = parseBusinessDate(dueDate);
  switch (frequency) {
    case 'daily':
      return { start: dueDate, end: dueDate };
    case 'weekly':
      return {
        start: toBusinessDate(dt.startOf('week')),
        end: toBusinessDate(dt.endOf('week')),
      };
    case 'biweekly':
      return { start: dueDate, end: toBusinessDate(dt.plus({ days: 13 })) };
    case 'monthly':
      return {
        start: toBusinessDate(dt.startOf('month')),
        end: toBusinessDate(dt.endOf('month')),
      };
    case 'semiannual': {
      const half = dt.month <= 6 ? 1 : 2;
      const start = DateTime.fromObject(
        { year: dt.year, month: half === 1 ? 1 : 7, day: 1 },
        { zone: BUSINESS_TZ },
      );
      return { start: toBusinessDate(start), end: toBusinessDate(start.plus({ months: 6 }).minus({ days: 1 })) };
    }
  }
}

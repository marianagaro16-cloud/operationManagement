import { parseBusinessDate, toBusinessDate, type BusinessDate, type Weekday } from '@/lib/datetime';

/**
 * Turning a plan into dates.
 *
 * Weekly, biweekly, monthly and semiannual work is no longer produced by a
 * rule — a person places it. This is the arithmetic behind "every Tuesday and
 * Thursday this month": it expands a range and a set of weekdays into the
 * actual dates, and nothing else.
 *
 * Pure and synchronous like the rest of `src/domain`, so it is exhaustively
 * testable and runs identically from a server action and a test. It does NOT
 * decide what should be scheduled — that is the whole point of the change.
 */

/**
 * Every date in [from, to] falling on one of `weekdays`.
 *
 * An empty `weekdays` means every day in the range, not no days: the planner
 * offers weekday filtering as a narrowing, so selecting nothing is "do not
 * narrow". Returning nothing there would make the commonest bulk action —
 * "put this on every day of the week" — impossible to express.
 *
 * Iterates by calendar day rather than adding multiples of 24 hours: across a
 * DST boundary Zurich has a 23- and a 25-hour day, and stepping by duration
 * would drift onto the wrong date.
 */
export function expandPlanDates(
  from: BusinessDate,
  to: BusinessDate,
  weekdays: readonly Weekday[] = [],
): BusinessDate[] {
  const start = parseBusinessDate(from);
  const end = parseBusinessDate(to);
  if (!start.isValid || !end.isValid || end < start) return [];

  const wanted = new Set(weekdays);
  const dates: BusinessDate[] = [];

  for (let d = start; d <= end; d = d.plus({ days: 1 })) {
    if (wanted.size === 0 || wanted.has(d.weekday as Weekday)) {
      dates.push(toBusinessDate(d));
    }
  }
  return dates;
}

/**
 * The inclusive week a date sits in, Monday to Sunday.
 *
 * ISO weeks, matching `weeklyPeriodKey` and the rest of the app — the
 * operation reads its calendar in KW numbers, and a week that started on
 * Sunday would put Monday's work in the previous one.
 */
export function weekRange(date: BusinessDate): { from: BusinessDate; to: BusinessDate } {
  const dt = parseBusinessDate(date);
  return {
    from: toBusinessDate(dt.startOf('week')),
    to: toBusinessDate(dt.endOf('week')),
  };
}

/** The inclusive calendar month a date sits in. */
export function monthRange(date: BusinessDate): { from: BusinessDate; to: BusinessDate } {
  const dt = parseBusinessDate(date);
  return {
    from: toBusinessDate(dt.startOf('month')),
    to: toBusinessDate(dt.endOf('month')),
  };
}

/**
 * Drop dates already in the past.
 *
 * Placing work on a day that has gone is never what someone means when they
 * plan a month from the middle of it, and an occurrence created overdue is
 * noise on somebody's dashboard the moment it appears. Today itself is kept:
 * "add this to today" is the single commonest thing the planner does.
 */
export function fromTodayOnward(dates: readonly BusinessDate[], today: BusinessDate): BusinessDate[] {
  return dates.filter((d) => d >= today);
}

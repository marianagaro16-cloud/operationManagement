import type { BusinessDate } from '@/lib/datetime';

/**
 * Overdue / today / upcoming — the buckets the whole application is organised
 * around, defined once.
 *
 * There were three implementations. The task dashboard bucketed occurrences by
 * their effective due date and treated `status === 'pending'` as open. The
 * inventory dashboard bucketed by inventory date and treated
 * `status === 'in_progress'` as open, with a 60-day look-back baked in. The
 * order dashboard had no buckets at all. Each then re-sectioned the same
 * arrays again in its view layer.
 *
 * The result was that "overdue" meant two different things on the two halves
 * of one screen — which is a problem for a dashboard whose entire purpose is
 * to be compared at a glance.
 *
 * The two things that legitimately differ between modules are: which date the
 * item is due on, and what counts as unfinished. Both are parameters. Nothing
 * else is.
 */

/**
 * How far back a dashboard looks for work that is still open.
 *
 * Overdue never expires — a count missed in June stays overdue — but a screen
 * still has to bound its query somewhere. One number, so the task and
 * inventory dashboards cut off at the same place instead of at 60 days and
 * "no bound at all".
 */
export const OVERDUE_LOOKBACK_DAYS = 60;

export interface BucketRules<T> {
  /** The date this item is due. For tasks the EFFECTIVE due date, never the raw one. */
  dateOf: (item: T) => BusinessDate;
  /**
   * Is this item still outstanding?
   *
   * Only overdue consults it: something late and finished is history, not a
   * problem. Today and upcoming show everything, done or not, because a
   * checklist you have completed still belongs on today's list.
   */
  isOpen: (item: T) => boolean;
}

export interface Buckets<T> {
  /** Due before today and still open. Never expires — old work stays visible. */
  overdue: T[];
  /** Due today, whatever its state. */
  today: T[];
  /** Due after today and still open. */
  upcoming: T[];
}

export function bucketByDay<T>(
  items: readonly T[],
  today: BusinessDate,
  rules: BucketRules<T>,
): Buckets<T> {
  const overdue: T[] = [];
  const dueToday: T[] = [];
  const upcoming: T[] = [];

  // Business dates are ISO strings, so lexical comparison IS date comparison.
  // That is why every date in this system is a BusinessDate and never a Date.
  for (const item of items) {
    const date = rules.dateOf(item);
    if (date === today) dueToday.push(item);
    else if (date < today) {
      if (rules.isOpen(item)) overdue.push(item);
    } else if (rules.isOpen(item)) upcoming.push(item);
  }

  return { overdue, today: dueToday, upcoming };
}

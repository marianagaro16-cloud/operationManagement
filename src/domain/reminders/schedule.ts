import { DateTime } from 'luxon';
import { BUSINESS_TZ } from '@/lib/datetime';

/**
 * Reminder time arithmetic.
 *
 * Pure and free of I/O, like the task recurrence engine, so the rules that
 * decide when somebody's phone buzzes are unit-tested rather than assembled
 * inside a component.
 *
 * Deliberately NOT the task recurrence engine. That one encodes warehouse
 * scheduling — a daily default of Monday to Friday, semiannual dates pulled
 * back to a Friday, at most one occurrence per period, and no time of day. A
 * reminder is "every Friday at 16:00", which it cannot express and should not
 * have to learn.
 *
 * Every occurrence is counted from the anchor (the first due moment), in the
 * reminder's own timezone. Counting from the anchor rather than from the
 * previous occurrence is what stops a monthly reminder on the 31st sliding to
 * the 28th after February; counting in wall-clock time is what keeps a 09:00
 * reminder at 09:00 across the DST change.
 */

export const RECURRENCES = ['none', 'daily', 'weekdays', 'weekly', 'monthly'] as const;
export type Recurrence = (typeof RECURRENCES)[number];

export const NOTIFY_BEFORE = [5, 15, 30, 60, 120, 1440] as const;
export type NotifyBefore = (typeof NOTIFY_BEFORE)[number];

/** Upper bound on how far a series is walked, so a bad anchor cannot spin. */
const MAX_STEPS = 20_000;

export function isValidTimezone(zone: string): boolean {
  return DateTime.now().setZone(zone).isValid;
}

/** The k-th occurrence of a rule counted from its anchor. */
function occurrence(anchor: DateTime, rule: Exclude<Recurrence, 'none' | 'weekdays'>, k: number): DateTime {
  switch (rule) {
    case 'daily':   return anchor.plus({ days: k });
    case 'weekly':  return anchor.plus({ weeks: k });
    // Luxon clamps to the last day of a short month, and because k is always
    // counted from the anchor the clamp never accumulates.
    case 'monthly': return anchor.plus({ months: k });
  }
}

const isWeekend = (d: DateTime) => d.weekday === 6 || d.weekday === 7;

/**
 * The first occurrence of the series strictly after `after`.
 *
 * Returns null for a one-off reminder, which has no next occurrence.
 */
export function nextOccurrence(
  rule: Recurrence,
  anchorIso: string,
  afterIso: string,
  zone: string = BUSINESS_TZ,
): string | null {
  if (rule === 'none') return null;

  const anchor = DateTime.fromISO(anchorIso, { zone });
  const after = DateTime.fromISO(afterIso, { zone });
  if (!anchor.isValid || !after.isValid) return null;

  if (rule === 'weekdays') {
    // Walk day by day from the anchor's time of day, skipping Saturday and
    // Sunday. Starting from the later of the anchor and `after` keeps this a
    // handful of iterations however old the series is.
    let d = anchor > after
      ? anchor
      : anchor.set({ year: after.year, month: after.month, day: after.day });
    for (let i = 0; i < 14; i++) {
      if (d > after && d >= anchor && !isWeekend(d)) return d.toUTC().toISO();
      d = d.plus({ days: 1 });
    }
    return null;
  }

  if (anchor > after) return anchor.toUTC().toISO();

  // Estimate k from the elapsed span, then step forward: exact, and bounded
  // regardless of how long ago the anchor was.
  const unit = rule === 'daily' ? 'days' : rule === 'weekly' ? 'weeks' : 'months';
  let k = Math.max(0, Math.floor(after.diff(anchor, unit).as(unit)) - 1);
  for (let i = 0; i < MAX_STEPS; i++, k++) {
    const candidate = occurrence(anchor, rule, k);
    if (candidate > after) return candidate.toUTC().toISO();
  }
  return null;
}

/**
 * Where a recurring reminder goes when its current occurrence is completed.
 *
 * The next occurrence after BOTH the one just completed and now: completing a
 * daily reminder that was three days overdue lands on tomorrow, not on the
 * two days already missed, which would only ask to be completed again.
 */
export function advanceAfterCompletion(
  rule: Recurrence,
  anchorIso: string,
  currentDueIso: string,
  nowIso: string,
  zone: string = BUSINESS_TZ,
): string | null {
  const current = DateTime.fromISO(currentDueIso);
  const now = DateTime.fromISO(nowIso);
  const after = current > now ? current : now;
  return nextOccurrence(rule, anchorIso, after.toISO()!, zone);
}

/** A wall-clock date and time in a zone, as the UTC moment it names. */
export function localToUtc(date: string, time: string, zone: string = BUSINESS_TZ): string | null {
  const dt = DateTime.fromISO(`${date}T${time}`, { zone });
  return dt.isValid ? dt.toUTC().toISO() : null;
}

/** The inverse: the wall-clock date and time a moment falls on in a zone. */
export function utcToLocal(iso: string, zone: string = BUSINESS_TZ): { date: string; time: string } {
  const dt = DateTime.fromISO(iso, { zone: 'utc' }).setZone(zone);
  return { date: dt.toISODate()!, time: dt.toFormat('HH:mm') };
}

export const SNOOZE_PRESETS = ['10m', '1h', '3h', 'tomorrow'] as const;
export type SnoozePreset = (typeof SNOOZE_PRESETS)[number];

/** The hour "tomorrow" means when snoozing. The start of a working day. */
export const TOMORROW_HOUR = 9;

/** Resolve a snooze preset to the moment it names. */
export function snoozeUntil(preset: SnoozePreset, nowIso: string, zone: string = BUSINESS_TZ): string {
  const now = DateTime.fromISO(nowIso).setZone(zone);
  switch (preset) {
    case '10m': return now.plus({ minutes: 10 }).toUTC().toISO()!;
    case '1h':  return now.plus({ hours: 1 }).toUTC().toISO()!;
    case '3h':  return now.plus({ hours: 3 }).toUTC().toISO()!;
    case 'tomorrow':
      return now.plus({ days: 1 }).set({ hour: TOMORROW_HOUR, minute: 0, second: 0, millisecond: 0 })
        .toUTC().toISO()!;
  }
}

export type ReminderStatus = 'open' | 'completed' | 'cancelled' | 'converted';

/**
 * What a reminder looks like right now.
 *
 * Only open/completed/cancelled/converted are stored. Overdue, due today and
 * upcoming are functions of the clock, so they are derived rather than kept
 * in a column that a job would have to flip — and that would be wrong
 * between two runs of it.
 */
export type ReminderPhase = 'overdue' | 'today' | 'upcoming' | 'completed' | 'cancelled' | 'converted';

export function reminderPhase(
  status: ReminderStatus,
  nextAtIso: string,
  nowIso: string,
  zone: string = BUSINESS_TZ,
): ReminderPhase {
  if (status !== 'open') return status;
  const next = DateTime.fromISO(nextAtIso).setZone(zone);
  const now = DateTime.fromISO(nowIso).setZone(zone);
  if (next < now) return 'overdue';
  return next.hasSame(now, 'day') ? 'today' : 'upcoming';
}

/** Personal task equivalent, where the time of day is optional. */
export function personalTaskPhase(
  status: 'open' | 'completed' | 'cancelled',
  dueDate: string | null,
  dueTime: string | null,
  nowIso: string,
  zone: string = BUSINESS_TZ,
): 'overdue' | 'today' | 'upcoming' | 'undated' | 'completed' | 'cancelled' {
  if (status !== 'open') return status;
  if (!dueDate) return 'undated';
  const now = DateTime.fromISO(nowIso).setZone(zone);
  const today = now.toISODate()!;
  if (dueDate < today) return 'overdue';
  if (dueDate > today) return 'upcoming';
  if (dueTime) {
    const due = DateTime.fromISO(`${dueDate}T${dueTime}`, { zone });
    if (due < now) return 'overdue';
  }
  return 'today';
}

/**
 * Whole calendar days from `today` to `date`, both `YYYY-MM-DD` in the same
 * zone: 0 is today, 1 tomorrow, -1 yesterday. Plain dates, so a DST change in
 * between cannot turn one day into 0.96 of one.
 */
export function daysFromToday(date: string, today: string): number {
  const at = (d: string) => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)));
  return Math.round((at(date) - at(today)) / 86_400_000);
}

/** Did this instant fall on `today` in the given zone? */
export function isOnDay(instantIso: string | null, today: string, zone: string = BUSINESS_TZ): boolean {
  if (!instantIso) return false;
  return DateTime.fromISO(instantIso).setZone(zone).toISODate() === today;
}

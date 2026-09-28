import { DateTime } from 'luxon';

/**
 * Birthdays and work anniversaries: which fall within the next few days.
 *
 * Pure, business dates only (YYYY-MM-DD, Europe/Zurich already applied).
 * Someone born on 29 February has their birthday on the 28th in a year
 * without one, rather than skipping it.
 */

export type CelebrationKind = 'birthday' | 'anniversary';

export interface CelebrationSource {
  id: string;
  name: string;
  birth_date: string | null;
  start_date: string | null;
}

export interface Celebration {
  workerId: string;
  name: string;
  kind: CelebrationKind;
  /** The day it falls on. */
  date: string;
  /** 0 = today. */
  daysAway: number;
  /** The age turned, or the years in the company completed. */
  years: number;
}

/** This year's (or next year's) occurrence of a yearly date, on or after today. */
export function nextYearly(original: string, today: string): { date: string; years: number } {
  const from = DateTime.fromISO(original);
  const now = DateTime.fromISO(today);
  const on = (year: number) =>
    // The day is held to the month's length, so 29 Feb becomes 28 Feb.
    DateTime.fromObject({ year, month: from.month, day: Math.min(from.day, DateTime.fromObject({ year, month: from.month }).daysInMonth!) });
  let year = now.year;
  if (on(year) < now) year += 1;
  return { date: on(year).toISODate()!, years: year - from.year };
}

/**
 * What falls from today to `days` days ahead, soonest first. An anniversary
 * counts from one full year; a start date in the future is no anniversary yet.
 */
export function upcomingCelebrations(workers: CelebrationSource[], today: string, days: number): Celebration[] {
  const now = DateTime.fromISO(today);
  const out: Celebration[] = [];
  for (const w of workers) {
    const sources: [CelebrationKind, string | null][] = [['birthday', w.birth_date], ['anniversary', w.start_date]];
    for (const [kind, original] of sources) {
      if (!original || original > today) continue;
      const next = nextYearly(original, today);
      if (next.years < 1) continue;
      const daysAway = Math.round(DateTime.fromISO(next.date).diff(now, 'days').days);
      if (daysAway > days) continue;
      out.push({ workerId: w.id, name: w.name, kind, date: next.date, daysAway, years: next.years });
    }
  }
  return out.sort((a, b) => a.daysAway - b.daysAway || a.name.localeCompare(b.name));
}

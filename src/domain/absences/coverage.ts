import { DateTime } from 'luxon';
import { BUSINESS_TZ } from '@/lib/datetime';

/**
 * Coverage arithmetic, pure: which hours of which days of an absence have to
 * be covered, what the planned periods leave uncovered, and what a new period
 * collides with. Times are "HH:MM" wall-clock times in Zurich.
 */

/** The working week coverage has to fill (Gestión → Ausencias). */
export interface WorkingHours {
  /** ISO weekdays, Monday = 1. */
  days: number[];
  start: string;
  /** Where "morning" ends and "afternoon" begins. */
  noon: string;
  end: string;
}

export const DEFAULT_HOURS: WorkingHours = { days: [1, 2, 3, 4, 5], start: '08:00', noon: '12:00', end: '18:00' };

export interface AbsenceSpan {
  start_date: string;
  end_date: string;
  first_day: 'full' | 'afternoon';
  last_day: 'full' | 'morning';
}

export interface Period {
  start: string;
  end: string;
}

const hm = (t: string) => t.slice(0, 5);
const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const fromMin = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/** The working days an absence covers, in order. */
export function workingDays(a: AbsenceSpan, hours: WorkingHours): string[] {
  const out: string[] = [];
  let d = DateTime.fromISO(a.start_date, { zone: BUSINESS_TZ });
  const last = DateTime.fromISO(a.end_date, { zone: BUSINESS_TZ });
  while (d <= last) {
    if (hours.days.includes(d.weekday)) out.push(d.toISODate()!);
    d = d.plus({ days: 1 });
  }
  return out;
}

/** The hours to cover on one day of an absence; null when it is not a working day of it. */
export function requiredWindow(a: AbsenceSpan, date: string, hours: WorkingHours): Period | null {
  if (date < a.start_date || date > a.end_date) return null;
  if (!hours.days.includes(DateTime.fromISO(date, { zone: BUSINESS_TZ }).weekday)) return null;
  const start = date === a.start_date && a.first_day === 'afternoon' ? hours.noon : hours.start;
  const end = date === a.end_date && a.last_day === 'morning' ? hours.noon : hours.end;
  return toMin(end) > toMin(start) ? { start, end } : null;
}

/** What of a window the periods leave uncovered, in order. */
export function gaps(window: Period, periods: Period[]): Period[] {
  const lo = toMin(window.start);
  const hi = toMin(window.end);
  const sorted = periods
    .map((p) => [Math.max(toMin(p.start), lo), Math.min(toMin(p.end), hi)] as const)
    .filter(([s, e]) => e > s)
    .sort((x, y) => x[0] - y[0]);
  const out: Period[] = [];
  let at = lo;
  for (const [s, e] of sorted) {
    if (s > at) out.push({ start: fromMin(at), end: fromMin(s) });
    at = Math.max(at, e);
  }
  if (at < hi) out.push({ start: fromMin(at), end: fromMin(hi) });
  return out;
}

/** Every uncovered stretch of an absence: per working day, what is left. */
export function absenceGaps(
  a: AbsenceSpan,
  hours: WorkingHours,
  covered: { cover_date: string; start_time: string; end_time: string }[],
): { date: string; gaps: Period[] }[] {
  return workingDays(a, hours)
    .map((date) => {
      const window = requiredWindow(a, date, hours);
      if (!window) return { date, gaps: [] };
      const periods = covered.filter((c) => c.cover_date === date).map((c) => ({ start: hm(c.start_time), end: hm(c.end_time) }));
      return { date, gaps: gaps(window, periods) };
    })
    .filter((d) => d.gaps.length > 0);
}

export const overlaps = (a: Period, b: Period) => toMin(a.start) < toMin(b.end) && toMin(b.start) < toMin(a.end);

export type CoverageConflict =
  | { kind: 'away'; start: string; end: string }
  | { kind: 'busy'; start: string; end: string; covering: string };

/**
 * What a period for someone collides with: they are away then, or already
 * covering someone. Warnings, not refusals — the planner decides.
 */
export function coverageConflicts(
  candidate: { date: string; start: string; end: string; id?: string },
  theirAbsences: AbsenceSpan[],
  theirCoverage: { id: string; cover_date: string; start_time: string; end_time: string; covering: string }[],
  hours: WorkingHours,
): CoverageConflict[] {
  const out: CoverageConflict[] = [];
  const period = { start: candidate.start, end: candidate.end };
  for (const a of theirAbsences) {
    if (candidate.date < a.start_date || candidate.date > a.end_date) continue;
    // Away all day unless the absence only takes half of this day.
    const from = candidate.date === a.start_date && a.first_day === 'afternoon' ? hours.noon : '00:00';
    const to = candidate.date === a.end_date && a.last_day === 'morning' ? hours.noon : '23:59';
    if (overlaps(period, { start: from, end: to })) out.push({ kind: 'away', start: from, end: to });
  }
  for (const c of theirCoverage) {
    if (c.id === candidate.id || c.cover_date !== candidate.date) continue;
    const other = { start: hm(c.start_time), end: hm(c.end_time) };
    if (overlaps(period, other)) out.push({ kind: 'busy', ...other, covering: c.covering });
  }
  return out;
}

/** Working days away within a period; a first afternoon or a last morning counts half. */
export function daysAwayIn(a: AbsenceSpan, from: string, to: string, hours: WorkingHours): number {
  return workingDays(a, hours)
    .filter((d) => d >= from && d <= to)
    .reduce((n, d) => {
      const half = (d === a.start_date && a.first_day === 'afternoon') || (d === a.end_date && a.last_day === 'morning');
      return n + (half ? 0.5 : 1);
    }, 0);
}

/** Minutes between two "HH:MM". */
export function minutesBetween(start: string, end: string): number {
  return Math.max(toMin(end.slice(0, 5)) - toMin(start.slice(0, 5)), 0);
}

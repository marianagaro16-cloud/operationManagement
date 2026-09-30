import { DateTime } from 'luxon';
import { BUSINESS_TZ } from '@/lib/datetime';

/**
 * A meeting that repeats: on a weekday, every one or two weeks — or every
 * month on the same weekday position (the first Monday, the last Thursday…)
 * — from a day, maybe until one.
 */
export interface SeriesRule {
  /** ISO weekday, Monday = 1. */
  weekday: number;
  interval_weeks: 1 | 2;
  /** Monthly on the nth weekday (1–4, or -1 for the last); null repeats by weeks. */
  monthly_nth?: number | null;
  starts_on: string;
  until: string | null;
}

/** How far ahead a series' meetings are made. */
export const SERIES_AHEAD_WEEKS = 12;

/** The nth (1–4) or last (-1) given weekday of a month; null when the month has no such one. */
function nthWeekdayOf(year: number, month: number, weekday: number, nth: number): DateTime | null {
  if (nth === -1) {
    let d = DateTime.fromObject({ year, month, day: 1 }, { zone: BUSINESS_TZ }).endOf('month').startOf('day');
    while (d.weekday !== weekday) d = d.minus({ days: 1 });
    return d;
  }
  let d = DateTime.fromObject({ year, month, day: 1 }, { zone: BUSINESS_TZ });
  while (d.weekday !== weekday) d = d.plus({ days: 1 });
  d = d.plus({ weeks: nth - 1 });
  return d.month === month ? d : null;
}

/**
 * The weekday position a date has in its month: the last such weekday is
 * "last" (-1) — month-end meetings stay at month end — otherwise first to
 * fourth.
 */
export function monthlyNthOf(date: string): number {
  const d = DateTime.fromISO(date, { zone: BUSINESS_TZ });
  if (d.plus({ weeks: 1 }).month !== d.month) return -1;
  return Math.ceil(d.day / 7);
}

/**
 * The days a series meets between two days, in order. Weekly: the first
 * chosen weekday on or after its start, then every one or two weeks counted
 * from that first one — so a fortnightly meeting keeps its rhythm whatever
 * range is asked for. Monthly: that weekday position in each month.
 */
export function seriesDates(rule: SeriesRule, from: string, to: string): string[] {
  const last = rule.until && rule.until < to ? rule.until : to;
  const out: string[] = [];

  if (rule.monthly_nth) {
    let month = DateTime.fromISO(rule.starts_on, { zone: BUSINESS_TZ }).startOf('month');
    const end = DateTime.fromISO(last, { zone: BUSINESS_TZ });
    while (month <= end) {
      const d = nthWeekdayOf(month.year, month.month, rule.weekday, rule.monthly_nth);
      const iso = d?.toISODate();
      if (iso && iso >= rule.starts_on && iso >= from && iso <= last) out.push(iso);
      month = month.plus({ months: 1 });
    }
    return out;
  }

  let first = DateTime.fromISO(rule.starts_on, { zone: BUSINESS_TZ });
  while (first.weekday !== rule.weekday) first = first.plus({ days: 1 });
  for (let d = first; d.toISODate()! <= last; d = d.plus({ weeks: rule.interval_weeks })) {
    const iso = d.toISODate()!;
    if (iso >= from) out.push(iso);
  }
  return out;
}

/** The weekday of a date, Monday = 1. */
export function weekdayOf(date: string): number {
  return DateTime.fromISO(date, { zone: BUSINESS_TZ }).weekday;
}

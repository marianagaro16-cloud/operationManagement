import { DateTime } from 'luxon';
import { BUSINESS_TZ } from '@/lib/datetime';

/** A meeting that repeats: on a weekday, every one or two weeks, from a day, maybe until one. */
export interface SeriesRule {
  /** ISO weekday, Monday = 1. */
  weekday: number;
  interval_weeks: 1 | 2;
  starts_on: string;
  until: string | null;
}

/** How far ahead a series' meetings are made. */
export const SERIES_AHEAD_WEEKS = 12;

/**
 * The days a series meets between two days, in order. The first is the
 * first chosen weekday on or after its start; then every one or two weeks,
 * counted from that first one — so a fortnightly meeting keeps its rhythm
 * whatever range is asked for.
 */
export function seriesDates(rule: SeriesRule, from: string, to: string): string[] {
  let first = DateTime.fromISO(rule.starts_on, { zone: BUSINESS_TZ });
  while (first.weekday !== rule.weekday) first = first.plus({ days: 1 });
  const last = rule.until && rule.until < to ? rule.until : to;
  const out: string[] = [];
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

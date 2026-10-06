/**
 * Guides: which points belong to a day, and how a covered day stands.
 *
 * Pure. A point lives on ISO weekdays (1 = Monday); a rhythm finer than that —
 * "only the last Thursday of the month" — stays in its text, and the covering
 * person marks it "not today".
 */
import { DateTime } from 'luxon';
import { BUSINESS_TZ } from '@/lib/datetime';
import type { GuideBlock } from '@/types/guide';

export const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;

/** The ISO weekday of a business date. */
export function isoWeekday(date: string): number {
  return DateTime.fromISO(date, { zone: BUSINESS_TZ }).weekday;
}

interface DayPoint {
  kind: 'task' | 'rule';
  weekdays: number[];
  sort_order: number;
  deadline: string | null;
}

/**
 * A weekday's points in the order they are done: as arranged, a deadline
 * breaking ties so the 7:00 one never hides under the afternoon's.
 */
export function pointsOn<T extends DayPoint>(points: T[], weekday: number): T[] {
  return points
    .filter((p) => p.weekdays.includes(weekday))
    .sort((a, b) => a.sort_order - b.sort_order || (a.deadline ?? '99').localeCompare(b.deadline ?? '99'));
}

/** The weekdays a guide has anything on, Monday to Friday always. */
export function daysWithPoints(points: { weekdays: number[] }[]): number[] {
  return WEEKDAYS.filter((d) => d <= 5 || points.some((p) => p.weekdays.includes(d)));
}

/** How many of a day's tasks nobody has touched yet. */
export function openCount(points: { id: string; kind: 'task' | 'rule' }[], checked: Iterable<string>): number {
  const seen = new Set(checked);
  return points.filter((p) => p.kind === 'task' && !seen.has(p.id)).length;
}

/** Keeps only well-formed blocks, trimmed; an empty one is dropped. */
export function cleanBlocks(blocks: GuideBlock[]): GuideBlock[] {
  const out: GuideBlock[] = [];
  for (const b of blocks) {
    if (b.type === 'heading' || b.type === 'text') {
      const text = b.text.trim();
      if (text) out.push({ type: b.type, text });
    } else if (b.type === 'image') {
      if (b.path) out.push({ type: 'image', path: b.path, ...(b.caption?.trim() ? { caption: b.caption.trim() } : {}) });
    } else if (b.type === 'table') {
      const rows = b.rows.map((r) => r.map((c) => c.trim())).filter((r) => r.some(Boolean));
      const width = Math.max(0, ...rows.map((r) => r.length));
      if (rows.length && width) out.push({ type: 'table', rows: rows.map((r) => [...r, ...Array(width - r.length).fill('')]) });
    }
  }
  return out;
}

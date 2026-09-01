import type { OccurrenceWithTask } from '@/types/database';
import type { BusinessDate } from '@/lib/datetime';

/**
 * Reporting lives in the domain layer, not in a chart component, so new KPIs
 * are added by extending this function rather than by editing the UI.
 */

export interface Breakdown {
  key: string;
  label: string;
  total: number;
  completed: number;
  skipped: number;
  overdue: number;
  rate: number;
}

export interface Stats {
  total: number;
  completed: number;
  skipped: number;
  overdue: number;
  pending: number;
  /** Completed / (total - skipped). Skips are excluded from the denominator:
   *  an authorised skip is not a failure to complete. */
  completionRate: number;
  byUser: Breakdown[];
  byCategory: Breakdown[];
  byFrequency: Breakdown[];
}

function summarise(items: OccurrenceWithTask[], today: BusinessDate) {
  let completed = 0, skipped = 0, overdue = 0, pending = 0;
  for (const o of items) {
    const due = o.due_date_override ?? o.due_date;
    if (o.status === 'completed') completed++;
    else if (o.status === 'skipped') skipped++;
    else if (due < today) overdue++;
    else pending++;
  }
  const denominator = items.length - skipped;
  return {
    total: items.length,
    completed,
    skipped,
    overdue,
    pending,
    rate: denominator === 0 ? 0 : Math.round((completed / denominator) * 100),
  };
}

function group(
  items: OccurrenceWithTask[],
  today: BusinessDate,
  keyOf: (o: OccurrenceWithTask) => { key: string; label: string } | null,
): Breakdown[] {
  const buckets = new Map<string, { label: string; items: OccurrenceWithTask[] }>();
  for (const o of items) {
    const k = keyOf(o);
    if (!k) continue;
    const bucket = buckets.get(k.key);
    if (bucket) bucket.items.push(o);
    else buckets.set(k.key, { label: k.label, items: [o] });
  }
  return [...buckets.entries()]
    .map(([key, { label, items }]) => ({ key, label, ...summarise(items, today) }))
    .sort((a, b) => b.total - a.total);
}

export function computeStats(
  occurrences: OccurrenceWithTask[],
  today: BusinessDate,
  userNames: Map<string, string>,
): Stats {
  const base = summarise(occurrences, today);

  return {
    ...base,
    completionRate: base.rate,
    byUser: group(occurrences, today, (o) =>
      o.completed_by
        ? { key: o.completed_by, label: userNames.get(o.completed_by) ?? o.completed_by.slice(0, 8) }
        : null,
    ),
    byCategory: group(occurrences, today, (o) =>
      o.task.category ? { key: o.task.category.slug, label: o.task.category.name } : null,
    ),
    byFrequency: group(occurrences, today, (o) => ({
      key: o.task.frequency,
      label: o.task.frequency,
    })),
  };
}

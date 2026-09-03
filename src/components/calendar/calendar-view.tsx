'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { DateTime } from 'luxon';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useI18n } from '@/i18n';
import { localizedTitle } from '@/lib/localized-content';
import { cn } from '@/lib/utils';
import { Badge, Card, EmptyState } from '@/components/ui/primitives';
import { BUSINESS_TZ } from '@/lib/datetime';
import type { OccurrenceWithTask } from '@/types/database';

/**
 * Month grid of occurrences. Its purpose for an admin is to make a recurrence
 * RULE legible as concrete DATES — "last Thursday" only becomes trustworthy
 * once you can see it land on the 24th, the 29th, the 26th.
 */
export function CalendarView({
  occurrences,
  month,
  today,
}: {
  occurrences: OccurrenceWithTask[];
  month: string; // YYYY-MM-01
  today: string;
}) {
  const { t, locale, formatDate } = useI18n();
  const [selected, setSelected] = useState<string | null>(today);

  const anchor = DateTime.fromISO(month, { zone: BUSINESS_TZ }).setLocale(locale);

  const byDate = useMemo(() => {
    const map = new Map<string, OccurrenceWithTask[]>();
    for (const o of occurrences) {
      const key = o.due_date_override ?? o.due_date;
      const list = map.get(key);
      if (list) list.push(o);
      else map.set(key, [o]);
    }
    return map;
  }, [occurrences]);

  // Pad the grid to whole ISO weeks so columns line up under the weekday row.
  const gridStart = anchor.startOf('month').startOf('week');
  const gridEnd = anchor.endOf('month').endOf('week');
  const days: DateTime[] = [];
  for (let d = gridStart; d <= gridEnd; d = d.plus({ days: 1 })) days.push(d);

  const weekdayLabels = Array.from({ length: 7 }, (_, i) =>
    gridStart.plus({ days: i }).toFormat('ccc'),
  );

  const selectedList = selected ? (byDate.get(selected) ?? []) : [];

  const href = (delta: number) =>
    `/calendar?month=${anchor.plus({ months: delta }).toFormat('yyyy-MM-01')}`;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-[15px] font-semibold capitalize">{anchor.toFormat('LLLL yyyy')}</h2>
        <div className="flex items-center gap-1">
          <Link
            href={href(-1)}
            aria-label={t('calendar.prev')}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface-2 hover:text-fg"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden />
          </Link>
          <Link
            href="/calendar"
            className="inline-flex h-8 items-center rounded-lg border border-border bg-surface px-3 text-[13px] font-medium transition-colors hover:bg-surface-2"
          >
            {t('calendar.todayCta')}
          </Link>
          <Link
            href={href(1)}
            aria-label={t('calendar.next')}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface-2 hover:text-fg"
          >
            <ChevronRight className="h-4 w-4" aria-hidden />
          </Link>
        </div>
      </div>

      <Card className="overflow-hidden">
        <div className="grid grid-cols-7 border-b border-border bg-surface-2/50">
          {weekdayLabels.map((label) => (
            <div key={label} className="px-1 py-1.5 text-center text-2xs font-medium uppercase text-subtle">
              {label}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7">
          {days.map((d) => {
            const iso = d.toISODate() as string;
            const items = byDate.get(iso) ?? [];
            const outside = d.month !== anchor.month;
            const isToday = iso === today;
            const open = items.filter((o) => o.status === 'pending').length;

            return (
              <button
                key={iso}
                onClick={() => setSelected(iso)}
                className={cn(
                  'relative min-h-[58px] border-b border-r border-border p-1 text-left transition-colors sm:min-h-[76px]',
                  outside && 'bg-surface-2/30 text-subtle',
                  selected === iso && 'bg-accent/5 ring-1 ring-inset ring-accent/30',
                  'hover:bg-surface-2/60',
                )}
              >
                <span
                  className={cn(
                    'inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] tabular',
                    isToday && 'bg-accent font-semibold text-accent-fg',
                  )}
                >
                  {d.day}
                </span>

                {items.length > 0 && (
                  <div className="mt-0.5 space-y-0.5">
                    <span className="block truncate text-[10px] leading-tight text-muted">
                      {items.length}
                    </span>
                    <div className="flex gap-0.5">
                      {open > 0 && <span className="h-1 w-1 rounded-full bg-accent" />}
                      {items.some((o) => o.status === 'completed') && (
                        <span className="h-1 w-1 rounded-full bg-done" />
                      )}
                      {items.some((o) => o.status === 'skipped') && (
                        <span className="h-1 w-1 rounded-full bg-skipped" />
                      )}
                    </div>
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </Card>

      {selected && (
        <div>
          <h3 className="mb-2 text-[13px] font-medium capitalize">
            {formatDate(selected, 'weekday')}
          </h3>
          {selectedList.length === 0 ? (
            <EmptyState title={t('calendar.noOccurrences')} />
          ) : (
            <ul className="space-y-1.5">
              {selectedList.map((o) => (
                <li
                  key={o.id}
                  className="flex items-center justify-between gap-2 rounded-lg border border-border bg-surface px-3 py-2"
                >
                  <span className="min-w-0 flex-1 truncate text-[13px]">{localizedTitle(o.task, locale)}</span>
                  <Badge tone="neutral">
                    {t(`frequency.${o.task.frequency}` as 'frequency.daily')}
                  </Badge>
                  <Badge
                    tone={
                      o.status === 'completed' ? 'done' : o.status === 'skipped' ? 'skipped' : 'neutral'
                    }
                  >
                    {t(`status.${o.status}` as 'status.pending')}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

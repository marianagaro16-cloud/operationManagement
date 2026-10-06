'use client';

import Link from 'next/link';
import { ListChecks } from 'lucide-react';
import { useI18n } from '@/i18n';
import { Badge, Card } from '@/components/ui/primitives';
import type { GuideDaySummary } from '@/types/guide';

/**
 * On an absence: how the absent person's guide was followed on each covered
 * day — what was done, what did not apply, what was left open, and what the
 * covering person wrote.
 */
export function GuideSummary({ days, profileId }: { days: GuideDaySummary[]; profileId: string }) {
  const { t, formatDate } = useI18n();
  if (days.length === 0) return null;

  return (
    <section id="guide" className="mt-6 scroll-mt-20">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-1.5 text-[15px] font-semibold">
          <ListChecks className="h-4 w-4 text-accent" aria-hidden />
          {t('guide.summaryTitle')}
        </h2>
        <Link href={`/guide?tab=days&person=${profileId}`} className="text-[12.5px] font-medium text-accent hover:underline">
          {t('guide.open')}
        </Link>
      </div>
      <div className="space-y-2">
        {days.map((day) => {
          const open = day.points.filter((p) => !p.check).length;
          return (
            <Card key={day.date} className="p-3">
              <details open={open > 0}>
                <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-[13.5px] font-medium">
                  {formatDate(day.date, 'weekday')}
                  <Badge tone={open === 0 ? 'done' : 'warn'}>
                    {open === 0 ? t('guide.summaryAll') : t('guide.summaryOpen', { count: open, total: day.points.length })}
                  </Badge>
                </summary>
                <ul className="mt-2 space-y-1.5">
                  {day.points.map((p) => (
                    <li key={p.id} className="flex items-start gap-2 text-[13px]">
                      <Badge tone={!p.check ? 'late' : p.check.status === 'done' ? 'done' : 'skipped'} className="mt-0.5 shrink-0">
                        {t(!p.check ? 'guide.left' : p.check.status === 'done' ? 'guide.done' : 'guide.skipped')}
                      </Badge>
                      <span className="min-w-0">
                        <span className="break-words">{p.title}</span>
                        {p.check && (p.check.comment || p.check.checked_by_name) && (
                          <span className="block text-[12px] text-muted">
                            {[p.check.checked_by_name, p.check.comment].filter(Boolean).join(' · ')}
                          </span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </details>
            </Card>
          );
        })}
      </div>
    </section>
  );
}

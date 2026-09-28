'use client';

import Link from 'next/link';
import { Check, Clock, Map, MapPin, X } from 'lucide-react';
import { useI18n } from '@/i18n';
import { Card } from '@/components/ui/primitives';
import { visitRouteLinks } from '@/domain/sales/visits';
import type { SalesVisit, StartPoint } from '@/types/sales';

/** The viewer's visits today, in route order, with the route. Nothing when there are none. */
export function TodayVisitsCard({ visits, start }: { visits: SalesVisit[]; start: StartPoint | null }) {
  const { t } = useI18n();
  if (visits.length === 0) return null;
  const links = visitRouteLinks(visits.map((v) => v.target), start ? { id: 'start', ...start } : null);

  return (
    <section className="mb-6">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-1.5 text-[15px] font-semibold">
          <MapPin className="h-4 w-4 text-accent" aria-hidden />
          {t('sales.visitsToday')}
          <span className="text-[12px] font-normal tabular text-muted">{visits.length}</span>
        </h2>
        <Link href="/sales?tab=visits" className="text-[12.5px] font-medium text-accent hover:underline">
          {t('sales.visitsSeeAll')}
        </Link>
      </div>
      <Card className="divide-y divide-border">
        {visits.map((v, i) => (
          <div key={v.id} className="flex items-center gap-3 px-3.5 py-2">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent/10 text-[12px] font-semibold tabular text-accent">
              {i + 1}
            </span>
            <span className="min-w-0 flex-1 truncate text-[13.5px]">{v.target.name}</span>
            {v.planned_time && (
              <span className="inline-flex items-center gap-0.5 text-[12px] tabular text-muted">
                <Clock className="h-3 w-3" aria-hidden />
                {v.planned_time.slice(0, 5)}
              </span>
            )}
            {v.status === 'done' && <Check className="h-4 w-4 text-done" aria-label={t('sales.visitDone')} />}
            {v.status === 'not_done' && <X className="h-4 w-4 text-muted" aria-label={t('sales.visitNotDone')} />}
          </div>
        ))}
      </Card>
      {links.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {links.map((href, i) => (
            <a
              key={href}
              href={href}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-accent px-3.5 text-sm font-medium text-accent-fg hover:opacity-90"
            >
              <Map className="h-4 w-4" aria-hidden />
              {links.length === 1 ? t('sales.visitOpenRoute') : t('sales.visitOpenLeg', { n: i + 1 })}
            </a>
          ))}
        </div>
      )}
    </section>
  );
}

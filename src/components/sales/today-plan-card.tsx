'use client';

import Link from 'next/link';
import { CalendarCheck, Check, Map, X } from 'lucide-react';
import { useI18n } from '@/i18n';
import { Card } from '@/components/ui/primitives';
import { visitRouteLinks } from '@/domain/sales/visits';
import { timeRange } from '@/domain/sales/times';
import { KindIcon, useKinds } from './activity-kind';
import type { ActivityKind, DayEnds, SalesActivity, StartPoint } from '@/types/sales';

/** The viewer's plan for today, in time order, with the visits' route. Nothing when the day is empty. */
export function TodayPlanCard({
  activities,
  kinds,
  points,
}: {
  activities: SalesActivity[];
  kinds: ActivityKind[];
  points: { ends: DayEnds; home: StartPoint | null; office: StartPoint | null } | null;
}) {
  const { t } = useI18n();
  const k = useKinds(kinds);
  if (activities.length === 0) return null;

  const visits = activities
    .filter((a) => k.get(a.kind_id)?.behavior === 'visit' && a.target)
    .sort((a, b) => a.position - b.position);
  const at = (which: 'home' | 'office') => {
    const p = points ? (which === 'home' ? points.home : points.office) : null;
    return p ? { id: which, ...p } : null;
  };
  const links = visits.length
    ? visitRouteLinks(visits.map((v) => v.target!), points ? at(points.ends.start_at) : null, points ? at(points.ends.end_at) : null)
    : [];

  return (
    <section>
      <div className="mb-2 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-1.5 text-[15px] font-semibold">
          <CalendarCheck className="h-4 w-4 text-accent" aria-hidden />
          {t('sales.planToday')}
          <span className="text-[12px] font-normal tabular text-muted">{activities.length}</span>
        </h2>
        <Link href="/sales?tab=planning" className="text-[12.5px] font-medium text-accent hover:underline">
          {t('sales.planSeeAll')}
        </Link>
      </div>
      <Card className="divide-y divide-border">
        {activities.map((a) => {
          const kind = k.get(a.kind_id);
          return (
            <div key={a.id} className="flex items-center gap-2.5 px-3.5 py-2">
              <span className="w-[4.75rem] shrink-0 text-[12px] font-semibold tabular text-muted">
                {timeRange(a.activity_time, a.activity_end) ?? '—'}
              </span>
              {kind && <KindIcon icon={kind.icon} className="h-4 w-4 shrink-0 text-accent" />}
              <span className="min-w-0 flex-1 truncate text-[13.5px]">
                {a.target?.name ?? a.title}
                {a.event && <span className="text-[12px] text-muted"> · {a.event.name}</span>}
              </span>
              {a.status === 'done' && <Check className="h-4 w-4 text-done" aria-label={t('sales.visitDone')} />}
              {a.status === 'not_done' && <X className="h-4 w-4 text-muted" aria-label={t('sales.visitNotDone')} />}
            </div>
          );
        })}
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

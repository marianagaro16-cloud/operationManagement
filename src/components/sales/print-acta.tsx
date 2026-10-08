'use client';

import { useEffect } from 'react';
import { useI18n } from '@/i18n';
import { timeRange } from '@/domain/sales/times';
import type { ActivityKind } from '@/types/sales';
import type { ActaTopic, SalesActa } from '@/types/sales-acta';
import { useKinds } from './activity-kind';
import { ActaContent } from './acta-view';

/** The printable Acta: opens the print dialog once it has drawn. */
export function PrintActa({ acta, topics, kinds, today }: { acta: SalesActa; topics: ActaTopic[]; kinds: ActivityKind[]; today: string }) {
  const { t, formatDate } = useI18n();
  const k = useKinds(kinds);
  useEffect(() => {
    const timer = setTimeout(() => window.print(), 400);
    return () => clearTimeout(timer);
  }, []);
  return (
    <main className="mx-auto max-w-3xl bg-surface p-6 text-fg print:max-w-none print:p-0">
      <p className="text-[12px] font-semibold uppercase tracking-wide text-muted">{t('acta.one')}</p>
      <h1 className="text-2xl font-semibold">{acta.target.name}</h1>
      <p className="mb-4 text-[13px] text-muted">
        {[
          k.name(acta.kind_id),
          formatDate(acta.meeting_date, 'weekday'),
          acta.start_time ? timeRange(acta.start_time, acta.end_time) : null,
          acta.salesperson_name,
        ].filter(Boolean).join(' · ')}
      </p>
      <ActaContent acta={acta} topics={topics} today={today} />
      {acta.registered_at && (
        <p className="mt-6 text-[11.5px] text-muted">
          {t('acta.registered', { date: formatDate(acta.registered_at.slice(0, 10), 'medium'), name: acta.registered_by_name ?? '—' })}
        </p>
      )}
    </main>
  );
}

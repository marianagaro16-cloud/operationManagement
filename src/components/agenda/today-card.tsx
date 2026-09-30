'use client';

import Link from 'next/link';
import { CalendarRange } from 'lucide-react';
import { useI18n } from '@/i18n';
import { Card } from '@/components/ui/primitives';
import type { AgendaItem } from '@/types/agenda';
import type { ActivityKind } from '@/types/sales';
import { Entry } from './agenda-view';

/**
 * "Hoy": the viewer's day from the agenda — the whole-day things, then by
 * time — with the same quick actions. What is late from before is counted in
 * "Ahora" below, not repeated here.
 */
export function TodayCard({ items, today, kinds, extra }: { items: AgendaItem[]; today: string; kinds: ActivityKind[]; extra?: React.ReactNode }) {
  const { t, formatDate } = useI18n();
  const done = items.filter((i) => i.done).length;
  return (
    <section className="mb-4">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-1.5 text-[15px] font-semibold capitalize">
          <CalendarRange className="h-4 w-4 text-accent" aria-hidden />
          {t('agenda.today')} · {formatDate(today, 'weekday')}
          {items.length > 0 && <span className="text-[12px] font-normal normal-case tabular text-muted">{t('agenda.doneOf', { done, total: items.length })}</span>}
        </h2>
        <Link href="/agenda" className="text-[12.5px] font-medium text-accent hover:underline">{t('agenda.seeWeek')}</Link>
      </div>
      {items.length === 0 ? (
        <Card className="px-3.5 py-3 text-[13px] text-muted">{t('agenda.nothingToday')}</Card>
      ) : (
        <Card className="divide-y divide-border">
          {items.map((i) => <Entry key={i.key} item={i} kinds={kinds} />)}
        </Card>
      )}
      {extra}
    </section>
  );
}

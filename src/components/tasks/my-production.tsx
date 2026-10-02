'use client';

import { DateTime } from 'luxon';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { Card, EmptyState } from '@/components/ui/primitives';
import { PageHeader } from '@/components/shell/app-shell';
import type { MadeProduction } from '@/server/production';
import { SHORTFALL_LABEL } from './production-dialog';

const qty = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, ''));

/**
 * What I produced: my own production orders already recorded, newest first,
 * grouped by day. Only past and today — never what is planned ahead.
 */
export function MyProduction({ made, today }: { made: MadeProduction[]; today: string }) {
  const { t, formatDate } = useI18n();
  const monthStart = DateTime.fromISO(today).startOf('month').toISODate()!;
  const thisMonth = made.filter((m) => m.due >= monthStart);
  const units = thisMonth.reduce((s, m) => s + Number(m.produced_quantity), 0);

  const days = [...new Set(made.map((m) => m.due))];

  return (
    <>
      <PageHeader title={t('production.mineTitle')} subtitle={t('production.mineSubtitle')} />

      <Card className="mb-4 flex flex-wrap gap-x-8 gap-y-2 p-3.5">
        <div>
          <p className="text-[11.5px] text-muted">{t('production.mineOrdersMonth')}</p>
          <p className="text-[20px] font-semibold tabular leading-tight">{thisMonth.length}</p>
        </div>
        <div>
          <p className="text-[11.5px] text-muted">{t('production.mineUnitsMonth')}</p>
          <p className="text-[20px] font-semibold tabular leading-tight">{qty(units)}</p>
        </div>
      </Card>

      {made.length === 0 ? (
        <EmptyState title={t('production.noneMade')} />
      ) : (
        <div className="space-y-4">
          {days.map((day) => (
            <section key={day}>
              <h2 className="mb-1.5 px-0.5 text-[12.5px] font-semibold capitalize text-muted">{formatDate(day, 'weekday')}</h2>
              <Card className="divide-y divide-border">
                {made
                  .filter((m) => m.due === day)
                  .map((m) => {
                    const short = Number(m.produced_quantity) < Number(m.target_quantity);
                    return (
                      <div key={m.occurrence_id} className="flex items-start gap-3 px-3.5 py-2.5">
                        <div className="min-w-0 flex-1">
                          <p className="text-[13.5px] font-medium">{m.product_name}</p>
                          <p className="text-[12px] text-muted">
                            {m.best_before && t('production.bestBeforeShort', { date: formatDate(m.best_before, 'short') })}
                            {short && m.shortfall_reason && (
                              <span className="text-warn">
                                {m.best_before && ' · '}
                                {t(SHORTFALL_LABEL[m.shortfall_reason])}
                                {m.shortfall_note && `: ${m.shortfall_note}`}
                              </span>
                            )}
                          </p>
                        </div>
                        <span className={cn('shrink-0 text-[13.5px] font-semibold tabular', short ? 'text-warn' : 'text-done')}>
                          {qty(Number(m.produced_quantity))} / {qty(Number(m.target_quantity))}
                        </span>
                      </div>
                    );
                  })}
              </Card>
            </section>
          ))}
        </div>
      )}
    </>
  );
}

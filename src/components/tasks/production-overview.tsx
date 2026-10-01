'use client';

import { useState } from 'react';
import { Factory } from 'lucide-react';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, EmptyState } from '@/components/ui/primitives';
import { PageHeader } from '@/components/shell/app-shell';
import type { MadeProduction, OpenProduction } from '@/server/production';
import { ProductionDialog, SHORTFALL_LABEL } from './production-dialog';

const qty = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, ''));

/** What is still to make (late in red), and what was made — with lots, best-before and shortfalls. */
export function ProductionOverview({ open, made, today }: { open: OpenProduction[]; made: MadeProduction[]; today: string }) {
  const { t, formatDate } = useI18n();
  const [recording, setRecording] = useState<OpenProduction | null>(null);
  const shortfalls = made.filter((m) => Number(m.produced_quantity) < Number(m.target_quantity)).length;

  return (
    <>
      <PageHeader title={t('production.title')} subtitle={t('production.subtitle')} />

      <section className="mb-6">
        <h2 className="mb-1.5 px-0.5 text-[13px] font-semibold">{t('production.toMake', { count: open.length })}</h2>
        {open.length === 0 ? (
          <EmptyState title={t('production.noneOpen')} />
        ) : (
          <Card className="divide-y divide-border">
            {open.map((o) => {
              const late = o.due < today;
              return (
                <div key={o.occurrence_id} className="flex items-center gap-3 px-3.5 py-2.5">
                  <span className={cn('w-24 shrink-0 text-[12px] tabular', late ? 'font-semibold text-late' : o.due === today ? 'font-medium text-accent' : 'text-muted')}>
                    {formatDate(o.due, 'short')}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13.5px] font-medium">
                      <span className="tabular">{qty(o.target_quantity)} ×</span> {o.product_name}
                    </p>
                    <p className="text-[12px] text-muted">{o.assignee_name ?? t('production.shared')}</p>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => setRecording(o)}>
                    <Factory className="h-3.5 w-3.5" aria-hidden />
                    {t('production.record')}
                  </Button>
                </div>
              );
            })}
          </Card>
        )}
      </section>

      <section>
        <h2 className="mb-1.5 px-0.5 text-[13px] font-semibold">
          {t('production.made', { count: made.length })}
          {shortfalls > 0 && <span className="ml-2 font-normal text-warn">{t('production.shortfalls', { count: shortfalls })}</span>}
        </h2>
        {made.length === 0 ? (
          <EmptyState title={t('production.noneMade')} />
        ) : (
          <Card className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead className="border-b border-border bg-surface-2/60 text-left text-[11.5px] text-muted">
                <tr>
                  <th className="px-3 py-2 font-medium">{t('production.day')}</th>
                  <th className="px-3 py-2 font-medium">{t('production.product')}</th>
                  <th className="px-3 py-2 text-right font-medium">{t('production.unitsShort')}</th>
                  <th className="px-3 py-2 font-medium">{t('production.lot')}</th>
                  <th className="px-3 py-2 font-medium">{t('production.bestBefore')}</th>
                  <th className="px-3 py-2 font-medium">{t('production.by')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {made.map((m) => {
                  const short = Number(m.produced_quantity) < Number(m.target_quantity);
                  return (
                    <tr key={m.occurrence_id} className="align-top">
                      <td className="whitespace-nowrap px-3 py-2 tabular text-muted">{formatDate(m.due, 'short')}</td>
                      <td className="px-3 py-2">
                        {m.product_name}
                        {short && m.shortfall_reason && (
                          <p className="text-[11.5px] text-warn">
                            {t(SHORTFALL_LABEL[m.shortfall_reason])}
                            {m.shortfall_note && `: ${m.shortfall_note}`}
                          </p>
                        )}
                      </td>
                      <td className={cn('whitespace-nowrap px-3 py-2 text-right font-semibold tabular', short ? 'text-warn' : 'text-done')}>
                        {qty(Number(m.produced_quantity))} / {qty(Number(m.target_quantity))}
                      </td>
                      <td className="px-3 py-2 tabular">{m.lot_number ?? '—'}</td>
                      <td className="whitespace-nowrap px-3 py-2 tabular">{m.best_before ? formatDate(m.best_before, 'short') : '—'}</td>
                      <td className="px-3 py-2 text-muted">{m.recorded_by_name ?? '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        )}
      </section>

      {recording && (
        <ProductionDialog
          occurrenceId={recording.occurrence_id}
          known={{ product_name: recording.product_name, target_quantity: recording.target_quantity, record: null }}
          onClose={() => setRecording(null)}
        />
      )}
    </>
  );
}

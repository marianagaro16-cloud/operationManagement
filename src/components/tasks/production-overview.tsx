'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Factory, Trash2 } from 'lucide-react';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Card, EmptyState, ErrorState } from '@/components/ui/primitives';
import { unplanTask } from '@/server/planning-actions';
import { PageHeader } from '@/components/shell/app-shell';
import type { MadeProduction, OpenProduction } from '@/server/production';
import { ProductionDialog, ProductionTargetButton, SHORTFALL_LABEL } from './production-dialog';

const qty = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, ''));

/** What is still to make (late in red), and what was made — with lots, best-before and shortfalls. */
export function ProductionOverview({ open, made, today }: { open: OpenProduction[]; made: MadeProduction[]; today: string }) {
  const { t, formatDate } = useI18n();
  const [recording, setRecording] = useState<OpenProduction | null>(null);
  const [cancelling, setCancelling] = useState<OpenProduction | null>(null);
  const [cancelError, setCancelError] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const shortfalls = made.filter((m) => Number(m.produced_quantity) < Number(m.target_quantity)).length;

  return (
    <>
      <PageHeader title={t('production.title')} subtitle={t('production.subtitle')} />

      <section className="mb-6">
        <h2 className="mb-1.5 px-0.5 text-[13px] font-semibold">{t('production.toMake', { count: open.length })}</h2>
        {cancelError && (
          <div className="mb-2">
            <ErrorState message={t('production.errCancel')} />
          </div>
        )}
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
                    <p className="flex items-center text-[13.5px] font-medium">
                      <span className="tabular">{qty(o.target_quantity)} ×</span>&nbsp;{o.product_name}
                      <ProductionTargetButton occurrenceId={o.occurrence_id} current={o.target_quantity} />
                    </p>
                    <p className="text-[12px] text-muted">{o.assignee_name ?? t('production.shared')}</p>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => setRecording(o)}>
                    <Factory className="h-3.5 w-3.5" aria-hidden />
                    {t('production.record')}
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    disabled={pending}
                    aria-label={t('production.cancelOrder')}
                    title={t('production.cancelOrder')}
                    className="h-8 w-8 text-muted hover:text-late"
                    onClick={() => {
                      setCancelError(false);
                      setCancelling(o);
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden />
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
                  <th className="px-3 py-2 font-medium">{t('production.bestBefore')}</th>
                  <th className="px-3 py-2 font-medium">{t('production.by')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {made.map((m) => {
                  const short = Number(m.produced_quantity) < Number(m.target_quantity);
                  const reason = short ? m.shortfall_reason : null;
                  return (
                    <tr key={m.occurrence_id} className="align-top">
                      <td className="whitespace-nowrap px-3 py-2 tabular text-muted">{formatDate(m.due, 'medium')}</td>
                      <td className="px-3 py-2">
                        {m.product_name}
                        {(reason || m.shortfall_note) && (
                          <p className={cn('text-[11.5px]', reason ? 'text-warn' : 'text-muted')}>
                            {reason && t(SHORTFALL_LABEL[reason])}
                            {reason && m.shortfall_note && ': '}
                            {m.shortfall_note}
                          </p>
                        )}
                      </td>
                      <td className={cn('whitespace-nowrap px-3 py-2 text-right font-semibold tabular', short ? 'text-warn' : 'text-done')}>
                        {qty(Number(m.produced_quantity))} / {qty(Number(m.target_quantity))}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 tabular">{m.best_before ? formatDate(m.best_before, 'medium') : '—'}</td>
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

      {/* Cancelling takes the order off its day with no record left (decided
          2026-11-24): planners only — this page is theirs — and no notices. */}
      <ConfirmDialog
        open={cancelling !== null}
        onClose={() => setCancelling(null)}
        loading={pending}
        title={t('production.cancelOrder')}
        message={
          cancelling
            ? t('production.cancelOrderConfirm', {
                quantity: qty(cancelling.target_quantity),
                product: cancelling.product_name,
                date: formatDate(cancelling.due, 'medium'),
              })
            : ''
        }
        confirmLabel={t('production.cancelOrder')}
        cancelLabel={t('common.cancel')}
        destructive
        onConfirm={() => {
          if (!cancelling) return;
          const id = cancelling.occurrence_id;
          startTransition(async () => {
            const res = await unplanTask(id);
            setCancelling(null);
            if (!res.ok) setCancelError(true);
            router.refresh();
          });
        }}
      />
    </>
  );
}
